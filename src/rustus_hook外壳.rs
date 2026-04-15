use super::{
    err_resp, map_domain_err_tuple, 应用状态, 媒体上传运输方式_TUS, 构建共享仓储,
};
use crate::usecase::{self, 仓储端口};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::{Path as StdPath, PathBuf},
};
use tokio::task;

/// Rustus hook 顶层负载。
/// 我们只解析自己真正依赖的最小字段，其余字段继续留给 Rustus 自己演进。
#[derive(Deserialize)]
pub(super) struct RustusHookBody {
    upload: RustusUploadBody,
}

/// Rustus v2 hook 里和我们有关的上传字段。
#[derive(Deserialize)]
struct RustusUploadBody {
    id: String,
    offset: i64,
    length: i64,
    path: Option<String>,
    metadata: HashMap<String, String>,
}

/// Rustus hook 收口点：
/// 1. `pre-create` 负责阻止非法上传创建；
/// 2. `post-finish` 只登记运输回执；
/// 3. 无论哪个 hook，都不能越权把 prepared 直接升级成 ready。
pub(super) async fn handle_rustus_hook(
    State(state): State<应用状态>,
    headers: HeaderMap,
    Json(body): Json<RustusHookBody>,
) -> Response {
    let hook_name = match 读取rustus_hook名称(&headers) {
        Ok(name) => name,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    match hook_name.as_str() {
        "pre-create" => handle_rustus_hook_pre_create(state, headers, body).await,
        "post-finish" => handle_rustus_hook_post_finish(state, headers, body).await,
        _ => err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("不支持的 Hook-Name: {hook_name}"),
        )
        .into_response(),
    }
}

async fn handle_rustus_hook_pre_create(
    state: 应用状态,
    headers: HeaderMap,
    body: RustusHookBody,
) -> Response {
    let upload_token = match 读取媒体上传令牌(&headers) {
        Ok(token) => token,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let attachment_id = match 读取rustus_metadata字段(&body.upload.metadata, "attachment_id") {
        Ok(value) => value,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    /*
     * `pre-create` 发生在 Rustus 真正接收字节之前：
     * - `length` 代表客户端声明的总长度；
     * - `offset` 此时应当还是 0；
     * - 真正“offset == length”的完成事实只允许出现在 `post-finish`。
     *
     * 同时，这里不能再把 `metadata.byte_size` 当成硬依赖：
     * - prepare / transport 授权里已经持有权威字节大小；
     * - create-upload 场景下 sidecar 透传回来的 metadata 并不保证完整回显所有键；
     * - attachment_id 继续作为 sidecar -> 主服务之间唯一稳定的业务锚点。
     */
    if body.upload.offset != 0 {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "pre-create 要求 offset 必须为 0",
        )
        .into_response();
    }

    let state_for_repo = state.clone();
    let check_result = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_repo);
        let Some(transport) = repo
            .根据上传令牌查询媒体上传运输记录(&upload_token)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌无效".to_string(),
            ));
        };
        if !transport.令牌仍有效 || transport.运输方式 != 媒体上传运输方式_TUS {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌已失效".to_string(),
            ));
        }
        if transport.附件标识 != attachment_id {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "attachment_id 与上传令牌不匹配".to_string(),
            ));
        }
        let Some(prepared) = repo
            .查询待完成媒体附件(&transport.附件标识)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        };
        if !matches!(prepared.状态, usecase::附件状态读取结果::已准备) {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        }
        if prepared.字节大小 != body.upload.length {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "上传文件大小与 prepare 不一致".to_string(),
            ));
        }
        Ok::<_, (StatusCode, &'static str, String)>(())
    })
    .await
    {
        Ok(result) => result,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("Rustus pre-create 任务执行失败: {err}"),
            )
            .into_response()
        }
    };
    match check_result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err((status, code, message)) => err_resp(status, code, message).into_response(),
    }
}

async fn handle_rustus_hook_post_finish(
    state: 应用状态,
    headers: HeaderMap,
    body: RustusHookBody,
) -> Response {
    let request_id = 读取可选请求标识(&headers);
    let upload_token = match 读取媒体上传令牌(&headers) {
        Ok(token) => token,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let attachment_id = match 读取rustus_metadata字段(&body.upload.metadata, "attachment_id") {
        Ok(value) => value,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let storage_locator = match body
        .upload
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => path.to_string(),
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "post-finish 缺少 upload.path",
            )
            .into_response()
        }
    };
    if body.upload.offset != body.upload.length {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "post-finish 只接受 offset 等于 length 的完成回执",
        )
        .into_response();
    }

    let state_for_repo = state.clone();
    let upload_id = body.upload.id.clone();
    // 这里显式拆出一份给阻塞闭包使用：
    // - `spawn_blocking(move || ...)` 必须拿走它依赖的数据所有权；
    // - 但 hook 返回前的结构化日志也需要稳定锚点；
    // - 因此 transport 更新和日志诊断各自持有一份，只共享值，不共享可变状态。
    let attachment_id_for_repo = attachment_id.clone();
    let upload_id_for_repo = upload_id.clone();
    let storage_locator_for_repo = storage_locator.clone();
    let update_result = match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_repo);
        let Some(transport) = repo
            .根据上传令牌查询媒体上传运输记录(&upload_token)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌无效".to_string(),
            ));
        };
        if !transport.令牌仍有效 || transport.运输方式 != 媒体上传运输方式_TUS {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌已失效".to_string(),
            ));
        }
        if transport.附件标识 != attachment_id_for_repo {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "attachment_id 与上传令牌不匹配".to_string(),
            ));
        }
        let Some(prepared) = repo
            .查询待完成媒体附件(&transport.附件标识)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        };
        if !matches!(prepared.状态, usecase::附件状态读取结果::已准备) {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件不再处于待上传状态".to_string(),
            ));
        }
        解析rustus临时文件路径(&state_for_repo.rustus_data_dir, &storage_locator_for_repo)?;
        repo.更新媒体上传运输回执(
            &transport.附件标识,
            &upload_id_for_repo,
            &storage_locator_for_repo,
            body.upload.length,
        )
        .map_err(map_domain_err_tuple)?;
        Ok::<_, (StatusCode, &'static str, String)>(())
    })
    .await
    {
        Ok(result) => result,
        Err(err) => {
            tracing::error!(
                adapter = "rustus_hook",
                hook = "post-finish",
                attachment_id = attachment_id.as_str(),
                upload_id = upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                storage_locator = storage_locator.as_str(),
                error_code = "system_error",
                detail = %err,
                "Rustus post-finish 任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("Rustus post-finish 任务执行失败: {err}"),
            )
            .into_response()
        }
    };
    match update_result {
        Ok(()) => {
            tracing::info!(
                adapter = "rustus_hook",
                hook = "post-finish",
                attachment_id = attachment_id.as_str(),
                upload_id = upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                storage_locator = storage_locator.as_str(),
                "Rustus post-finish 已登记上传回执"
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Err((status, code, message)) => {
            tracing::warn!(
                adapter = "rustus_hook",
                hook = "post-finish",
                attachment_id = attachment_id.as_str(),
                upload_id = upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                storage_locator = storage_locator.as_str(),
                error_code = code,
                detail = %message,
                "Rustus post-finish 被拒绝"
            );
            err_resp(status, code, message).into_response()
        }
    }
}

fn 读取rustus_hook名称(
    headers: &HeaderMap,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    headers
        .get("Hook-Name")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 Hook-Name",
        ))
}

fn 读取媒体上传令牌(
    headers: &HeaderMap,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    let Some(raw_authorization) = headers
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
    else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "attachment_upload_unauthorized",
            "缺少 Authorization",
        ));
    };
    raw_authorization
        .strip_prefix("Bearer ")
        .or_else(|| raw_authorization.strip_prefix("bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or((
            StatusCode::UNAUTHORIZED,
            "attachment_upload_unauthorized",
            "上传令牌非法",
        ))
}

fn 读取可选请求标识(headers: &HeaderMap) -> Option<String> {
    headers
        .get("X-Request-ID")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn 读取rustus_metadata字段(
    metadata: &HashMap<String, String>,
    key: &'static str,
) -> Result<String, (StatusCode, &'static str, String)> {
    metadata
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("缺少 metadata.{key}"),
        ))
}

/// storage locator 来自 sidecar，不可被客户端随意扩展成任意磁盘路径。
/// 这里统一解析并锁死在 Rustus shared data dir 之内，避免 token 持有者伪造路径探测主机文件。
///
/// 这个解析器继续留在 Rustus owner 下，后续上传 complete 也必须复用它，
/// 防止 hook 与 complete 各自维护一套“路径是否可信”的判断。
pub(super) fn 解析rustus临时文件路径(
    rustus_data_dir: &str,
    storage_locator: &str,
) -> Result<PathBuf, (StatusCode, &'static str, String)> {
    let shared_root = PathBuf::from(rustus_data_dir);
    let candidate = PathBuf::from(storage_locator);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        shared_root.join(candidate)
    };
    let canonical_root = std::fs::canonicalize(&shared_root).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("解析 Rustus shared dir 失败: {err}"),
        )
    })?;
    let canonical_file = std::fs::canonicalize(&resolved).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("解析 Rustus 临时文件失败: {err}"),
        )
    })?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "storage locator 超出 Rustus data dir".to_string(),
        ));
    }
    if !StdPath::new(&canonical_file).is_file() {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "storage locator 不是文件".to_string(),
        ));
    }
    Ok(canonical_file)
}

#[cfg(test)]
mod tests {
    use super::读取可选请求标识;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn 读取可选请求标识会返回非空x_request_id() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Request-ID", HeaderValue::from_static("req-123"));

        assert_eq!(读取可选请求标识(&headers).as_deref(), Some("req-123"));
    }
}

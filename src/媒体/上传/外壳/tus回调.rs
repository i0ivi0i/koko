use super::{
    err_resp, map_domain_err_tuple, 媒体上传运输方式_TUS, 应用状态, 构建共享仓储,
    TUS_INTERNAL_TERMINATION_GUARD_HEADER,
};
use crate::{
    adapter::{媒体上传运输回执写入参数, 媒体上传运输角色},
    usecase::{self, 仓储端口},
};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path as StdPath, PathBuf},
};
use tokio::task;

/// 当前 hook adapter 顶层负载直接贴 tusd 官方 `Type / Event` 结构。
/// 业务层仍然只认 attachment/upload_session/transport_role；协议字段只允许停留在 adapter。
#[derive(Deserialize)]
pub(super) struct TusHookBody {
    #[serde(rename = "Type")]
    hook_type: String,
    #[serde(rename = "Event")]
    event: TusHookEventBody,
}

/// 当前 hook 里和我们有关的上传字段只覆盖 tusd 官方 payload 的最小子集。
#[derive(Deserialize)]
struct TusUploadBody {
    #[serde(rename = "ID")]
    id: Option<String>,
    #[serde(rename = "Size")]
    size: Option<i64>,
    #[serde(rename = "SizeIsDeferred", default)]
    size_is_deferred: bool,
    #[serde(rename = "Offset")]
    offset: i64,
    #[serde(rename = "Storage")]
    storage: Option<TusUploadStorageBody>,
    #[serde(rename = "IsPartial", default)]
    is_partial: bool,
    #[serde(rename = "IsFinal", default)]
    is_final: bool,
    #[serde(rename = "PartialUploads")]
    partial_uploads: Option<Vec<String>>,
    #[serde(rename = "MetaData", default)]
    metadata: HashMap<String, String>,
}

#[derive(Deserialize)]
struct TusHookEventBody {
    #[serde(rename = "Upload")]
    upload: TusUploadBody,
    #[serde(rename = "HTTPRequest")]
    http_request: TusHttpRequestBody,
}

#[derive(Deserialize)]
struct TusHttpRequestBody {
    #[serde(rename = "Method")]
    _method: Option<String>,
    #[serde(rename = "URI")]
    _uri: Option<String>,
    #[serde(rename = "Header", default)]
    headers: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
struct TusUploadStorageBody {
    #[serde(rename = "Type")]
    _storage_type: Option<String>,
    #[serde(rename = "Path")]
    path: Option<String>,
}

#[derive(Serialize, Default)]
struct TusHookResponseBody {
    #[serde(rename = "HTTPResponse", skip_serializing_if = "Option::is_none")]
    http_response: Option<TusHookHttpResponseBody>,
    #[serde(rename = "RejectUpload", skip_serializing_if = "布尔值为假")]
    reject_upload: bool,
    #[serde(rename = "RejectTermination", skip_serializing_if = "布尔值为假")]
    reject_termination: bool,
}

#[derive(Serialize)]
struct TusHookHttpResponseBody {
    #[serde(rename = "StatusCode")]
    status_code: u16,
    #[serde(rename = "Body")]
    body: String,
    #[serde(rename = "Header")]
    headers: HashMap<String, String>,
}

/// Tus hook 收口点：
/// 1. `pre-create` 负责阻止非法上传创建；
/// 2. `post-finish` 只登记运输回执；
/// 3. `pre/post-terminate` 只处理 transport 删除门禁与日志；
/// 4. 无论哪个 hook，都不能越权把 prepared 直接升级成 ready。
pub(super) async fn handle_tus_hook(
    State(state): State<应用状态>,
    Json(body): Json<TusHookBody>,
) -> Response {
    let hook_name = match 读取tus_hook名称(&body) {
        Ok(name) => name,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    match hook_name.as_str() {
        "pre-create" => handle_tus_hook_pre_create(state, body).await,
        "post-finish" => handle_tus_hook_post_finish(state, body).await,
        "pre-terminate" => handle_tus_hook_pre_terminate(state, body).await,
        "post-terminate" => handle_tus_hook_post_terminate(state, body).await,
        _ => err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("不支持的 tus hook 类型: {hook_name}"),
        )
        .into_response(),
    }
}

fn 布尔值为假(value: &bool) -> bool {
    !*value
}

fn 构造tus_hook客户端错误响应(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> TusHookHttpResponseBody {
    let payload = serde_json::json!({
        "code": code,
        "message": message.into(),
    });
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    TusHookHttpResponseBody {
        status_code: status.as_u16(),
        body: payload.to_string(),
        headers,
    }
}

fn 返回tus_hook成功响应() -> Response {
    (StatusCode::OK, Json(TusHookResponseBody::default())).into_response()
}

fn 返回tus_hook拒绝上传响应(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> Response {
    (
        StatusCode::OK,
        Json(TusHookResponseBody {
            http_response: Some(构造tus_hook客户端错误响应(status, code, message)),
            reject_upload: true,
            reject_termination: false,
        }),
    )
        .into_response()
}

fn 返回tus_hook拒绝termination响应(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> Response {
    (
        StatusCode::OK,
        Json(TusHookResponseBody {
            http_response: Some(构造tus_hook客户端错误响应(status, code, message)),
            reject_upload: false,
            reject_termination: true,
        }),
    )
        .into_response()
}

async fn handle_tus_hook_pre_create(state: 应用状态, body: TusHookBody) -> Response {
    let upload_token = match 读取媒体上传令牌(&body.event.http_request) {
        Ok(token) => token,
        Err((status, code, message)) => return 返回tus_hook拒绝上传响应(status, code, message),
    };
    let transport_role = match 判定tus运输角色(&body.event.upload) {
        Ok(role) => role,
        Err((status, code, message)) => return 返回tus_hook拒绝上传响应(status, code, message),
    };
    let attachment_id = match 读取tus_metadata字段(&body.event.upload.metadata, "attachment_id")
    {
        Ok(value) => value,
        Err((status, code, message)) => return 返回tus_hook拒绝上传响应(status, code, message),
    };
    let upload_session_id =
        读取可选tus_metadata字段(&body.event.upload.metadata, "upload_session_id");
    let upload_size = match 读取tus上传大小(&body.event.upload, "pre-create") {
        Ok(size) => size,
        Err((status, code, message)) => return 返回tus_hook拒绝上传响应(status, code, message),
    };
    /*
     * `pre-create` 发生在 Tus sidecar 真正接收字节之前：
     * - `Upload.Size` 代表客户端声明的总长度；
     * - `Offset` 此时应当还是 0；
     * - 真正“offset == size”的完成事实只允许出现在 `post-finish`。
     *
     * 同时，这里不能再把 `MetaData.byte_size` 当成硬依赖：
     * - prepare / transport 授权里已经持有权威字节大小；
     * - create-upload 场景下 sidecar 透传回来的 metadata 并不保证完整回显所有键；
     * - attachment_id 继续作为 sidecar -> 主服务之间唯一稳定的业务锚点。
     */
    if body.event.upload.offset != 0 {
        return 返回tus_hook拒绝上传响应(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "pre-create 要求 offset 必须为 0",
        );
    }

    let state_for_repo = state.clone();
    let check_result = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_repo);
        let Some(upload_session) = repo
            .根据上传令牌查询媒体上传会话(&upload_token)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌无效".to_string(),
            ));
        };
        if !upload_session.令牌仍有效 || upload_session.运输方式 != 媒体上传运输方式_TUS
        {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌已失效".to_string(),
            ));
        }
        if upload_session.废弃时间戳秒.is_some() {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件上传已被放弃".to_string(),
            ));
        }
        if upload_session.附件标识 != attachment_id {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "attachment_id 与上传令牌不匹配".to_string(),
            ));
        }
        if let Some(upload_session_id) = upload_session_id.as_deref() {
            if upload_session.上传会话标识 != upload_session_id {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "invalid_argument",
                    "upload_session_id 与上传令牌不匹配".to_string(),
                ));
            }
        } else if transport_role != 媒体上传运输角色::单文件 {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "partial/final upload 缺少 upload_session_id".to_string(),
            ));
        }
        let Some(prepared) = repo
            .查询待完成媒体附件(&upload_session.附件标识)
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
        if prepared.当前上传会话标识.as_deref() != Some(upload_session.上传会话标识.as_str())
        {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件当前上传会话已切换".to_string(),
            ));
        }
        match transport_role {
            媒体上传运输角色::单文件 => {
                if prepared.字节大小 != upload_size {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "invalid_argument",
                        "上传文件大小与 prepare 不一致".to_string(),
                    ));
                }
            }
            媒体上传运输角色::分片 => {
                if upload_size <= 0 || upload_size >= prepared.字节大小 {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "invalid_argument",
                        "partial upload 必须小于 prepare 整文件大小".to_string(),
                    ));
                }
            }
            媒体上传运输角色::最终合并 => {
                if body
                    .event
                    .upload
                    .partial_uploads
                    .as_ref()
                    .is_none_or(|parts| parts.is_empty())
                {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "invalid_argument",
                        "final concat 缺少 partial uploads 列表".to_string(),
                    ));
                }
            }
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
                format!("Tus pre-create 任务执行失败: {err}"),
            )
            .into_response()
        }
    };
    match check_result {
        Ok(()) => 返回tus_hook成功响应(),
        Err((status, code, message)) => 返回tus_hook拒绝上传响应(status, code, message),
    }
}

async fn handle_tus_hook_post_finish(state: 应用状态, body: TusHookBody) -> Response {
    let request_id = 读取可选请求标识(&body.event.http_request);
    let upload_token = match 读取媒体上传令牌(&body.event.http_request) {
        Ok(token) => token,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let transport_role = match 判定tus运输角色(&body.event.upload) {
        Ok(role) => role,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let attachment_id = match 读取tus_metadata字段(&body.event.upload.metadata, "attachment_id")
    {
        Ok(value) => value,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let upload_session_id =
        读取可选tus_metadata字段(&body.event.upload.metadata, "upload_session_id");
    let upload_size = match 读取tus上传大小(&body.event.upload, "post-finish") {
        Ok(size) => size,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let upload_id = match 读取tus上传标识(&body.event.upload, "post-finish") {
        Ok(upload_id) => upload_id,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let storage_locator = match 读取tus存储路径(&body.event.upload) {
        Ok(path) => path,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    if body.event.upload.offset != upload_size {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "post-finish 只接受 offset 等于 size 的完成回执",
        )
        .into_response();
    }

    let state_for_repo = state.clone();
    // 这里显式拆出一份给阻塞闭包使用：
    // - `spawn_blocking(move || ...)` 必须拿走它依赖的数据所有权；
    // - 但 hook 返回前的结构化日志也需要稳定锚点；
    // - 因此 transport 更新和日志诊断各自持有一份，只共享值，不共享可变状态。
    let attachment_id_for_repo = attachment_id.clone();
    let upload_session_id_for_repo = upload_session_id.clone();
    let upload_id_for_repo = upload_id.clone();
    let storage_locator_for_repo = storage_locator.clone();
    let update_result = match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_repo);
        let Some(upload_session) = repo
            .根据上传令牌查询媒体上传会话(&upload_token)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌无效".to_string(),
            ));
        };
        if !upload_session.令牌仍有效 || upload_session.运输方式 != 媒体上传运输方式_TUS
        {
            return Err((
                StatusCode::UNAUTHORIZED,
                "attachment_upload_unauthorized",
                "上传令牌已失效".to_string(),
            ));
        }
        if upload_session.废弃时间戳秒.is_some() {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件上传已被放弃".to_string(),
            ));
        }
        if upload_session.附件标识 != attachment_id_for_repo {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "attachment_id 与上传令牌不匹配".to_string(),
            ));
        }
        if let Some(upload_session_id) = upload_session_id_for_repo.as_deref() {
            if upload_session.上传会话标识 != upload_session_id {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "invalid_argument",
                    "upload_session_id 与上传令牌不匹配".to_string(),
                ));
            }
        } else if transport_role != 媒体上传运输角色::单文件 {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "partial/final upload 缺少 upload_session_id".to_string(),
            ));
        }
        let Some(prepared) = repo
            .查询待完成媒体附件(&upload_session.附件标识)
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
        if prepared.当前上传会话标识.as_deref() != Some(upload_session.上传会话标识.as_str())
        {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件当前上传会话已切换".to_string(),
            ));
        }
        解析tus临时文件路径(&state_for_repo.tus_upload_dir, &storage_locator_for_repo)?;
        repo.登记媒体上传运输回执(&媒体上传运输回执写入参数 {
            上传会话标识: upload_session.上传会话标识.clone(),
            附件标识: upload_session.附件标识.clone(),
            运输方式: upload_session.运输方式.clone(),
            运输角色: transport_role,
            concat_order: None,
            transport_upload_id: upload_id_for_repo.clone(),
            storage_locator: storage_locator_for_repo.clone(),
            byte_size: upload_size,
        })
        .map_err(map_domain_err_tuple)?;
        Ok::<_, (StatusCode, &'static str, String)>(())
    })
    .await
    {
        Ok(result) => result,
        Err(err) => {
            tracing::error!(
                adapter = "tus_hook",
                hook = "post-finish",
                attachment_id = attachment_id.as_str(),
                upload_session_id = upload_session_id.as_deref().unwrap_or(""),
                upload_id = upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                transport_role = transport_role.as_str(),
                storage_locator = storage_locator.as_str(),
                error_code = "system_error",
                detail = %err,
                "Tus post-finish 任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("Tus post-finish 任务执行失败: {err}"),
            )
            .into_response();
        }
    };
    match update_result {
        Ok(()) => {
            tracing::info!(
                adapter = "tus_hook",
                hook = "post-finish",
                attachment_id = attachment_id.as_str(),
                upload_session_id = upload_session_id.as_deref().unwrap_or(""),
                upload_id = upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                transport_role = transport_role.as_str(),
                storage_locator = storage_locator.as_str(),
                "Tus post-finish 已登记上传回执"
            );
            返回tus_hook成功响应()
        }
        Err((status, code, message)) => {
            tracing::warn!(
                adapter = "tus_hook",
                hook = "post-finish",
                attachment_id = attachment_id.as_str(),
                upload_session_id = upload_session_id.as_deref().unwrap_or(""),
                upload_id = upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                transport_role = transport_role.as_str(),
                storage_locator = storage_locator.as_str(),
                error_code = code,
                detail = %message,
                "Tus post-finish 被拒绝"
            );
            let _ = status;
            返回tus_hook成功响应()
        }
    }
}

fn 读取tus_hook名称(
    body: &TusHookBody,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    let hook_name = body.hook_type.trim().to_ascii_lowercase();
    if hook_name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 tus hook 类型",
        ));
    }
    Ok(hook_name)
}

fn 读取媒体上传令牌(
    http_request: &TusHttpRequestBody,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    let Some(raw_authorization) = 读取首个非空tus请求头值(http_request, "Authorization")
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

fn 读取可选请求标识(http_request: &TusHttpRequestBody) -> Option<String> {
    读取首个非空tus请求头值(http_request, "X-Request-Id")
}

/// 协议字段 `IsPartial/IsFinal` 只允许在 Tus hook adapter 停留。
/// 这里统一把它们翻译成我们自己的 transport role，避免 shell / usecase 直接吃协议布尔位。
fn 判定tus运输角色(
    upload: &TusUploadBody,
) -> Result<媒体上传运输角色, (StatusCode, &'static str, String)> {
    match (upload.is_partial, upload.is_final) {
        (true, true) => Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "upload 不能同时是 partial 和 final".to_string(),
        )),
        (true, false) => Ok(媒体上传运输角色::分片),
        (false, true) => Ok(媒体上传运输角色::最终合并),
        (false, false) => Ok(媒体上传运输角色::单文件),
    }
}

fn 读取首个非空tus请求头值(
    http_request: &TusHttpRequestBody,
    key: &'static str,
) -> Option<String> {
    http_request
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .and_then(|(_, values)| {
            values
                .iter()
                .map(String::as_str)
                .map(str::trim)
                .find(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
}

fn 读取tus上传大小(
    upload: &TusUploadBody,
    hook_name: &'static str,
) -> Result<i64, (StatusCode, &'static str, String)> {
    if upload.size_is_deferred {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("{hook_name} 暂不支持 deferred size 上传"),
        ));
    }
    upload.size.ok_or((
        StatusCode::BAD_REQUEST,
        "invalid_argument",
        format!("{hook_name} 缺少 Upload.Size"),
    ))
}

fn 读取tus上传标识(
    upload: &TusUploadBody,
    hook_name: &'static str,
) -> Result<String, (StatusCode, &'static str, String)> {
    upload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("{hook_name} 缺少 Upload.ID"),
        ))
}

fn 读取tus存储路径(
    upload: &TusUploadBody,
) -> Result<String, (StatusCode, &'static str, String)> {
    upload
        .storage
        .as_ref()
        .and_then(|storage| storage.path.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "post-finish 缺少 Upload.Storage.Path".to_string(),
        ))
}

fn 读取可选tus_metadata字段(
    metadata: &HashMap<String, String>,
    key: &'static str,
) -> Option<String> {
    metadata
        .get(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn 读取tus_metadata字段(
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
/// 这里统一解析并锁死在 Tus upload dir 之内，避免 token 持有者伪造路径探测主机文件。
///
/// 这个解析器继续留在 Tus hook owner 下，后续上传 complete 也必须复用它，
/// 防止 hook 与 complete 各自维护一套“路径是否可信”的判断。
pub(super) fn 解析tus临时文件路径(
    tus_upload_dir: &str,
    storage_locator: &str,
) -> Result<PathBuf, (StatusCode, &'static str, String)> {
    let shared_root = PathBuf::from(tus_upload_dir);
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
            format!("解析 Tus upload dir 失败: {err}"),
        )
    })?;
    let canonical_file = std::fs::canonicalize(&resolved).map_err(|err| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("解析 Tus 临时文件失败: {err}"),
        )
    })?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "storage locator 超出 Tus upload dir".to_string(),
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

/// 后台残留清理和 complete/hook 的语义不同：
/// 1. complete/hook 必须严格拒绝脏 locator，不能把越界路径带进主链；
/// 2. 清理阶段面对的是“历史上曾经写进数据库、现在已经没有长期价值”的 locator；
/// 3. 因此历史 rustus 外部路径、或当前文件已先被删掉时，都应该被视为可收口的 no-op，而不是持续报错。
pub(super) enum Tus残留清理定位结果 {
    当前上传目录文件(PathBuf),
    当前上传目录文件已缺失,
    历史外部定位,
}

pub(super) fn 解析tus残留清理目标(
    tus_upload_dir: &str,
    storage_locator: &str,
) -> Result<Tus残留清理定位结果, String> {
    let shared_root = PathBuf::from(tus_upload_dir);
    let candidate = PathBuf::from(storage_locator);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        shared_root.join(candidate)
    };
    let canonical_root = std::fs::canonicalize(&shared_root)
        .map_err(|err| format!("解析 Tus upload dir 失败: {err}"))?;
    match std::fs::canonicalize(&resolved) {
        Ok(canonical_file) => {
            if !canonical_file.starts_with(&canonical_root) {
                return Ok(Tus残留清理定位结果::历史外部定位);
            }
            if !StdPath::new(&canonical_file).is_file() {
                return Err("storage locator 不是文件".to_string());
            }
            Ok(Tus残留清理定位结果::当前上传目录文件(canonical_file))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = resolved.parent() {
                if let Ok(canonical_parent) = std::fs::canonicalize(parent) {
                    if !canonical_parent.starts_with(&canonical_root) {
                        return Ok(Tus残留清理定位结果::历史外部定位);
                    }
                }
            }
            Ok(Tus残留清理定位结果::当前上传目录文件已缺失)
        }
        Err(err) => Err(format!("解析 Tus 临时文件失败: {err}")),
    }
}

async fn handle_tus_hook_pre_terminate(state: 应用状态, body: TusHookBody) -> Response {
    let request_id = 读取可选请求标识(&body.event.http_request);
    let upload_id = match 读取tus上传标识(&body.event.upload, "pre-terminate") {
        Ok(upload_id) => upload_id,
        Err((status, code, message)) => {
            return 返回tus_hook拒绝termination响应(status, code, message)
        }
    };
    let Some(expected_guard) = state
        .tus_internal_termination_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        tracing::warn!(
            adapter = "tus_hook",
            hook = "pre-terminate",
            upload_id = upload_id.as_str(),
            request_id = request_id.as_deref().unwrap_or(""),
            error_code = "attachment_upload_unauthorized",
            "Tus pre-terminate 缺少内部守卫配置，拒绝删除"
        );
        return 返回tus_hook拒绝termination响应(
            StatusCode::UNAUTHORIZED,
            "attachment_upload_unauthorized",
            "termination 未授权",
        );
    };
    let Some(actual_guard) = 读取首个非空tus请求头值(
        &body.event.http_request,
        TUS_INTERNAL_TERMINATION_GUARD_HEADER,
    ) else {
        return 返回tus_hook拒绝termination响应(
            StatusCode::UNAUTHORIZED,
            "attachment_upload_unauthorized",
            "termination 未授权",
        );
    };
    if actual_guard != expected_guard {
        tracing::warn!(
            adapter = "tus_hook",
            hook = "pre-terminate",
            upload_id = upload_id.as_str(),
            request_id = request_id.as_deref().unwrap_or(""),
            error_code = "attachment_upload_unauthorized",
            "Tus pre-terminate 内部守卫头不匹配，拒绝删除"
        );
        return 返回tus_hook拒绝termination响应(
            StatusCode::UNAUTHORIZED,
            "attachment_upload_unauthorized",
            "termination 未授权",
        );
    }
    tracing::info!(
        adapter = "tus_hook",
        hook = "pre-terminate",
        upload_id = upload_id.as_str(),
        request_id = request_id.as_deref().unwrap_or(""),
        "Tus pre-terminate 已放行内部 transport 删除"
    );
    返回tus_hook成功响应()
}

async fn handle_tus_hook_post_terminate(_state: 应用状态, body: TusHookBody) -> Response {
    let request_id = 读取可选请求标识(&body.event.http_request);
    let upload_id = match 读取tus上传标识(&body.event.upload, "post-terminate") {
        Ok(upload_id) => upload_id,
        Err((status, code, message)) => return err_resp(status, code, message).into_response(),
    };
    let attachment_id =
        读取可选tus_metadata字段(&body.event.upload.metadata, "attachment_id");
    let upload_session_id =
        读取可选tus_metadata字段(&body.event.upload.metadata, "upload_session_id");
    tracing::info!(
        adapter = "tus_hook",
        hook = "post-terminate",
        attachment_id = attachment_id.as_deref().unwrap_or(""),
        upload_session_id = upload_session_id.as_deref().unwrap_or(""),
        upload_id = upload_id.as_str(),
        request_id = request_id.as_deref().unwrap_or(""),
        "Tus post-terminate 已记录 transport 删除事实"
    );
    返回tus_hook成功响应()
}

#[cfg(test)]
mod tests {
    use super::{TusHttpRequestBody, 读取可选请求标识};
    use std::collections::HashMap;

    #[test]
    fn 读取可选请求标识会返回非空x_request_id() {
        let mut headers = HashMap::new();
        headers.insert("X-Request-Id".to_string(), vec!["req-123".to_string()]);
        let http_request = TusHttpRequestBody {
            _method: None,
            _uri: None,
            headers,
        };

        assert_eq!(读取可选请求标识(&http_request).as_deref(), Some("req-123"));
    }
}

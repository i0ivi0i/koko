use super::媒体_tus代理外壳::读取媒体_tus对外地址;
use super::媒体上传共享外壳::{
    推导原始内容扩展名, 校验媒体准备请求, 生成媒体上传令牌, 生成媒体上传会话标识, 生成附件标识,
    解析媒体类型,
};
use super::{媒体上传运输方式_TUS, 应用状态, 构建共享仓储};
use crate::adapter::媒体上传会话授权写入请求;
use crate::media::application::媒体仓储端口;
use crate::media::upload::application as 上传应用;
use crate::shell::协议响应::{err_resp, map_domain_err_tuple};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::task;

/// 上传授权只服务 prepare 返回值，不属于房间真相或资产读取真相。
const 媒体上传授权有效期秒数: u64 = 15 * 60;
/// 媒体 prepare 请求体。
#[derive(Deserialize)]
pub(super) struct PrepareMediaUploadBody {
    session_id: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
    byte_size: Option<i64>,
    source_hash: Option<String>,
    source_byte_size: Option<i64>,
    source_file_name: Option<String>,
}

async fn 回滚prepare失败留下的预备附件(
    state: 应用状态,
    attachment_id: String,
) -> Result<(), String> {
    match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        repo.回滚预备媒体附件记录(&attachment_id)
            .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(())) => Ok(()),
        Ok(Err((status, code, message))) => Err(format!(
            "status={}, code={}, message={message}",
            status.as_u16(),
            code
        )),
        Err(err) => Err(format!("回滚孤儿 prepared 附件任务执行失败: {err}")),
    }
}

/// 冷路径：申请媒体附件上传占位。
/// 这一步只创建 prepared 真相，并返回后续直传所需参数；不在这里上传字节。
pub(super) async fn prepare_media_upload(
    Path(raw_kind): Path<String>,
    State(state): State<应用状态>,
    Json(body): Json<PrepareMediaUploadBody>,
) -> impl IntoResponse {
    let media_kind = match 解析媒体类型(raw_kind.as_str()) {
        Ok(kind) => kind,
        Err(err) => return err_resp(err.0, err.1, err.2),
    };
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let file_name = match body
        .file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(file_name) => file_name,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 file_name",
            );
        }
    };
    let mime_type = match body
        .mime_type
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
    {
        Some(mime_type) => mime_type,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 mime_type",
            );
        }
    };
    let byte_size = match body.byte_size {
        Some(byte_size) => byte_size,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 byte_size",
            );
        }
    };
    if let Err((status, code, message)) =
        校验媒体准备请求(&media_kind, &mime_type, byte_size)
    {
        return err_resp(status, code, message);
    }
    let source_hash = body
        .source_hash
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let source_file_name = body
        .source_file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let attachment_id = 生成附件标识();
    let upload_session_id = 生成媒体上传会话标识();
    let storage_prefix = match media_kind {
        crate::media::模型::媒体附件类型::图片 => "images",
        crate::media::模型::媒体附件类型::视频 => "videos",
    };
    let original_storage_key = format!(
        "{storage_prefix}/{attachment_id}/original{}",
        推导原始内容扩展名(&media_kind, mime_type.as_str())
    );
    let prepare_request = crate::media::模型::媒体附件准备请求 {
        附件标识: attachment_id.clone(),
        种类: media_kind.clone(),
        mime_type: mime_type.clone(),
        字节大小: byte_size,
        原始内容存储键: original_storage_key.clone(),
        source_hash,
        source_byte_size: body.source_byte_size,
        source_file_name,
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let prepare_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        上传应用::准备媒体附件上传(&mut repo, &session_id_for_usecase, &prepare_request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let snapshot = match prepare_result {
        Ok(Ok(snapshot)) => snapshot,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("prepare 任务执行失败: {err}"),
            );
        }
    };

    // prepare 只负责：
    // 1. 落 prepared 附件真相；
    // 2. 下发一段短期 Tus 上传会话授权；
    // 3. token 只属于 upload_session，不再错误地复制到 partial/final transport 记录。
    let upload_token = 生成媒体上传令牌();
    let transport_auth = 媒体上传会话授权写入请求 {
        上传会话标识: upload_session_id.clone(),
        附件标识: snapshot.附件标识.clone(),
        运输方式: 媒体上传运输方式_TUS.to_string(),
        上传令牌: upload_token.clone(),
        令牌有效期秒数: 媒体上传授权有效期秒数 as i64,
    };
    let state_for_transport = state.clone();
    let transport_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_transport);
        repo.写入媒体上传会话授权(&transport_auth)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let transport_error = match transport_result {
        Ok(Ok(())) => None,
        Ok(Err((status, code, message))) => Some((status, code, message)),
        Err(err) => Some((
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("prepare 运输授权任务执行失败: {err}"),
        )),
    };
    if let Some((status, code, message)) = transport_error {
        if let Err(rollback_detail) =
            回滚prepare失败留下的预备附件(state.clone(), snapshot.附件标识.clone()).await
        {
            tracing::error!(
                application = "准备媒体上传",
                adapter = "http",
                outcome = "rollback_failed",
                request_kind = "媒体上传 prepare",
                session_id = session_id.as_str(),
                attachment_id = snapshot.附件标识.as_str(),
                upload_session_id = upload_session_id.as_str(),
                error_code = code,
                detail = %rollback_detail,
                original_error = %message,
                "prepare 第二阶段失败后回滚孤儿 prepared 附件失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!(
                    "prepare 运输授权失败且回滚孤儿附件失败: {rollback_detail}; 原始错误: {message}"
                ),
            );
        }
        tracing::warn!(
            application = "准备媒体上传",
            adapter = "http",
            outcome = "rolled_back",
            request_kind = "媒体上传 prepare",
            session_id = session_id.as_str(),
            attachment_id = snapshot.附件标识.as_str(),
            upload_session_id = upload_session_id.as_str(),
            error_code = code,
            detail = %message,
            "prepare 第二阶段失败，已回滚孤儿 prepared 附件"
        );
        return err_resp(status, code, message);
    }

    let expires_at = (SystemTime::now() + Duration::from_secs(媒体上传授权有效期秒数))
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    tracing::info!(
        application = "准备媒体上传",
        adapter = "http",
        outcome = "succeeded",
        request_kind = "媒体上传 prepare",
        session_id = session_id.as_str(),
        attachment_id = snapshot.附件标识.as_str(),
        upload_session_id = upload_session_id.as_str(),
        attachment_kind = super::媒体资产外壳::媒体类型转标签(&snapshot.种类),
        file_name = file_name.as_str(),
        byte_size = byte_size,
        "媒体上传占位已创建"
    );
    let response_attachment_id = snapshot.附件标识.clone();
    let response_kind = super::媒体资产外壳::媒体类型转标签(&snapshot.种类);
    let response_mime_type = snapshot.mime_type.clone();
    let response_byte_size = snapshot.字节大小;
    let tus_public_endpoint = 读取媒体_tus对外地址(&state);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "attachment_id": response_attachment_id,
            "upload_session_id": upload_session_id,
            "kind": response_kind,
            "upload_method": 媒体上传运输方式_TUS,
            "tus_endpoint": tus_public_endpoint,
            "tus_headers": {
                "Authorization": format!("Bearer {upload_token}"),
            },
            "tus_metadata": {
                "attachment_id": snapshot.附件标识,
                "upload_session_id": upload_session_id,
                "file_name": file_name,
                "mime_type": response_mime_type,
                "byte_size": response_byte_size.to_string(),
            },
            "expires_at": expires_at,
        })),
    )
        .into_response()
}

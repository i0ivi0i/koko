use super::媒体上传共享外壳::{媒体上传授权有效期秒数, 生成媒体上传令牌};
use super::{应用状态, 媒体上传运输方式_TUS, 构建共享仓储};
use crate::adapter::媒体上传会话授权写入请求;
use crate::identity::application::会话身份读取端口;
use crate::media::application::媒体仓储端口;
use crate::message::application::消息仓储端口;
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

#[derive(Deserialize)]
pub(super) struct ResumeMediaUploadBody {
    session_id: Option<String>,
    upload_session_id: Option<String>,
}

struct 可续传上传 {
    附件标识: String,
    上传会话标识: String,
    mime_type: String,
    字节大小: i64,
    上传令牌: String,
    expires_at: String,
}

struct 已完成附件 {
    附件标识: String,
    kind: &'static str,
    mime_type: String,
    字节大小: i64,
    宽: i32,
    高: i32,
}

enum 恢复结果 {
    可续传(可续传上传),
    已完成(已完成附件),
    需要重选,
}

pub(super) async fn resume_media_upload(
    Path(attachment_id): Path<String>,
    State(state): State<应用状态>,
    Json(body): Json<ResumeMediaUploadBody>,
) -> impl IntoResponse {
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let upload_session_id = match body
        .upload_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 upload_session_id",
            );
        }
    };

    let state_for_repo = state.clone();
    let attachment_id_for_repo = attachment_id.clone();
    let session_id_for_repo = session_id.clone();
    let upload_session_id_for_repo = upload_session_id.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_repo);
        let media_repo = repo.媒体仓储();
        let owner_identity = media_repo
            .查询会话所属匿名身份(&session_id_for_repo)
            .map_err(map_domain_err_tuple)?
            .ok_or((StatusCode::UNAUTHORIZED, "invalid_session", "会话无效".to_string()))?;
        let Some(prepared) = media_repo
            .查询待完成媒体附件(&attachment_id_for_repo)
            .map_err(map_domain_err_tuple)?
        else {
            return Err((
                StatusCode::NOT_FOUND,
                "attachment_not_found",
                "附件不存在".to_string(),
            ));
        };
        if prepared.所属匿名身份标识 != owner_identity {
            return Err((
                StatusCode::FORBIDDEN,
                "attachment_forbidden",
                "附件不属于当前发送者".to_string(),
            ));
        }
        if prepared.当前上传会话标识.as_deref() != Some(upload_session_id_for_repo.as_str()) {
            return Err((
                StatusCode::CONFLICT,
                "attachment_not_ready",
                "附件当前上传会话已切换".to_string(),
            ));
        }
        if matches!(
            prepared.状态,
            crate::media::模型::附件状态读取结果::失败
                | crate::media::模型::附件状态读取结果::已过期
        ) {
            return Ok(恢复结果::需要重选);
        }
        if matches!(prepared.状态, crate::media::模型::附件状态读取结果::就绪) {
            let Some(snapshot) = media_repo
                .查询附件快照(&attachment_id_for_repo)
                .map_err(map_domain_err_tuple)?
            else {
                return Err((
                    StatusCode::NOT_FOUND,
                    "attachment_not_found",
                    "附件不存在".to_string(),
                ));
            };
            let kind = match snapshot.种类 {
                crate::media::模型::附件种类读取结果::图片 => "image",
                crate::media::模型::附件种类读取结果::视频 => "video",
                _ => {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        "attachment_type_not_allowed",
                        "只允许恢复图片或视频上传".to_string(),
                    ));
                }
            };
            return Ok(恢复结果::已完成(已完成附件 {
                附件标识: prepared.附件标识,
                kind,
                mime_type: prepared.mime_type,
                字节大小: prepared.字节大小,
                宽: snapshot.宽.unwrap_or_default(),
                高: snapshot.高.unwrap_or_default(),
            }));
        }

        let upload_token = 生成媒体上传令牌();
        repo.写入媒体上传会话授权(&媒体上传会话授权写入请求 {
            上传会话标识: upload_session_id_for_repo.clone(),
            附件标识: prepared.附件标识.clone(),
            运输方式: 媒体上传运输方式_TUS.to_string(),
            上传令牌: upload_token.clone(),
            令牌有效期秒数: 媒体上传授权有效期秒数 as i64,
        })
        .map_err(map_domain_err_tuple)?;

        let expires_at = (SystemTime::now() + Duration::from_secs(媒体上传授权有效期秒数))
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());
        Ok(恢复结果::可续传(可续传上传 {
            附件标识: prepared.附件标识,
            上传会话标识: upload_session_id_for_repo,
            mime_type: prepared.mime_type,
            字节大小: prepared.字节大小,
            上传令牌: upload_token,
            expires_at,
        }))
    })
    .await;

    let resumable = match result {
        Ok(Ok(恢复结果::可续传(resumable))) => resumable,
        Ok(Ok(恢复结果::已完成(completed))) => {
            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "completed",
                    "attachment": {
                        "attachment_id": completed.附件标识,
                        "kind": completed.kind,
                        "mime_type": completed.mime_type,
                        "byte_size": completed.字节大小,
                        "width": completed.宽,
                        "height": completed.高,
                        "status": "ready",
                    },
                })),
            )
                .into_response();
        }
        Ok(Ok(恢复结果::需要重选)) => {
            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "status": "needs_reselect",
                    "attachment_id": attachment_id,
                    "error_code": "attachment_file_needs_reselect",
                })),
            )
                .into_response();
        }
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("resume 任务执行失败: {err}"),
            );
        }
    };

    let tus_public_endpoint = super::媒体_tus代理外壳::读取媒体_tus对外地址(&state);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "resumable",
            "attachment_id": resumable.附件标识,
            "upload_session_id": resumable.上传会话标识,
            "upload_method": 媒体上传运输方式_TUS,
            "tus_endpoint": tus_public_endpoint,
            "tus_headers": {
                "Authorization": format!("Bearer {}", resumable.上传令牌),
            },
            "tus_metadata": {
                "attachment_id": resumable.附件标识,
                "upload_session_id": resumable.上传会话标识,
                "mime_type": resumable.mime_type,
                "byte_size": resumable.字节大小.to_string(),
            },
            "expires_at": resumable.expires_at,
        })),
    )
        .into_response()
}

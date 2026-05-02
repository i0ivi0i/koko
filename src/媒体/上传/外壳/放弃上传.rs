use super::媒体_tus代理外壳::{尝试终止媒体_tus上传, 读取首个非空请求头};
use super::{应用状态, 构建共享仓储};
use crate::media::application::媒体仓储端口;
use crate::shell::协议响应::{err_resp, map_domain_err_tuple};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::task;
/// 媒体 abandon 请求体。
/// 这条冷路径只表达“显式放弃旧上传”意图，不夹带 restart/prepare 之类的下一步动作。
#[derive(Deserialize)]
pub(super) struct AbandonMediaUploadBody {
    session_id: Option<String>,
}

/// 冷路径：显式放弃旧上传。
/// 这里先让应用层把旧附件和 transport 一起标成 abandoned，
/// 然后 shell 再先协调官方 termination，最后继续按既有残留清理兜底收尾。
pub(super) async fn abandon_media_upload(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<AbandonMediaUploadBody>,
) -> impl IntoResponse {
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let request_id = 读取首个非空请求头(&headers, "x-request-id");
    let abandoned_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or_default();
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let abandon_result: (Option<String>, Vec<String>) = match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        let current_upload_session_id = repo
            .查询待完成媒体附件(&attachment_id_for_usecase)
            .map_err(map_domain_err_tuple)?
            .and_then(|prepared| prepared.当前上传会话标识);
        let transport_upload_ids = match current_upload_session_id.as_deref() {
            Some(upload_session_id) => repo
                .列出上传会话运输上传标识(upload_session_id)
                .map_err(map_domain_err_tuple)?,
            None => Vec::new(),
        };
        crate::media::application::放弃媒体上传(
            &mut repo,
            &session_id_for_usecase,
            &attachment_id_for_usecase,
            abandoned_epoch秒,
        )
        .map_err(map_domain_err_tuple)?;
        Ok::<_, (StatusCode, &'static str, String)>((
            current_upload_session_id,
            transport_upload_ids,
        ))
    })
    .await
    {
        Ok(Ok(payload)) => payload,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("abandon 任务执行失败: {err}"),
            );
        }
    };

    let (upload_session_id, transport_upload_ids) = abandon_result;
    for transport_upload_id in &transport_upload_ids {
        if let Err(err) = 尝试终止媒体_tus上传(
            &state,
            transport_upload_id.as_str(),
            request_id.as_deref(),
        )
        .await
        {
            tracing::warn!(
                application = "放弃媒体上传",
                adapter = "http",
                outcome = "transport_termination_failed",
                attachment_id = attachment_id.as_str(),
                upload_session_id = upload_session_id.as_deref().unwrap_or(""),
                transport_upload_id = transport_upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                error = %err,
                "媒体上传业务放弃已成立，但协调官方 Tus termination 失败"
            );
        }
    }

    if let Some(upload_session_id) = upload_session_id.as_deref() {
        if let Err(err) = super::媒体清理::执行一次媒体上传残留清理_按会话(
            state.clone(),
            Some(upload_session_id),
        )
        .await
        {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("删除已放弃上传临时文件失败: {err}"),
            );
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "attachment_id": attachment_id,
            "status": "abandoned",
        })),
    )
        .into_response()
}

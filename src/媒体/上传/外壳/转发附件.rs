use super::媒体上传共享外壳::{生成附件标识, 解析媒体类型};
use super::{应用状态, 构建共享仓储};
use crate::shell::协议响应::{err_resp, event_to_json, map_domain_err_tuple};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use tokio::task;
#[derive(Deserialize)]
pub(super) struct ForwardMediaBody {
    session_id: Option<String>,
    target_room_id: Option<String>,
    source_attachment_id: Option<String>,
    client_message_id: Option<String>,
    text: Option<String>,
}

pub(super) async fn forward_media_attachment(
    Path(raw_kind): Path<String>,
    State(state): State<应用状态>,
    headers: HeaderMap,
    Json(body): Json<ForwardMediaBody>,
) -> impl IntoResponse {
    let media_kind = match 解析媒体类型(raw_kind.as_str()) {
        Ok(kind) => kind,
        Err(err) => return err_resp(err.0, err.1, err.2),
    };
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let Some(target_room_id) = body
        .target_room_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 target_room_id",
        );
    };
    let Some(source_attachment_id) = body
        .source_attachment_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 source_attachment_id",
        );
    };
    let Some(client_message_id) = body
        .client_message_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 client_message_id",
        );
    };
    let text = body
        .text
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let attachment_id = 生成附件标识();
    let request = crate::media::模型::媒体附件转发请求 {
        会话标识: session_id.clone(),
        目标房间标识: target_room_id,
        源附件标识: source_attachment_id,
        新附件标识: attachment_id,
        客户端消息标识: client_message_id,
        文本: text,
        种类: media_kind,
    };
    let state_for_usecase = state.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        crate::media::application::转发媒体附件到房间(&mut repo, &request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let crate::media::模型::媒体附件转发结果 {
        消息事件,
        附件,
        协作分发,
        torrent: _,
    } = match result {
        Ok(Ok(result)) => result,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("媒体附件转发任务执行失败: {err}"),
            );
        }
    };
    let attachment =
        super::媒体附件上传响应外壳::构造ready媒体附件响应并触发做种(
            &state,
            &headers,
            session_id.as_str(),
            &附件,
            &协作分发,
            "媒体附件转发",
        )
        .await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "message": event_to_json(消息事件, Some(session_id.as_str())),
            "attachment": attachment,
        })),
    )
        .into_response()
}

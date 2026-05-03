use super::媒体上传共享外壳::{生成附件标识, 解析媒体类型};
use super::{应用状态, 构建共享仓储};
use crate::shell::协议响应::{err_resp, map_domain_err_tuple};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use tokio::task;
#[derive(Deserialize)]
pub(super) struct SourceHashReuseBody {
    session_id: Option<String>,
    room_id: Option<String>,
    source_hash: Option<String>,
    source_byte_size: Option<i64>,
    source_file_name: Option<String>,
}

pub(super) async fn reuse_media_by_source_hash(
    Path(raw_kind): Path<String>,
    State(state): State<应用状态>,
    Json(body): Json<SourceHashReuseBody>,
) -> impl IntoResponse {
    let media_kind = match 解析媒体类型(raw_kind.as_str()) {
        Ok(kind) => kind,
        Err(err) => return err_resp(err.0, err.1, err.2),
    };
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let Some(room_id) = body
        .room_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(StatusCode::BAD_REQUEST, "invalid_argument", "缺少 room_id");
    };
    let Some(source_hash) = body
        .source_hash
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 source_hash",
        );
    };
    let Some(source_byte_size) = body.source_byte_size else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 source_byte_size",
        );
    };
    let source_file_name = body
        .source_file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let attachment_id = 生成附件标识();
    let request = crate::media::模型::SourceHash媒体复用请求 {
        会话标识: session_id.clone(),
        房间标识: room_id.clone(),
        附件标识: attachment_id.clone(),
        种类: media_kind,
        source_hash,
        source_byte_size,
        source_file_name,
    };
    let state_for_usecase = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let mut media_repo = repo.媒体仓储();
        crate::media::application::复用source_hash媒体附件(&mut media_repo, &request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(Ok(result)) => result,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("source_hash 复用任务执行失败: {err}"),
            );
        }
    };

    let crate::media::模型::SourceHash媒体复用结果::Reused(命中) = result else {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "miss" })),
        )
            .into_response();
    };

    let attachment =
        super::媒体附件上传响应外壳::构造ready媒体附件响应并触发做种(
            &state,
            session_id.as_str(),
            &命中.附件,
            &命中.协作分发,
            "source_hash媒体复用",
        )
        .await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "reused",
            "attachment": attachment,
        })),
    )
        .into_response()
}

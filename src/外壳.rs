use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::task;

use crate::{adapter::Pg仓储, contract, usecase};

#[derive(Clone)]
pub struct 应用状态 {
    pub database_url: String,
    pub admin_password: String,
}

pub fn 构建路由(database_url: String, admin_password: String) -> Router {
    let state = 应用状态 {
        database_url,
        admin_password,
    };
    Router::new()
        .route("/api/session/bootstrap", post(bootstrap_session))
        .route("/api/rooms/join-or-create", post(join_or_create_room))
        .route("/api/rooms/{room_id}/snapshot", get(load_room_snapshot))
        .route("/api/rooms/{room_id}/events", get(load_room_events))
        .route("/api/admin/login", post(admin_login))
        .route("/api/admin/overview", get(admin_overview))
        .route("/api/admin/rooms", get(admin_rooms))
        .route("/api/admin/rooms/{room_id}", get(admin_room_detail))
        .with_state(state)
}

#[derive(Deserialize)]
struct BootstrapBody {
    display_name: String,
}

#[derive(Serialize)]
struct ApiError {
    code: &'static str,
    message: String,
}

#[derive(Deserialize)]
struct JoinBody {
    session_id: String,
    room_code: String,
}

#[derive(Deserialize)]
struct SnapshotQuery {
    session_id: String,
}

#[derive(Deserialize)]
struct EventsQuery {
    from: i64,
}

#[derive(Deserialize)]
struct AdminLoginBody {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct AdminLoginResp {
    token: String,
}

const ADMIN_TOKEN: &str = "koko-admin-token";

async fn bootstrap_session(
    State(state): State<应用状态>,
    Json(body): Json<BootstrapBody>,
) -> impl IntoResponse {
    let database_url = state.database_url.clone();
    let display_name = body.display_name.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = Pg仓储::连接并迁移(&database_url)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, "system_error", err.to_string()))?;
        usecase::引导匿名会话(&mut repo, &display_name)
            .map_err(|code| map_domain_err_tuple(code))
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::会话 {
            会话标识,
            显示名,
        }) => (StatusCode::OK, Json(serde_json::json!({"session_id": 会话标识, "display_name": 显示名}))).into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

async fn join_or_create_room(
    State(state): State<应用状态>,
    Json(body): Json<JoinBody>,
) -> impl IntoResponse {
    let database_url = state.database_url.clone();
    let session_id = body.session_id.clone();
    let room_code = body.room_code.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = Pg仓储::连接并迁移(&database_url)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, "system_error", err.to_string()))?;
        usecase::按短码进房或建房(&mut repo, &session_id, &room_code)
            .map_err(|code| map_domain_err_tuple(code))
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::房间 {
            房间标识,
            最新事件位置,
        }) => (StatusCode::OK, Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置}))).into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

async fn load_room_snapshot(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(query): Query<SnapshotQuery>,
) -> impl IntoResponse {
    let database_url = state.database_url.clone();
    let session_id = query.session_id.clone();
    let room_id_copy = room_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = Pg仓储::连接并迁移(&database_url)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, "system_error", err.to_string()))?;
        usecase::加载房间快照(&repo, &room_id_copy, &session_id).map_err(|code| map_domain_err_tuple(code))
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::房间 {
            房间标识,
            最新事件位置,
        }) => (StatusCode::OK, Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置}))).into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

async fn load_room_events(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(query): Query<EventsQuery>,
) -> impl IntoResponse {
    let database_url = state.database_url.clone();
    let room_id_copy = room_id.clone();
    let from = query.from;
    let result = task::spawn_blocking(move || {
        let repo = Pg仓储::连接并迁移(&database_url)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, "system_error", err.to_string()))?;
        repo.拉取房间增量事件(&room_id_copy, from)
            .map_err(|code| map_domain_err_tuple(code))
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::房间增量事件 {
            房间标识,
            事件,
            最新事件位置,
        }) => (StatusCode::OK, Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置, "events": events_to_json(事件)}))).into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

async fn admin_login(
    State(state): State<应用状态>,
    Json(body): Json<AdminLoginBody>,
) -> impl IntoResponse {
    if body.username != "admin" || body.password != state.admin_password {
        return err_resp(
            StatusCode::UNAUTHORIZED,
            "admin_auth_failed",
            "管理员账号或密码错误",
        );
    }
    (StatusCode::OK, Json(AdminLoginResp { token: ADMIN_TOKEN.to_string() })).into_response()
}

async fn admin_overview(
    State(state): State<应用状态>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(resp) = require_admin(&headers) {
        return resp;
    }
    let database_url = state.database_url.clone();
    let result = task::spawn_blocking(move || {
        let repo = Pg仓储::连接并迁移(&database_url)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, "system_error", err.to_string()))?;
        repo.后台概览().map_err(|code| map_domain_err_tuple(code))
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::后台概览 {
            房间总数,
            消息总数,
        }) => (StatusCode::OK, Json(serde_json::json!({"room_count": 房间总数, "message_count": 消息总数}))).into_response(),
        Ok(_) => err_resp(StatusCode::INTERNAL_SERVER_ERROR, "system_error", "返回快照类型不匹配"),
        Err(code) => tuple_err_to_resp(code),
    }
}

async fn admin_rooms(
    State(state): State<应用状态>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(resp) = require_admin(&headers) {
        return resp;
    }
    let database_url = state.database_url.clone();
    let result = task::spawn_blocking(move || {
        let repo = Pg仓储::连接并迁移(&database_url)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, "system_error", err.to_string()))?;
        repo.后台房间列表().map_err(|code| map_domain_err_tuple(code))
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::后台房间列表 { 房间标识列表 }) => {
            (StatusCode::OK, Json(serde_json::json!({"rooms": 房间标识列表}))).into_response()
        }
        Ok(_) => err_resp(StatusCode::INTERNAL_SERVER_ERROR, "system_error", "返回快照类型不匹配"),
        Err(code) => tuple_err_to_resp(code),
    }
}

async fn admin_room_detail(
    State(state): State<应用状态>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_admin(&headers) {
        return resp;
    }
    let database_url = state.database_url.clone();
    let room_id_copy = room_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = Pg仓储::连接并迁移(&database_url)
            .map_err(|err| (StatusCode::INTERNAL_SERVER_ERROR, "system_error", err.to_string()))?;
        repo.后台房间详情(&room_id_copy).map_err(|code| map_domain_err_tuple(code))
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::后台房间详情 {
            房间标识,
            最新事件位置,
            消息总数,
        }) => (StatusCode::OK, Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置, "message_count": 消息总数}))).into_response(),
        Ok(_) => err_resp(StatusCode::INTERNAL_SERVER_ERROR, "system_error", "返回快照类型不匹配"),
        Err(code) => tuple_err_to_resp(code),
    }
}

fn events_to_json(events: Vec<contract::领域事件>) -> Vec<serde_json::Value> {
    events
        .into_iter()
        .map(|event| match event {
            contract::领域事件::消息已创建 {
                房间标识,
                消息标识,
                客户端消息标识,
                发送者会话标识,
                文本,
                事件位置,
            } => serde_json::json!({
                "type": "message_created",
                "room_id": 房间标识,
                "message_id": 消息标识,
                "client_message_id": 客户端消息标识,
                "sender_session_id": 发送者会话标识,
                "body": 文本,
                "event_position": 事件位置
            }),
        })
        .collect()
}

fn require_admin(headers: &HeaderMap) -> Result<(), axum::response::Response> {
    let token = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if token == ADMIN_TOKEN {
        Ok(())
    } else {
        Err(err_resp(
            StatusCode::UNAUTHORIZED,
            "admin_session_required",
            "缺少管理员会话",
        ))
    }
}

fn tuple_err_to_resp(tuple: (StatusCode, &'static str, String)) -> axum::response::Response {
    let (status, code, message) = tuple;
    err_resp(status, code, message)
}

fn map_domain_err_tuple(code: contract::错误码) -> (StatusCode, &'static str, String) {
    match code {
        contract::错误码::参数非法 => (
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "请求参数非法".to_string(),
        ),
        contract::错误码::会话无效 => (
            StatusCode::UNAUTHORIZED,
            "invalid_session",
            "会话无效".to_string(),
        ),
        contract::错误码::房间不存在 => (
            StatusCode::NOT_FOUND,
            "room_not_found",
            "房间不存在".to_string(),
        ),
        contract::错误码::成员资格不足 => {
            (
                StatusCode::FORBIDDEN,
                "membership_required",
                "成员资格不足".to_string(),
            )
        }
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "系统错误".to_string(),
        ),
    }
}

fn err_resp(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> axum::response::Response {
    (status, Json(ApiError { code, message: message.into() })).into_response()
}

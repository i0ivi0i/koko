use super::*;
use axum::http::HeaderMap;

/// 后台登录请求体。
///
/// 这是后台冷路径自己的协议表面，不再继续挂在总壳顶部。
#[derive(Deserialize)]
pub(super) struct AdminLoginBody {
    /// 后台用户名，当前固定要求为 admin。
    username: String,
    /// 后台密码，由环境变量注入。
    password: String,
}

/// 后台登录响应。
#[derive(Serialize)]
pub(super) struct AdminLoginResp {
    /// 后台临时令牌（当前最小实现）。
    token: String,
}

/// 第一阶段后台最小令牌。
///
/// 注意：
/// 1. 本期只做壳层拆分，不升级后台会话机制。
/// 2. token 语义必须保持稳定，避免前端后台入口和测试一起漂移。
const ADMIN_TOKEN: &str = "koko-admin-token";

/// 后台最小鉴权校验。
///
/// 这里仍然只做冷路径接入守卫，不把后台会话真相扩大成新的业务子系统。
fn require_admin(headers: &HeaderMap) -> Result<(), (StatusCode, &'static str, &'static str)> {
    let token = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if token == ADMIN_TOKEN {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            "admin_session_required",
            "缺少管理员会话",
        ))
    }
}

/// 后台登录入口。
///
/// 这里只做认证接入，不在这里堆新的后台业务规则。
pub(super) async fn admin_login(
    State(state): State<应用状态>,
    Json(body): Json<AdminLoginBody>,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "管理员登录",
        adapter = "http",
        outcome = "accepted",
        request_kind = "后台登录",
        "HTTP 请求已受理"
    );
    if body.username != "admin" || body.password != state.admin_password {
        tracing::warn!(
            usecase = "管理员登录",
            adapter = "http",
            outcome = "rejected",
            request_kind = "后台登录",
            error_code = "admin_auth_failed",
            "管理员登录被拒绝"
        );
        return super::err_resp(
            StatusCode::UNAUTHORIZED,
            "admin_auth_failed",
            "管理员账号或密码错误",
        );
    }
    tracing::info!(
        usecase = "管理员登录",
        adapter = "http",
        outcome = "succeeded",
        request_kind = "后台登录",
        "管理员登录成功"
    );
    (
        StatusCode::OK,
        Json(AdminLoginResp {
            token: ADMIN_TOKEN.to_string(),
        }),
    )
        .into_response()
}

/// 后台概览查询。
pub(super) async fn admin_overview(
    State(state): State<应用状态>,
    headers: HeaderMap,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "后台概览查询",
        adapter = "http",
        outcome = "accepted",
        request_kind = "后台总览查询",
        "HTTP 请求已受理"
    );
    if let Err((status, code, message)) = require_admin(&headers) {
        tracing::warn!(
            usecase = "后台概览查询",
            adapter = "http",
            outcome = "rejected",
            request_kind = "后台总览查询",
            error_code = code,
            "后台概览查询被拒绝"
        );
        return super::err_resp(status, code, message);
    }
    let state = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = super::构建共享仓储(&state);
        repo.后台概览().map_err(super::map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "后台概览查询",
                adapter = "http",
                outcome = "failed",
                request_kind = "后台总览查询",
                error_code = "system_error",
                error = %err,
                "后台概览查询任务执行失败"
            );
            return super::err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::后台概览 {
            房间总数,
            消息总数,
        }) => {
            tracing::info!(
                usecase = "后台概览查询",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "后台总览查询",
                room_count = 房间总数,
                message_count = 消息总数,
                "后台概览查询成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({"room_count": 房间总数, "message_count": 消息总数})),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "后台概览查询",
                adapter = "http",
                outcome = "failed",
                request_kind = "后台总览查询",
                error_code = "system_error",
                "后台概览查询返回了错误的快照类型"
            );
            super::err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "后台概览查询",
                adapter = "http",
                outcome = "rejected",
                request_kind = "后台总览查询",
                error_code = code,
                "后台概览查询被拒绝"
            );
            super::err_resp(status, code, message)
        }
    }
}

/// 后台房间列表查询。
pub(super) async fn admin_rooms(
    State(state): State<应用状态>,
    headers: HeaderMap,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "后台房间列表查询",
        adapter = "http",
        outcome = "accepted",
        request_kind = "后台房间列表查询",
        "HTTP 请求已受理"
    );
    if let Err((status, code, message)) = require_admin(&headers) {
        tracing::warn!(
            usecase = "后台房间列表查询",
            adapter = "http",
            outcome = "rejected",
            request_kind = "后台房间列表查询",
            error_code = code,
            "后台房间列表查询被拒绝"
        );
        return super::err_resp(status, code, message);
    }
    let state = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = super::构建共享仓储(&state);
        repo.后台房间列表().map_err(super::map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "后台房间列表查询",
                adapter = "http",
                outcome = "failed",
                request_kind = "后台房间列表查询",
                error_code = "system_error",
                error = %err,
                "后台房间列表查询任务执行失败"
            );
            return super::err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::后台房间列表 { 房间标识列表 }) => {
            let room_count = 房间标识列表.len();
            tracing::info!(
                usecase = "后台房间列表查询",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "后台房间列表查询",
                room_count = room_count,
                "后台房间列表查询成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({"rooms": 房间标识列表})),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "后台房间列表查询",
                adapter = "http",
                outcome = "failed",
                request_kind = "后台房间列表查询",
                error_code = "system_error",
                "后台房间列表查询返回了错误的快照类型"
            );
            super::err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "后台房间列表查询",
                adapter = "http",
                outcome = "rejected",
                request_kind = "后台房间列表查询",
                error_code = code,
                "后台房间列表查询被拒绝"
            );
            super::err_resp(status, code, message)
        }
    }
}

/// 后台房间详情查询。
pub(super) async fn admin_room_detail(
    State(state): State<应用状态>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "后台房间详情查询",
        adapter = "http",
        outcome = "accepted",
        request_kind = "后台房间详情查询",
        room_id = room_id.as_str(),
        "HTTP 请求已受理"
    );
    if let Err((status, code, message)) = require_admin(&headers) {
        tracing::warn!(
            usecase = "后台房间详情查询",
            adapter = "http",
            outcome = "rejected",
            request_kind = "后台房间详情查询",
            room_id = room_id,
            error_code = code,
            "后台房间详情查询被拒绝"
        );
        return super::err_resp(status, code, message);
    }
    let state = state.clone();
    let room_id_copy = room_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = super::构建共享仓储(&state);
        repo.后台房间详情(&room_id_copy)
            .map_err(super::map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "后台房间详情查询",
                adapter = "http",
                outcome = "failed",
                request_kind = "后台房间详情查询",
                room_id = room_id,
                error_code = "system_error",
                error = %err,
                "后台房间详情查询任务执行失败"
            );
            return super::err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::后台房间详情 {
            房间标识,
            最新事件位置,
            消息总数,
        }) => {
            tracing::info!(
                usecase = "后台房间详情查询",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "后台房间详情查询",
                room_id = 房间标识,
                event_position = 最新事件位置,
                message_count = 消息总数,
                "后台房间详情查询成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "room_id": 房间标识,
                    "latest_event_position": 最新事件位置,
                    "message_count": 消息总数
                })),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "后台房间详情查询",
                adapter = "http",
                outcome = "failed",
                request_kind = "后台房间详情查询",
                room_id = room_id,
                error_code = "system_error",
                "后台房间详情查询返回了错误的快照类型"
            );
            super::err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "后台房间详情查询",
                adapter = "http",
                outcome = "rejected",
                request_kind = "后台房间详情查询",
                room_id = room_id,
                error_code = code,
                "后台房间详情查询被拒绝"
            );
            super::err_resp(status, code, message)
        }
    }
}

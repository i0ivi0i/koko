use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use socketioxide::{
    extract::{Data, Extension, SocketRef, TryData},
    handler::ConnectHandler,
    BroadcastError, SendError, SocketError, SocketIo,
};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::collections::HashMap;
use tokio::task;
use tower_http::services::{ServeDir, ServeFile};

use crate::{adapter::Pg仓储, contract, usecase};

// 这三个私有子模块是 shell 内部的职责收口点。
// 当前阶段先只建立文件边界和接线路径，真实实现仍暂时留在总壳里，后续任务再逐步迁入。
#[path = "房间外壳.rs"]
mod 房间外壳;
#[path = "后台外壳.rs"]
mod 后台外壳;
#[path = "实时外壳.rs"]
mod 实时外壳;

/// 外壳层共享运行态，只存放“接线所需配置”，不承载业务事实。
#[derive(Clone)]
pub struct 应用状态 {
    pub pool: PgPool,
    pub runtime_handle: tokio::runtime::Handle,
    pub admin_password: String,
}

/// 组装 HTTP 冷路径 + Realtime 热路径路由。
///
/// 分层约束：
/// 1. 这里做协议接线，不做业务裁决。
/// 2. 命令是否成立必须交给 usecase + domain + repository 主链。
/// 3. 前端静态资源同源托管，减少开发期跨域噪音和双端口复杂度。
pub async fn 构建应用状态(
    database_url: String,
    admin_password: String,
) -> std::io::Result<应用状态> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .map_err(|err| std::io::Error::other(format!("连接数据库失败: {err}")))?;

    Ok(应用状态 {
        pool,
        runtime_handle: tokio::runtime::Handle::current(),
        admin_password,
    })
}

pub fn 构建路由(state: 应用状态) -> Router {
    let (socket_layer, io) = SocketIo::new_layer();
    注册realtime命名空间(&io, state.clone());

    Router::new()
        .route("/api/session/bootstrap", post(房间外壳::bootstrap_session))
        .route("/api/rooms/join-or-create", post(房间外壳::join_or_create_room))
        .route("/api/rooms/{room_id}/snapshot", get(房间外壳::load_room_snapshot))
        .route(
            "/api/rooms/{room_id}/read-anchor",
            post(房间外壳::update_room_read_anchor),
        )
        .route("/api/rooms/{room_id}/history", get(房间外壳::load_room_history))
        .route("/api/rooms/{room_id}/events", get(房间外壳::load_room_events))
        .route("/api/admin/login", post(后台外壳::admin_login))
        .route("/api/admin/overview", get(后台外壳::admin_overview))
        .route("/api/admin/rooms", get(后台外壳::admin_rooms))
        .route("/api/admin/rooms/{room_id}", get(后台外壳::admin_room_detail))
        // 前端静态资源由后端同源托管，避免开发态跨域和双端口联调噪音。
        .route_service("/", ServeFile::new("frontend/index.html"))
        .nest_service("/dist", ServeDir::new("frontend/dist"))
        .layer(socket_layer)
        .with_state(state)
}

/// 注册单节点 realtime 命名空间。
/// 约束：连接级认证在 connect middleware 完成，消息 handler 不再相信 payload 身份。
fn 注册realtime命名空间(io: &SocketIo, state: 应用状态) {
    let connect_state = state.clone();
    io.ns(
        "/",
        (move |socket: SocketRef| {
            let state_for_subscribe = state.clone();
            let state_for_send = state.clone();
            async move {
                // 控制面命令：建立订阅与补洞续接。
                socket.on(
                    "subscribe_room_stream",
                    move |s: SocketRef,
                          Extension(auth): Extension<已认证会话>,
                          Data::<RealtimeSubscribeBody>(payload)| {
                        let state = state_for_subscribe.clone();
                        async move {
                            实时外壳::handle_realtime_subscribe(s, auth, payload, state).await;
                        }
                    },
                );

                // 业务热命令：发送文本消息。
                socket.on(
                    "send_text_message",
                    move |s: SocketRef,
                          Extension(auth): Extension<已认证会话>,
                          Data::<RealtimeSendBody>(payload)| {
                        let state = state_for_send.clone();
                        async move {
                            实时外壳::handle_realtime_send(s, auth, payload, state).await;
                        }
                    },
                );
            }
        })
        .with(
            move |socket: SocketRef, TryData(auth): TryData<RealtimeConnectAuth>| {
                let state = connect_state.clone();
                async move { 实时外壳::认证realtime连接(socket, auth, state).await }
            },
        ),
    );
}

/// 共享状态 -> 仓储 的唯一构造入口。
/// 约束：热路径只复用共享连接池，不在 handler 里重复建池。
fn 构建共享仓储(state: &应用状态) -> Pg仓储 {
    Pg仓储::从连接池构建(state.pool.clone(), state.runtime_handle.clone())
}

/// 匿名身份引导请求体：壳层只提交设备入口凭证。
#[derive(Deserialize)]
struct BootstrapBody {
    /// 新 MVP 的设备入口凭证。
    /// 当前 Web 会把它持久化在本地；未来 iOS/Android/CLI 可各自换存储实现。
    device_anonymous_token: Option<String>,
}

/// 统一错误响应体（跨 HTTP 接口稳定结构）。
#[derive(Serialize)]
struct ApiError {
    /// 稳定错误码，供前端逻辑判断。
    code: &'static str,
    /// 可读错误信息，主要用于显示和排障。
    message: String,
}

/// 进房请求体。
#[derive(Deserialize)]
struct JoinBody {
    /// 当前会话标识。
    session_id: String,
    /// 用户输入的房间短码。
    room_code: String,
}

/// 阅读推进请求体。
#[derive(Deserialize)]
struct UpdateReadAnchorBody {
    /// 当前会话标识。
    /// 这里仍使用稳定会话锚点承接调用身份，但最终阅读真相不会挂在 session 上。
    session_id: Option<String>,
    /// 本次确认已读到的最大事件位置。
    /// 它表达“用户阅读已经越过哪里”，不是滚动条像素位置。
    last_read_event_position: Option<i64>,
}

/// 房间快照查询参数。
#[derive(Deserialize)]
struct SnapshotQuery {
    /// 请求方会话标识，用于成员资格校验。
    session_id: String,
}

/// 增量事件查询参数的内部稳定形状。
/// 先用宽松 query map 接住，再手动收口成这个结构，避免 Axum 提前拒绝而绕过项目统一错误 JSON。
struct ParsedEventsQuery {
    /// 请求方会话标识，用于会话有效性与成员资格校验。
    session_id: String,
    /// 从该事件位置之后开始拉取增量。
    from: i64,
}

/// 房间历史分页查询参数的内部稳定形状。
/// 仍然先用宽松 query map 接住，再手动收口成项目自己的错误 JSON。
struct ParsedHistoryQuery {
    /// 请求方会话标识，用于会话有效性与成员资格校验。
    session_id: String,
    /// 只返回严格早于该事件位置的消息。
    before_event_position: i64,
    /// 本页最多返回多少条消息。
    limit: i64,
}

/// 连接握手携带的最小认证数据。
#[derive(Deserialize, Clone)]
struct RealtimeConnectAuth {
    /// 当前连接声明的会话标识。
    session_id: String,
}

/// 存放在 socket extension 内的已认证会话。
#[derive(Clone)]
struct 已认证会话 {
    session_id: String,
}

/// 后台登录请求体（第一阶段最小门禁）。
#[derive(Deserialize)]
struct AdminLoginBody {
    /// 后台用户名，当前固定要求为 admin。
    username: String,
    /// 后台密码，由环境变量注入。
    password: String,
}

/// 后台登录响应。
#[derive(Serialize)]
struct AdminLoginResp {
    /// 后台临时令牌（最小实现）。
    token: String,
}

/// Realtime 订阅命令负载。
#[derive(Deserialize, Clone)]
struct RealtimeSubscribeBody {
    /// 订阅目标房间。
    room_id: String,
    /// 客户端已持有的最新位置，用于增量续接。
    from: i64,
}

/// Realtime 发送消息命令负载。
#[derive(Deserialize, Clone)]
struct RealtimeSendBody {
    /// 目标房间标识。
    room_id: String,
    /// 客户端消息标识（幂等链路锚点）。
    client_message_id: String,
    /// 消息文本原文。
    text: String,
}

/// 第一阶段后台最小令牌（后续可替换为正式会话机制）。
const ADMIN_TOKEN: &str = "koko-admin-token";

/// 冷路径：引导匿名身份。
/// 只做协议解码和结果转码；业务规则在 usecase 层。
async fn bootstrap_session(
    State(state): State<应用状态>,
    Json(body): Json<BootstrapBody>,
) -> impl IntoResponse {
    let Some(device_anonymous_token) = body.device_anonymous_token else {
        tracing::warn!(
            usecase = "引导匿名身份",
            adapter = "http",
            outcome = "rejected",
            request_kind = "匿名身份引导",
            error_code = "invalid_argument",
            "引导匿名身份缺少设备入口凭证"
        );
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 device_anonymous_token",
        );
    };
    // accepted 只说明入口已拿到请求；真正 succeeded 必须等用例给出权威快照后才能记录。
    tracing::info!(
        usecase = "引导匿名身份",
        adapter = "http",
        outcome = "accepted",
        request_kind = "匿名身份引导",
        "HTTP 请求已受理"
    );
    let result = task::spawn_blocking(move || {
        // 统一在阻塞线程做仓储调用，避免在 async 主执行器里直接跑阻塞 IO。
        let mut repo = 构建共享仓储(&state);
        usecase::引导匿名身份(&mut repo, &device_anonymous_token).map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "引导匿名身份",
                adapter = "http",
                outcome = "failed",
                request_kind = "匿名身份引导",
                error_code = "system_error",
                error = %err,
                "引导匿名身份任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(out) => {
            tracing::info!(
                usecase = "引导匿名身份",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "匿名身份引导",
                anonymous_identity_id = out.匿名身份标识,
                session_id = out.会话标识,
                "引导匿名身份成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "anonymous_identity_id": out.匿名身份标识,
                    "display_alias": out.展示花名,
                    // session_id 仍是当前冷/热路径共享的运行锚点，不能因为去旧兼容就丢掉。
                    "session_id": out.会话标识,
                })),
            )
                .into_response()
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "引导匿名身份",
                adapter = "http",
                outcome = "rejected",
                request_kind = "匿名身份引导",
                error_code = code,
                "引导匿名身份被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：按短码进房或建房。
async fn join_or_create_room(
    State(state): State<应用状态>,
    Json(body): Json<JoinBody>,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "按短码进房或建房",
        adapter = "http",
        outcome = "accepted",
        request_kind = "短码进房或建房",
        session_id = body.session_id.as_str(),
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let session_id = body.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let room_code = body.room_code.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::按短码进房或建房(&mut repo, &session_id_for_usecase, &room_code)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "failed",
                request_kind = "短码进房或建房",
                session_id = session_id,
                error_code = "system_error",
                error = %err,
                "按短码进房或建房任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间 {
            房间标识,
            最新事件位置,
            上次已读事件位置,
            首条未读事件位置,
            首屏消息,
            首屏前仍有更早历史,
        }) => {
            tracing::info!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "短码进房或建房",
                session_id = session_id,
                room_id = 房间标识,
                event_position = 最新事件位置,
                "按短码进房或建房成功"
            );
            (
                StatusCode::OK,
                Json(
                    serde_json::json!({
                        "room_id": 房间标识,
                        "latest_event_position": 最新事件位置,
                        "last_read_event_position": 上次已读事件位置,
                        "first_unread_event_position": 首条未读事件位置,
                        "snapshot_messages": events_to_json(首屏消息),
                        "has_more_before": 首屏前仍有更早历史,
                    }),
                ),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "failed",
                request_kind = "短码进房或建房",
                session_id = session_id,
                error_code = "system_error",
                "按短码进房或建房返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "按短码进房或建房",
                adapter = "http",
                outcome = "rejected",
                request_kind = "短码进房或建房",
                session_id = session_id,
                error_code = code,
                "按短码进房或建房被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：加载房间快照（基线）。
async fn load_room_snapshot(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(query): Query<SnapshotQuery>,
) -> impl IntoResponse {
    tracing::info!(
        usecase = "加载房间快照",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间快照查询",
        room_id = room_id.as_str(),
        session_id = query.session_id.as_str(),
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let session_id = query.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let room_id_copy = room_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间快照(&repo, &room_id_copy, &session_id_for_usecase)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间快照查询",
                room_id = room_id,
                session_id = session_id,
                error_code = "system_error",
                error = %err,
                "加载房间快照任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间 {
            房间标识,
            最新事件位置,
            上次已读事件位置,
            首条未读事件位置,
            首屏消息,
            首屏前仍有更早历史,
        }) => {
            tracing::info!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间快照查询",
                room_id = 房间标识,
                session_id = session_id,
                event_position = 最新事件位置,
                "加载房间快照成功"
            );
            (
                StatusCode::OK,
                Json(
                    serde_json::json!({
                        "room_id": 房间标识,
                        "latest_event_position": 最新事件位置,
                        "last_read_event_position": 上次已读事件位置,
                        "first_unread_event_position": 首条未读事件位置,
                        "snapshot_messages": events_to_json(首屏消息),
                        "has_more_before": 首屏前仍有更早历史,
                    }),
                ),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间快照查询",
                room_id = room_id,
                session_id = session_id,
                error_code = "system_error",
                "加载房间快照返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间快照",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间快照查询",
                room_id = room_id,
                session_id = session_id,
                error_code = code,
                "加载房间快照被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：推进房间阅读位置。
/// 约束：
/// 1. 这是独立写接口，不和 join / snapshot / realtime 订阅耦在一起。
/// 2. handler 只负责协议解码和错误转码，不猜“应该推进到哪里”。
/// 3. 阅读真相是否成立，必须交给 usecase + repository 主链裁决。
async fn update_room_read_anchor(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Json(body): Json<UpdateReadAnchorBody>,
) -> impl IntoResponse {
    let Some(session_id) = body
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        tracing::warn!(
            usecase = "推进房间阅读位置",
            adapter = "http",
            outcome = "rejected",
            request_kind = "房间阅读位置推进",
            room_id = room_id.as_str(),
            error_code = "invalid_argument",
            "推进房间阅读位置缺少 session_id"
        );
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        );
    };
    let Some(last_read_event_position) = body.last_read_event_position else {
        tracing::warn!(
            usecase = "推进房间阅读位置",
            adapter = "http",
            outcome = "rejected",
            request_kind = "房间阅读位置推进",
            room_id = room_id.as_str(),
            session_id = session_id.as_str(),
            error_code = "invalid_argument",
            "推进房间阅读位置缺少 last_read_event_position"
        );
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 last_read_event_position",
        );
    };
    tracing::info!(
        usecase = "推进房间阅读位置",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间阅读位置推进",
        room_id = room_id.as_str(),
        session_id = session_id.as_str(),
        event_position = last_read_event_position,
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let room_id_for_usecase = room_id.clone();
    let session_id_for_usecase = session_id.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::推进房间阅读位置(
            &mut repo,
            &room_id_for_usecase,
            &session_id_for_usecase,
            last_read_event_position,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                error_code = "system_error",
                error = %err,
                "推进房间阅读位置任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::命令结果::成功) => {
            tracing::info!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                "推进房间阅读位置成功"
            );
            (StatusCode::OK, Json(serde_json::json!({}))).into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                error_code = "system_error",
                "推进房间阅读位置返回了错误的命令结果类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回命令结果类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "推进房间阅读位置",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间阅读位置推进",
                room_id = room_id,
                session_id = session_id,
                event_position = last_read_event_position,
                error_code = code,
                "推进房间阅读位置被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：按位置拉房间增量事件（补洞兜底）。
async fn load_room_events(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = match parse_events_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间增量事件查询",
                room_id = room_id.as_str(),
                error_code = code,
                "加载房间增量事件缺少必要参数"
            );
            return err_resp(status, code, message);
        }
    };
    tracing::info!(
        usecase = "加载房间增量事件",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间增量事件查询",
        room_id = room_id.as_str(),
        session_id = query.session_id.as_str(),
        from = query.from,
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let room_id_copy = room_id.clone();
    let session_id = query.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let from = query.from;
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间增量事件(&repo, &room_id_copy, &session_id_for_usecase, from)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间增量事件查询",
                room_id = room_id,
                session_id = session_id,
                from = from,
                error_code = "system_error",
                error = %err,
                "加载房间增量事件任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间增量事件 {
            房间标识,
            事件,
            最新事件位置,
        }) => {
            let event_count = 事件.len();
            tracing::info!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间增量事件查询",
                room_id = 房间标识,
                session_id = session_id,
                from = from,
                event_position = 最新事件位置,
                event_count = event_count,
                "加载房间增量事件成功"
            );
            (StatusCode::OK, Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置, "events": events_to_json(事件)}))).into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间增量事件查询",
                room_id = room_id,
                session_id = session_id,
                from = from,
                error_code = "system_error",
                "加载房间增量事件返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间增量事件",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间增量事件查询",
                room_id = room_id,
                session_id = session_id,
                from = from,
                error_code = code,
                "加载房间增量事件被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 冷路径：按顺序锚点加载更早历史页。
/// 语义说明：
/// 1. 这条接口只负责“当前最老这条之前，再拿一页历史”；
/// 2. 它不是 realtime 的替代品，也不改变 events 补洞语义；
/// 3. 成员资格裁决继续统一走用例层。
async fn load_room_history(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = match parse_history_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间历史分页查询",
                room_id = room_id.as_str(),
                error_code = code,
                "加载房间历史页缺少必要参数"
            );
            return err_resp(status, code, message);
        }
    };
    tracing::info!(
        usecase = "加载房间历史页",
        adapter = "http",
        outcome = "accepted",
        request_kind = "房间历史分页查询",
        room_id = room_id.as_str(),
        session_id = query.session_id.as_str(),
        before_event_position = query.before_event_position,
        limit = query.limit,
        "HTTP 请求已受理"
    );
    let state = state.clone();
    let room_id_copy = room_id.clone();
    let session_id = query.session_id.clone();
    let session_id_for_usecase = session_id.clone();
    let before_event_position = query.before_event_position;
    let limit = query.limit;
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间历史页(
            &repo,
            &room_id_copy,
            &session_id_for_usecase,
            before_event_position,
            limit,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间历史分页查询",
                room_id = room_id,
                session_id = session_id,
                before_event_position = before_event_position,
                limit = limit,
                error_code = "system_error",
                error = %err,
                "加载房间历史页任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::房间历史页 { 房间标识, 消息 }) => {
            tracing::info!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "succeeded",
                request_kind = "房间历史分页查询",
                room_id = 房间标识,
                session_id = session_id,
                before_event_position = before_event_position,
                limit = limit,
                "加载房间历史页成功"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "room_id": 房间标识,
                    "messages": events_to_json(消息),
                })),
            )
                .into_response()
        }
        Ok(_) => {
            tracing::error!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "failed",
                request_kind = "房间历史分页查询",
                room_id = room_id,
                session_id = session_id,
                error_code = "system_error",
                "加载房间历史页返回了错误的快照类型"
            );
            err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "返回快照类型不匹配",
            )
        }
        Err((status, code, message)) => {
            tracing::warn!(
                usecase = "加载房间历史页",
                adapter = "http",
                outcome = "rejected",
                request_kind = "房间历史分页查询",
                room_id = room_id,
                session_id = session_id,
                error_code = code,
                "加载房间历史页被拒绝"
            );
            err_resp(status, code, message)
        }
    }
}

/// 后台登录入口（第一阶段最小实现）。
/// 注意：这里只做认证接入，不在这里叠加复杂后台业务逻辑。
async fn admin_login(
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
        return err_resp(
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

/// 后台只读：概览查询。
async fn admin_overview(
    State(state): State<应用状态>, headers: HeaderMap
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
        return err_resp(status, code, message);
    }
    let state = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        repo.后台概览().map_err(map_domain_err_tuple)
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
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };
    match result {
        Ok(contract::快照::后台概览 {
            房间总数, 消息总数
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
            err_resp(
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
            err_resp(status, code, message)
        }
    }
}

/// 后台只读：房间列表查询。
async fn admin_rooms(State(state): State<应用状态>, headers: HeaderMap) -> impl IntoResponse {
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
        return err_resp(status, code, message);
    }
    let state = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        repo.后台房间列表().map_err(map_domain_err_tuple)
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
            return err_resp(
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
            err_resp(
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
            err_resp(status, code, message)
        }
    }
}

/// 后台只读：房间详情查询。
async fn admin_room_detail(
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
        return err_resp(status, code, message);
    }
    let state = state.clone();
    let room_id_copy = room_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        repo.后台房间详情(&room_id_copy)
            .map_err(map_domain_err_tuple)
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
            return err_resp(
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
            (StatusCode::OK, Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置, "message_count": 消息总数}))).into_response()
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
            err_resp(
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
            err_resp(status, code, message)
        }
    }
}

/// 领域事件 -> 传输 JSON 的稳定映射层。
/// 约束：只做字段翻译，不添加业务语义。
fn events_to_json(events: Vec<contract::领域事件>) -> Vec<serde_json::Value> {
    events.into_iter().map(event_to_json).collect()
}

/// 单条领域事件 -> JSON。
fn event_to_json(event: contract::领域事件) -> serde_json::Value {
    match event {
        contract::领域事件::消息已创建 {
            房间标识,
            消息标识,
            客户端消息标识,
            发送者会话标识,
            发送者花名,
            文本,
            事件位置,
        } => serde_json::json!({
            "type": "message_created",
            "room_id": 房间标识,
            "message_id": 消息标识,
            "client_message_id": 客户端消息标识,
            "sender_session_id": 发送者会话标识,
            "sender_display_alias": 发送者花名,
            "body": 文本,
            "event_position": 事件位置
        }),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum 实时发送失败级别 {
    正常断开,
    背压,
    序列化,
    适配器,
}

fn 分类单连接发送失败(err: &SendError) -> 实时发送失败级别 {
    match err {
        SendError::Socket(SocketError::Closed) => 实时发送失败级别::正常断开,
        SendError::Socket(SocketError::InternalChannelFull) => 实时发送失败级别::背压,
        SendError::Serialize(_) => 实时发送失败级别::序列化,
    }
}

fn 分类广播发送失败(err: &BroadcastError) -> 实时发送失败级别 {
    match err {
        BroadcastError::Socket(socket_errors)
            if socket_errors
                .iter()
                .all(|socket_error| matches!(socket_error, SocketError::Closed)) =>
        {
            实时发送失败级别::正常断开
        }
        BroadcastError::Socket(_) => 实时发送失败级别::背压,
        BroadcastError::Serialize(_) => 实时发送失败级别::序列化,
        BroadcastError::Adapter(_) => 实时发送失败级别::适配器,
    }
}

/// connect middleware：把会话认证收口到连接握手。
/// 约束：这里只确认会话存在并写入 socket extension，不裁决房间权限。
async fn 认证realtime连接(
    socket: SocketRef,
    auth: Result<RealtimeConnectAuth, socketioxide::ParserError>,
    state: 应用状态,
) -> Result<(), String> {
    let session_id = match auth {
        Ok(auth) => auth.session_id,
        Err(_) => {
            // 握手载荷不合法属于可预期的接入拒绝，前端会收到 connect_error 再自愈。
            // 这里保留结构化记录，但降成 info，避免把正常拒绝刷成运维告警。
            tracing::info!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "rejected",
                error_code = "invalid_session",
                "realtime 连接认证载荷非法"
            );
            return Err("invalid_session".to_string());
        }
    };
    // 连接认证成功只表示“连接身份成立”；它依然不等于成员资格成立，也不等于任何房间业务成立。
    tracing::info!(
        usecase = "实时连接认证",
        adapter = "socketioxide",
        outcome = "accepted",
        session_id = session_id,
        "realtime 连接认证已受理"
    );
    let state = state.clone();
    let session_id_for_check = session_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::校验实时连接会话(&repo, &session_id_for_check)
    })
    .await;

    match result {
        Ok(Ok(())) => {
            tracing::info!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "succeeded",
                session_id = session_id,
                "realtime 连接认证成功"
            );
            socket.extensions.insert(已认证会话 { session_id });
            Ok(())
        }
        Ok(Err(contract::错误码::会话无效)) => {
            tracing::info!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "rejected",
                session_id = session_id,
                error_code = "invalid_session",
                "realtime 连接认证被拒绝"
            );
            Err("invalid_session".to_string())
        }
        Ok(Err(_)) => {
            tracing::error!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "failed",
                session_id = session_id,
                error_code = "system_error",
                "realtime 连接认证失败"
            );
            Err("system_error".to_string())
        }
        Err(err) => {
            tracing::error!(
                usecase = "实时连接认证",
                adapter = "socketioxide",
                outcome = "failed",
                session_id = session_id,
                error_code = "system_error",
                error = %err,
                "realtime 连接认证任务执行失败"
            );
            Err("system_error".to_string())
        }
    }
}

/// Realtime 控制面：订阅房间事件流。
///
/// 语义分离约束：
/// - control_result 仅承载订阅结果/错误，不代表领域事实。
/// - room_events 仅承载已成立领域事件。
async fn handle_realtime_subscribe(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeSubscribeBody,
    state: 应用状态,
) {
    tracing::info!(
        usecase = "订阅房间事件流",
        adapter = "socketioxide",
        outcome = "accepted",
        room_id = payload.room_id.as_str(),
        session_id = auth.session_id.as_str(),
        from = payload.from,
        "realtime 订阅请求已受理"
    );
    let room_id = payload.room_id.clone();
    let from = payload.from;
    let session_id = auth.session_id.clone();
    let state = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间增量事件(&repo, &room_id, &session_id, from)
            .map_err(map_domain_err_tuple)
    })
    .await;

    match result {
        Ok(Ok(contract::快照::房间增量事件 {
            房间标识,
            事件,
            最新事件位置,
        })) => {
            if from > 最新事件位置 {
                tracing::info!(
                    usecase = "订阅房间事件流",
                    adapter = "socketioxide",
                    outcome = "recovered",
                    room_id = 房间标识,
                    session_id = auth.session_id,
                    expected_position = from,
                    latest_event_position = 最新事件位置,
                    "订阅锚点超前，要求客户端回退到 HTTP 快照"
                );
                let control = serde_json::json!({
                    "kind": "need_snapshot_reload",
                    "room_id": 房间标识,
                    "expected_position": from,
                });
                if let Err(err) = socket.emit("control_result", &control) {
                    tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "emit_failed",
                        error = %err,
                        "订阅恢复控制消息发送失败"
                    );
                }
                return;
            }
            socket.join(房间标识.clone());
            // 先发控制面结果，再发领域事件列表，便于前端分通道处理。
            let control = serde_json::json!({
                "kind": "subscribed",
                "room_id": 房间标识,
                "from": from,
                "latest_event_position": 最新事件位置
            });
            let events_json = serde_json::json!({
                "room_id": 房间标识,
                "latest_event_position": 最新事件位置,
                "events": events_to_json(事件)
            });
            if let Err(err) = socket.emit("control_result", &control) {
                match 分类单连接发送失败(&err) {
                    实时发送失败级别::正常断开 => tracing::info!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "dropped",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_closed",
                        error = %err,
                        "订阅控制消息在连接关闭后被丢弃"
                    ),
                    实时发送失败级别::背压 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_backpressure",
                        error = %err,
                        "订阅控制消息发送失败：socket 内部通道已满"
                    ),
                    实时发送失败级别::序列化 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "serialize_failed",
                        error = %err,
                        "订阅控制消息序列化失败"
                    ),
                    实时发送失败级别::适配器 => unreachable!("单连接发送不应出现 adapter 级错误"),
                }
                return;
            }
            if let Err(err) = socket.emit("room_events", &events_json) {
                match 分类单连接发送失败(&err) {
                    实时发送失败级别::正常断开 => tracing::info!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "dropped",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_closed",
                        error = %err,
                        "订阅增量事件在连接关闭后被丢弃"
                    ),
                    实时发送失败级别::背压 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "socket_backpressure",
                        error = %err,
                        "订阅增量事件发送失败：socket 内部通道已满"
                    ),
                    实时发送失败级别::序列化 => tracing::error!(
                        usecase = "订阅房间事件流",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = payload.room_id,
                        session_id = auth.session_id,
                        from = from,
                        error_code = "serialize_failed",
                        error = %err,
                        "订阅增量事件序列化失败"
                    ),
                    实时发送失败级别::适配器 => unreachable!("单连接发送不应出现 adapter 级错误"),
                }
                return;
            }
            tracing::info!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "succeeded",
                room_id = 房间标识,
                session_id = auth.session_id,
                from = from,
                event_position = 最新事件位置,
                "订阅房间事件流成功"
            );
        }
        Ok(Ok(_)) => {
            tracing::error!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = "system_error",
                "订阅返回了错误的快照类型"
            );
            let payload = serde_json::json!({"kind":"error","code":"system_error","message":"快照类型不匹配"});
            let _ = socket.emit("control_result", &payload);
        }
        Ok(Err((_, code, message))) => {
            // 订阅被拒绝是协议层的正常负反馈，真正异常应由 failed/backpressure 去承载。
            tracing::info!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "rejected",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = code,
                "订阅房间事件流被拒绝"
            );
            let payload = serde_json::json!({"kind":"rejected","code":code,"message":message});
            let _ = socket.emit("control_result", &payload);
        }
        Err(err) => {
            tracing::error!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
                error_code = "system_error",
                error = %err,
                "订阅房间事件流任务执行失败"
            );
            let payload = serde_json::json!({"kind":"error","code":"system_error","message": format!("任务执行失败: {err}")});
            let _ = socket.emit("control_result", &payload);
        }
    }
}

/// Realtime 业务命令：发送文本消息。
///
/// 语义分离约束：
/// - room_event 仅在“消息已成立”后发出。
/// - 命令拒绝和系统错误走 control_result。
async fn handle_realtime_send(
    socket: SocketRef,
    auth: 已认证会话,
    payload: RealtimeSendBody,
    state: 应用状态,
) {
    tracing::info!(
        usecase = "发送文本消息",
        adapter = "socketioxide",
        outcome = "accepted",
        room_id = payload.room_id.as_str(),
        session_id = auth.session_id.as_str(),
        client_message_id = payload.client_message_id.as_str(),
        "realtime 发送请求已受理"
    );
    let state = state.clone();
    let session_id = auth.session_id.clone();
    let room_id_for_log = payload.room_id.clone();
    let client_message_id_for_log = payload.client_message_id.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::发送文本消息(
            &mut repo,
            &payload.room_id,
            &session_id,
            &payload.client_message_id,
            &payload.text,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;

    match result {
        Ok(Ok(event)) => {
            // 只有用例链路返回领域事件，才表示消息真的成立。
            let (room_id, client_message_id, event_position) = match &event {
                contract::领域事件::消息已创建 {
                    房间标识,
                    客户端消息标识,
                    事件位置,
                    ..
                } => (房间标识.clone(), 客户端消息标识.clone(), *事件位置),
            };
            let payload = event_to_json(event);
            if let Err(err) = socket
                .within(room_id.clone())
                .emit("room_event", &payload)
                .await
            {
                match 分类广播发送失败(&err) {
                    实时发送失败级别::正常断开 => tracing::info!(
                        usecase = "发送文本消息",
                        adapter = "socketioxide",
                        outcome = "dropped",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "socket_closed",
                        error = %err,
                        "房间权威事件在连接关闭后被丢弃"
                    ),
                    实时发送失败级别::背压 => tracing::error!(
                        usecase = "发送文本消息",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "socket_backpressure",
                        error = %err,
                        "房间权威事件广播失败：存在 socket 内部通道已满"
                    ),
                    实时发送失败级别::序列化 => tracing::error!(
                        usecase = "发送文本消息",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "serialize_failed",
                        error = %err,
                        "房间权威事件广播失败：事件序列化失败"
                    ),
                    实时发送失败级别::适配器 => tracing::error!(
                        usecase = "发送文本消息",
                        adapter = "socketioxide",
                        outcome = "failed",
                        room_id = room_id,
                        session_id = auth.session_id,
                        client_message_id = client_message_id,
                        error_code = "adapter_failed",
                        error = %err,
                        "房间权威事件广播失败：adapter 层出错"
                    ),
                }
            } else {
                // succeeded 只能在“权威事件已成立且广播实际成功”之后记录，避免把本地 pending/ack 冒充消息成立。
                tracing::info!(
                    usecase = "发送文本消息",
                    adapter = "socketioxide",
                    outcome = "succeeded",
                    room_id = room_id,
                    session_id = auth.session_id,
                    client_message_id = client_message_id,
                    event_position = event_position,
                    "发送文本消息成功"
                );
            }
        }
        Ok(Err((_, code, message))) => {
            // 业务拒绝会通过 control_result 明确反馈给发送端，这不该冒充系统告警。
            tracing::info!(
                usecase = "发送文本消息",
                adapter = "socketioxide",
                outcome = "rejected",
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error_code = code,
                "发送文本消息被拒绝"
            );
            let payload = serde_json::json!({"kind":"rejected","code":code,"message":message});
            let _ = socket.emit("control_result", &payload);
        }
        Err(err) => {
            tracing::error!(
                usecase = "发送文本消息",
                adapter = "socketioxide",
                outcome = "failed",
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error_code = "system_error",
                error = %err,
                "发送文本消息任务执行失败"
            );
            let payload = serde_json::json!({"kind":"error","code":"system_error","message": format!("任务执行失败: {err}")});
            let _ = socket.emit("control_result", &payload);
        }
    }
}

#[cfg(test)]
mod 外壳测试 {
    use super::{分类单连接发送失败, 分类广播发送失败, 实时发送失败级别};
    use socketioxide::{BroadcastError, SendError, SocketError};

    #[test]
    fn 单连接发送到已关闭socket时降级为正常断开() {
        let level = 分类单连接发送失败(&SendError::Socket(SocketError::Closed));
        assert_eq!(level, 实时发送失败级别::正常断开);
    }

    #[test]
    fn 广播里只要出现内部通道已满就归类为背压() {
        let level = 分类广播发送失败(&BroadcastError::Socket(vec![
            SocketError::Closed,
            SocketError::InternalChannelFull,
        ]));
        assert_eq!(level, 实时发送失败级别::背压);
    }
}

/// 后台最小鉴权校验。
/// 返回轻量错误元组，避免返回巨大 Response 造成 clippy result_large_err。
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

/// 领域错误码 -> HTTP 状态码 + 稳定错误码的映射表。
/// 约束：这里不做领域判断，只做“已得到错误码”的协议转码。
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
        contract::错误码::成员资格不足 => (
            StatusCode::FORBIDDEN,
            "membership_required",
            "成员资格不足".to_string(),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "系统错误".to_string(),
        ),
    }
}

/// 先把宽松 query map 收口成稳定内部参数。
/// 这样 handler 可以自己决定缺参和格式错误的 JSON 语义，而不是让框架提前返回非项目格式。
fn parse_events_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedEventsQuery, (StatusCode, &'static str, &'static str)> {
    let Some(session_id) = raw_query
        .get("session_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ));
    };
    let Some(from_raw) = raw_query
        .get("from")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "缺少 from"));
    };
    let Ok(from) = from_raw.parse::<i64>() else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "from 必须是整数",
        ));
    };
    Ok(ParsedEventsQuery {
        session_id: session_id.to_string(),
        from,
    })
}

/// 先把宽松 query map 收口成历史分页的稳定内部参数。
/// 这样缺参、非法参数和业务拒绝都还能走项目统一错误语义。
fn parse_history_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedHistoryQuery, (StatusCode, &'static str, &'static str)> {
    let Some(session_id) = raw_query
        .get("session_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ));
    };
    let Some(before_raw) = raw_query
        .get("before_event_position")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 before_event_position",
        ));
    };
    let Some(limit_raw) = raw_query
        .get("limit")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "缺少 limit"));
    };
    let Ok(before_event_position) = before_raw.parse::<i64>() else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "before_event_position 必须是整数",
        ));
    };
    let Ok(limit) = limit_raw.parse::<i64>() else {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "limit 必须是整数"));
    };
    Ok(ParsedHistoryQuery {
        session_id: session_id.to_string(),
        before_event_position,
        limit,
    })
}

/// 统一 API 错误响应构造器。
fn err_resp(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
) -> axum::response::Response {
    (
        status,
        Json(ApiError {
            code,
            message: message.into(),
        }),
    )
        .into_response()
}

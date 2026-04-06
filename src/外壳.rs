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
    SocketIo,
};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tokio::task;
use tower_http::services::{ServeDir, ServeFile};

use crate::{adapter::Pg仓储, contract, usecase};

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
        .route("/api/session/bootstrap", post(bootstrap_session))
        .route("/api/rooms/join-or-create", post(join_or_create_room))
        .route("/api/rooms/{room_id}/snapshot", get(load_room_snapshot))
        .route("/api/rooms/{room_id}/events", get(load_room_events))
        .route("/api/admin/login", post(admin_login))
        .route("/api/admin/overview", get(admin_overview))
        .route("/api/admin/rooms", get(admin_rooms))
        .route("/api/admin/rooms/{room_id}", get(admin_room_detail))
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
                            handle_realtime_subscribe(s, auth, payload, state).await;
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
                            handle_realtime_send(s, auth, payload, state).await;
                        }
                    },
                );
            }
        })
        .with(
            move |socket: SocketRef, TryData(auth): TryData<RealtimeConnectAuth>| {
                let state = connect_state.clone();
                async move { 认证realtime连接(socket, auth, state).await }
            },
        ),
    );
}

/// 共享状态 -> 仓储 的唯一构造入口。
/// 约束：热路径只复用共享连接池，不在 handler 里重复建池。
fn 构建共享仓储(state: &应用状态) -> Pg仓储 {
    Pg仓储::从连接池构建(state.pool.clone(), state.runtime_handle.clone())
}

/// 引导会话请求体：壳层只提交展示名意图。
#[derive(Deserialize)]
struct BootstrapBody {
    /// 新 MVP 的设备入口凭证。
    /// 当前 Web 会把它持久化在本地；未来 iOS/Android/CLI 可各自换存储实现。
    device_anonymous_token: Option<String>,
    /// 会话展示名（业务上允许匿名名，具体规则由后端决定）。
    ///
    /// 兼容说明：
    /// 这是旧 Web 壳仍在使用的过渡字段。等 Task 3 切到设备级匿名身份后应被淘汰。
    display_name: Option<String>,
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

/// 房间快照查询参数。
#[derive(Deserialize)]
struct SnapshotQuery {
    /// 请求方会话标识，用于成员资格校验。
    session_id: String,
}

/// 增量事件查询参数。
#[derive(Deserialize)]
struct EventsQuery {
    /// 从该事件位置之后开始拉取增量。
    from: i64,
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

/// 冷路径：引导匿名会话。
/// 只做协议解码和结果转码；业务规则在 usecase 层。
async fn bootstrap_session(
    State(state): State<应用状态>,
    Json(body): Json<BootstrapBody>,
) -> impl IntoResponse {
    if let Some(device_anonymous_token) = body.device_anonymous_token.clone() {
        let state = state.clone();
        let result = task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state);
            usecase::引导匿名身份(&mut repo, &device_anonymous_token).map_err(map_domain_err_tuple)
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
        return match result {
            Ok(out) => {
                let alias = out.展示花名.clone();
                (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "anonymous_identity_id": out.匿名身份标识,
                        "display_alias": alias,
                        // 兼容当前冷路径和 realtime 主链：继续返回 session_id。
                        "session_id": out.会话标识,
                        "display_name": out.展示花名,
                    })),
                )
                    .into_response()
            }
            Err(code) => tuple_err_to_resp(code),
        };
    }

    let state = state.clone();
    let Some(display_name) = body.display_name.clone() else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 device_anonymous_token 或 display_name",
        );
    };
    let result = task::spawn_blocking(move || {
        // 统一在阻塞线程做仓储调用，避免在 async 主执行器里直接跑阻塞 IO。
        let mut repo = 构建共享仓储(&state);
        usecase::引导匿名会话(&mut repo, &display_name).map_err(map_domain_err_tuple)
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
            会话标识, 显示名
        }) => (
            StatusCode::OK,
            Json(serde_json::json!({"session_id": 会话标识, "display_name": 显示名})),
        )
            .into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

/// 冷路径：按短码进房或建房。
async fn join_or_create_room(
    State(state): State<应用状态>,
    Json(body): Json<JoinBody>,
) -> impl IntoResponse {
    let state = state.clone();
    let session_id = body.session_id.clone();
    let room_code = body.room_code.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        usecase::按短码进房或建房(&mut repo, &session_id, &room_code).map_err(map_domain_err_tuple)
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
        }) => (
            StatusCode::OK,
            Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置})),
        )
            .into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

/// 冷路径：加载房间快照（基线）。
async fn load_room_snapshot(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(query): Query<SnapshotQuery>,
) -> impl IntoResponse {
    let state = state.clone();
    let session_id = query.session_id.clone();
    let room_id_copy = room_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::加载房间快照(&repo, &room_id_copy, &session_id).map_err(map_domain_err_tuple)
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
        }) => (
            StatusCode::OK,
            Json(serde_json::json!({"room_id": 房间标识, "latest_event_position": 最新事件位置})),
        )
            .into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

/// 冷路径：按位置拉房间增量事件（补洞兜底）。
async fn load_room_events(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(query): Query<EventsQuery>,
) -> impl IntoResponse {
    let state = state.clone();
    let room_id_copy = room_id.clone();
    let from = query.from;
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        repo.拉取房间增量事件(&room_id_copy, from)
            .map_err(map_domain_err_tuple)
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

/// 后台登录入口（第一阶段最小实现）。
/// 注意：这里只做认证接入，不在这里叠加复杂后台业务逻辑。
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
    if let Err((status, code, message)) = require_admin(&headers) {
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
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::后台概览 {
            房间总数, 消息总数
        }) => (
            StatusCode::OK,
            Json(serde_json::json!({"room_count": 房间总数, "message_count": 消息总数})),
        )
            .into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

/// 后台只读：房间列表查询。
async fn admin_rooms(State(state): State<应用状态>, headers: HeaderMap) -> impl IntoResponse {
    if let Err((status, code, message)) = require_admin(&headers) {
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
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            )
        }
    };
    match result {
        Ok(contract::快照::后台房间列表 { 房间标识列表 }) => (
            StatusCode::OK,
            Json(serde_json::json!({"rooms": 房间标识列表})),
        )
            .into_response(),
        Ok(_) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "返回快照类型不匹配",
        ),
        Err(code) => tuple_err_to_resp(code),
    }
}

/// 后台只读：房间详情查询。
async fn admin_room_detail(
    State(state): State<应用状态>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    if let Err((status, code, message)) = require_admin(&headers) {
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

/// 领域事件 -> 传输 JSON 的稳定映射层。
/// 约束：只做字段翻译，不添加业务语义。
fn events_to_json(events: Vec<contract::领域事件>) -> Vec<serde_json::Value> {
    events
        .into_iter()
        .map(|event| match event {
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
        })
        .collect()
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

/// connect middleware：把会话认证收口到连接握手。
/// 约束：这里只确认会话存在并写入 socket extension，不裁决房间权限。
async fn 认证realtime连接(
    socket: SocketRef,
    auth: Result<RealtimeConnectAuth, socketioxide::ParserError>,
    state: 应用状态,
) -> Result<(), String> {
    let session_id = auth.map_err(|_| "invalid_session".to_string())?.session_id;
    let state = state.clone();
    let session_id_for_check = session_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::校验实时连接会话(&repo, &session_id_for_check)
    })
    .await
    .map_err(|err| format!("system_error:{err}"))?;

    match result {
        Ok(()) => {
            socket.extensions.insert(已认证会话 { session_id });
            Ok(())
        }
        Err(contract::错误码::会话无效) => Err("invalid_session".to_string()),
        Err(_) => Err("system_error".to_string()),
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
    let room_id = payload.room_id.clone();
    let from = payload.from;
    let session_id = auth.session_id.clone();
    let state = state.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state);
        usecase::校验房间订阅资格(&repo, &room_id, &session_id).map_err(map_domain_err_tuple)?;
        repo.拉取房间增量事件(&room_id, from)
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
                tracing::warn!(
                    usecase = "订阅房间事件流",
                    adapter = "socketioxide",
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
                let _ = socket.emit("control_result", &control);
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
            let _ = socket.emit("control_result", &control);
            let _ = socket.emit("room_events", &events_json);
        }
        Ok(Ok(_)) => {
            tracing::error!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
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
            tracing::warn!(
                usecase = "订阅房间事件流",
                adapter = "socketioxide",
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
                room_id = payload.room_id,
                session_id = auth.session_id,
                from = from,
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
            let (room_id, client_message_id) = match &event {
                contract::领域事件::消息已创建 {
                    房间标识,
                    客户端消息标识,
                    ..
                } => (房间标识.clone(), 客户端消息标识.clone()),
            };
            let payload = event_to_json(event);
            if let Err(err) = socket
                .within(room_id.clone())
                .emit("room_event", &payload)
                .await
            {
                tracing::error!(
                    usecase = "发送文本消息",
                    adapter = "socketioxide",
                    room_id = room_id,
                    session_id = auth.session_id,
                    client_message_id = client_message_id,
                    error = %err,
                    "房间权威事件广播失败"
                );
            }
        }
        Ok(Err((_, code, message))) => {
            tracing::warn!(
                usecase = "发送文本消息",
                adapter = "socketioxide",
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
                room_id = room_id_for_log,
                session_id = auth.session_id,
                client_message_id = client_message_id_for_log,
                error = %err,
                "发送文本消息任务执行失败"
            );
            let payload = serde_json::json!({"kind":"error","code":"system_error","message": format!("任务执行失败: {err}")});
            let _ = socket.emit("control_result", &payload);
        }
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

/// 统一把 (status, code, message) 错误元组转为标准 API 错误响应。
fn tuple_err_to_resp(tuple: (StatusCode, &'static str, String)) -> axum::response::Response {
    let (status, code, message) = tuple;
    err_resp(status, code, message)
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

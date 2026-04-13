use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderValue, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use object_store::{
    aws::{AmazonS3, AmazonS3Builder},
    local::LocalFileSystem,
    path::Path as ObjectPath,
    ObjectStore, ObjectStoreExt,
};
use serde::{Deserialize, Serialize};
use socketioxide::{
    extract::{Data, Extension, SocketRef, TryData},
    handler::ConnectHandler,
    SocketIo,
};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::{
    fs, io,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::response::SetResponseHeaderLayer,
};

use crate::{adapter::Pg仓储, contract};

// 这三个私有子模块是 shell 内部的职责收口点。
// 总壳只保留装配与公共转码，具体协议逻辑分别沉到对应子模块。
#[path = "后台外壳.rs"]
mod 后台外壳;
#[path = "实时外壳.rs"]
mod 实时外壳;
#[path = "媒体内容解析.rs"]
mod 媒体内容解析;
#[path = "房间外壳.rs"]
mod 房间外壳;

/// 外壳层共享运行态，只存放“接线所需配置”，不承载业务事实。
#[derive(Clone)]
pub struct 应用状态 {
    pub pool: PgPool,
    pub runtime_handle: tokio::runtime::Handle,
    pub admin_password: String,
    pub attachment_storage_dir: String,
    pub attachment_store: Arc<dyn ObjectStore>,
    pub ffmpeg_bin: String,
    pub ffprobe_bin: String,
    pub shaka_packager_bin: String,
    pub swarm_tracker_public_url: String,
    pub swarm_tracker_port: u16,
    pub swarm_web_seed_public_endpoint: Option<String>,
    pub swarm_peer_presence_stale_seconds: i64,
    pub rustus_public_endpoint: Option<String>,
    pub rustus_server_port: u16,
    pub rustus_url: String,
    pub rustus_data_dir: String,
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
    let media_storage = crate::assembly::读取媒体存储配置()?;
    let media_packaging = crate::assembly::读取媒体打包配置();
    let swarm = crate::assembly::读取协作分发配置()?;
    let rustus = crate::assembly::读取rustus配置()?;
    let attachment_storage_dir = crate::assembly::读取附件存储目录();
    fs::create_dir_all(&rustus.data_dir)
        .map_err(|err| std::io::Error::other(format!("创建 Rustus data dir 失败: {err}")))?;
    let attachment_store = 构建附件对象存储(&media_storage, &attachment_storage_dir)?;
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .map_err(|err| std::io::Error::other(format!("连接数据库失败: {err}")))?;

    Ok(应用状态 {
        pool,
        runtime_handle: tokio::runtime::Handle::current(),
        admin_password,
        attachment_storage_dir,
        attachment_store,
        ffmpeg_bin: media_packaging.ffmpeg_bin,
        ffprobe_bin: media_packaging.ffprobe_bin,
        shaka_packager_bin: media_packaging.shaka_packager_bin,
        swarm_tracker_public_url: swarm.tracker_public_url,
        swarm_tracker_port: swarm.tracker_port,
        swarm_web_seed_public_endpoint: swarm.web_seed_public_endpoint,
        swarm_peer_presence_stale_seconds: swarm.peer_presence_stale_seconds,
        rustus_public_endpoint: rustus.public_endpoint,
        rustus_server_port: rustus.server_port,
        rustus_url: rustus.url,
        rustus_data_dir: rustus.data_dir,
    })
}

/// 执行一次媒体原始冷源清理：
/// 1. 应用层先给出“哪些原始对象该删了”；
/// 2. 壳层真正删除对象存储里的 raw original；
/// 3. 删除成功后再把 `origin_deleted_at` 回写到附件真相。
///
/// 这样 24 小时规则就不再只是一个时间戳约定，而会真的落成“对象退场 + 真相留痕”的闭环。
pub async fn 执行一次媒体冷源清理(state: 应用状态) -> io::Result<()> {
    let 当前时间戳秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let state_for_query = state.clone();
    let 待清理冷源 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        crate::usecase::列出待清理媒体冷源(&repo, 当前时间戳秒, 128)
            .map_err(|err| io::Error::other(format!("查询待清理媒体冷源失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("冷源清理查询任务失败: {err}")))??;

    for 冷源 in 待清理冷源 {
        let object_path = ObjectPath::from(冷源.原始内容存储键.as_str());
        match state.attachment_store.delete(&object_path).await {
            Ok(_) | Err(object_store::Error::NotFound { .. }) => {}
            Err(err) => {
                tracing::error!(
                    usecase = "媒体冷源清理",
                    adapter = "shell",
                    outcome = "failed",
                    attachment_id = 冷源.附件标识.as_str(),
                    storage_key = 冷源.原始内容存储键.as_str(),
                    error = %err,
                    "删除原始冷源对象失败"
                );
                continue;
            }
        }

        let state_for_mark = state.clone();
        let attachment_id = 冷源.附件标识.clone();
        tokio::task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state_for_mark);
            crate::usecase::标记媒体冷源已删除(&mut repo, &attachment_id, 当前时间戳秒)
                .map_err(|err| io::Error::other(format!("标记媒体冷源已删除失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("冷源清理写回任务失败: {err}")))??;
    }

    Ok(())
}

/// 统一装配附件对象存储：
/// - local 继续服务测试与回滚窗；
/// - s3 兼容模式只负责 canonical 附件对象读写，不再承担浏览器直传签名。
fn 构建附件对象存储(
    media_storage: &crate::assembly::媒体存储配置,
    attachment_storage_dir: &str,
) -> std::io::Result<Arc<dyn ObjectStore>> {
    match media_storage.驱动 {
        crate::assembly::媒体存储驱动::本地目录 => {
            fs::create_dir_all(attachment_storage_dir)
                .map_err(|err| std::io::Error::other(format!("创建附件目录失败: {err}")))?;
            let attachment_store = LocalFileSystem::new_with_prefix(attachment_storage_dir)
                .map_err(|err| std::io::Error::other(format!("初始化附件存储失败: {err}")))?;
            Ok(Arc::new(attachment_store))
        }
        crate::assembly::媒体存储驱动::S3兼容 => {
            let bucket = media_storage.bucket.as_deref().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "缺少 MEDIA_STORAGE_BUCKET",
                )
            })?;
            let access_key_id = media_storage.access_key_id.as_deref().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "缺少 MEDIA_STORAGE_ACCESS_KEY_ID",
                )
            })?;
            let secret_access_key =
                media_storage.secret_access_key.as_deref().ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "缺少 MEDIA_STORAGE_SECRET_ACCESS_KEY",
                    )
                })?;

            let store = 构建_s3客户端(
                media_storage.endpoint.as_deref(),
                bucket,
                media_storage.region.as_str(),
                access_key_id,
                secret_access_key,
                media_storage.path_style,
            )?;
            Ok(Arc::new(store))
        }
    }
}

fn 构建_s3客户端(
    endpoint: Option<&str>,
    bucket: &str,
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
    path_style: bool,
) -> std::io::Result<AmazonS3> {
    let mut builder = AmazonS3Builder::new()
        .with_region(region)
        .with_bucket_name(bucket)
        .with_access_key_id(access_key_id)
        .with_secret_access_key(secret_access_key)
        .with_virtual_hosted_style_request(!path_style);
    if let Some(endpoint) = endpoint {
        builder = builder.with_endpoint(endpoint);
        if endpoint.starts_with("http://") {
            builder = builder.with_allow_http(true);
        }
    }
    builder
        .build()
        .map_err(|err| std::io::Error::other(format!("初始化 S3 兼容对象存储失败: {err}")))
}

pub fn 构建路由(state: 应用状态) -> Router {
    let (socket_layer, io) = SocketIo::new_layer();
    注册realtime命名空间(&io, state.clone());

    Router::new()
        .route("/api/session/bootstrap", post(房间外壳::bootstrap_session))
        .route(
            "/api/rooms/join-or-create",
            post(房间外壳::join_or_create_room),
        )
        .route(
            "/api/media/{attachment_kind}/prepare",
            post(房间外壳::prepare_media_upload),
        )
        .route(
            "/api/media/{attachment_id}/complete",
            post(房间外壳::complete_media_upload),
        )
        .route("/internal/rustus/hooks", post(房间外壳::handle_rustus_hook))
        .route(
            "/api/media/{attachment_id}/locator",
            get(房间外壳::load_media_locator),
        )
        .route(
            "/api/media/{attachment_id}/blob/{asset_variant}",
            get(房间外壳::load_blob_asset_content),
        )
        .route(
            "/api/media/{attachment_id}/stream/{*asset_path}",
            get(房间外壳::load_streaming_asset_content),
        )
        .route(
            "/api/media/{attachment_id}/torrent",
            get(房间外壳::load_media_torrent),
        )
        .route(
            "/api/media/{attachment_id}/presence",
            post(房间外壳::update_media_distribution_presence),
        )
        .route(
            "/api/attachments/{attachment_id}/content",
            get(房间外壳::load_attachment_content),
        )
        .route(
            "/api/rooms/{room_id}/snapshot",
            get(房间外壳::load_room_snapshot),
        )
        .route(
            "/api/rooms/{room_id}/read-anchor",
            post(房间外壳::update_room_read_anchor),
        )
        .route(
            "/api/rooms/{room_id}/history",
            get(房间外壳::load_room_history),
        )
        .route(
            "/api/rooms/{room_id}/events",
            get(房间外壳::load_room_events),
        )
        .route("/api/admin/login", post(后台外壳::admin_login))
        .route("/api/admin/overview", get(后台外壳::admin_overview))
        .route("/api/admin/rooms", get(后台外壳::admin_rooms))
        .route(
            "/api/admin/rooms/{room_id}",
            get(后台外壳::admin_room_detail),
        )
        .merge(构建前端静态资源路由())
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(socket_layer)
        .with_state(state)
}

fn 构建前端静态资源路由() -> Router<应用状态> {
    let html_router = Router::<应用状态>::new()
        // 入口 HTML 必须始终回源确认最新 manifest。
        // 只有这样，浏览器才能持续拿到当前这轮构建对应的 hashed 资源 URL。
        .route("/", get(load_frontend_index))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));
    let media_service_worker_router = Router::<应用状态>::new()
        .route_service("/media-sw.js", ServeFile::new("frontend/dist/media-sw.js"))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("service-worker-allowed"),
            HeaderValue::from_static("/"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));
    let assets_router = Router::<应用状态>::new()
        // 带 hash 的静态资源 URL 已经自带内容指纹。
        // 因此这里改成长期强缓存，避免继续让移动端在每个子资源上反复回源。
        .nest_service("/dist", ServeDir::new("frontend/dist"))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));
    html_router
        .merge(media_service_worker_router)
        .merge(assets_router)
}

#[derive(Deserialize)]
struct 前端静态资源清单 {
    app_js: String,
    app_css: String,
}

fn 读取前端静态资源清单() -> Result<前端静态资源清单, String> {
    let raw = fs::read_to_string("frontend/dist/asset-manifest.json")
        .map_err(|err| format!("读取前端静态资源清单失败: {err}"))?;
    serde_json::from_str::<前端静态资源清单>(&raw)
        .map_err(|err| format!("解析前端静态资源清单失败: {err}"))
}

fn 渲染前端入口_html() -> Result<String, String> {
    let template = fs::read_to_string("frontend/index.html")
        .map_err(|err| format!("读取前端入口模板失败: {err}"))?;
    let manifest = 读取前端静态资源清单()?;
    Ok(template
        .replace("{{APP_CSS_PATH}}", manifest.app_css.as_str())
        .replace("{{APP_JS_PATH}}", manifest.app_js.as_str()))
}

async fn load_frontend_index() -> impl IntoResponse {
    match 渲染前端入口_html() {
        Ok(html) => Html(html).into_response(),
        Err(err) => err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("渲染前端入口失败: {err}"),
        ),
    }
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
                socket.on_disconnect(|s: SocketRef, reason| async move {
                    实时外壳::记录realtime断开(s, reason);
                });

                // 控制面命令：建立订阅与补洞续接。
                socket.on(
                    "subscribe_room_stream",
                    move |s: SocketRef,
                          Extension(auth): Extension<实时外壳::已认证会话>,
                          Data::<实时外壳::RealtimeSubscribeBody>(payload)| {
                        let state = state_for_subscribe.clone();
                        async move {
                            实时外壳::handle_realtime_subscribe(s, auth, payload, state).await;
                        }
                    },
                );

                // 业务热命令：创建统一消息。
                socket.on(
                    "create_message",
                    move |s: SocketRef,
                          Extension(auth): Extension<实时外壳::已认证会话>,
                          Data::<实时外壳::RealtimeCreateMessageBody>(payload)| {
                        let state = state_for_send.clone();
                        async move {
                            实时外壳::handle_realtime_create_message(s, auth, payload, state)
                                .await;
                        }
                    },
                );
            }
        })
        .with(
            move |socket: SocketRef, TryData(auth): TryData<实时外壳::RealtimeConnectAuth>| {
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

/// 统一错误响应体（跨 HTTP 接口稳定结构）。
#[derive(Serialize)]
struct ApiError {
    /// 稳定错误码，供前端逻辑判断。
    code: &'static str,
    /// 可读错误信息，主要用于显示和排障。
    message: String,
}

/// 领域事件 -> 传输 JSON 的稳定映射层。
/// 约束：只做字段翻译，不添加业务语义。
fn events_to_json(events: Vec<contract::领域事件>) -> Vec<serde_json::Value> {
    events.into_iter().map(event_to_json).collect()
}

fn attachments_to_json(attachments: &[contract::附件快照]) -> Vec<serde_json::Value> {
    attachments
        .iter()
        .map(|attachment| match attachment {
            contract::附件快照::图片(image) => serde_json::json!({
                "kind": "image",
                "attachment_id": image.附件标识,
                "width": image.宽,
                "height": image.高
            }),
            contract::附件快照::视频(video) => serde_json::json!({
                "kind": "video",
                "attachment_id": video.附件标识,
                "width": video.宽,
                "height": video.高
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
            附件,
            事件位置,
        } => serde_json::json!({
            "type": "message_created",
            "room_id": 房间标识,
            "message_id": 消息标识,
            "client_message_id": 客户端消息标识,
            "sender_session_id": 发送者会话标识,
            "sender_display_alias": 发送者花名,
            "text": 文本,
            "body": 文本,
            "attachments": attachments_to_json(&附件),
            "event_position": 事件位置
        }),
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
        contract::错误码::附件不存在 => (
            StatusCode::NOT_FOUND,
            "attachment_not_found",
            "附件不存在".to_string(),
        ),
        contract::错误码::附件不属于当前发送者 => (
            StatusCode::FORBIDDEN,
            "attachment_not_owned",
            "附件不属于当前发送者".to_string(),
        ),
        contract::错误码::附件未就绪 => (
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "附件尚未就绪".to_string(),
        ),
        contract::错误码::附件类型不支持 => (
            StatusCode::BAD_REQUEST,
            "attachment_type_not_allowed",
            "附件类型不支持".to_string(),
        ),
        contract::错误码::附件数量超限 => (
            StatusCode::BAD_REQUEST,
            "attachment_count_exceeded",
            "附件数量超限".to_string(),
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

use crate::{adapter::Pg仓储, media_distribution, realtime::shell as 实时外壳};
use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    routing::{any, get, post},
    Router,
};
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use object_store::{
    aws::{AmazonS3, AmazonS3Builder},
    local::LocalFileSystem,
    ObjectStore,
};
use socketioxide::{
    extract::{Data, Extension, SocketRef, TryData},
    handler::ConnectHandler,
    SocketIo, TransportType,
};
use sqlx::PgPool;
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
};

// 这些私有子模块是 shell 内部的职责收口点。
// 总壳只保留装配与公共转码，具体协议逻辑分别沉到对应子模块。
#[path = "../媒体/上传/外壳/tus回调.rs"]
mod tus_hook外壳;
#[path = "前端静态入口.rs"]
mod 前端静态入口;
#[path = "连接门禁.rs"]
pub mod 连接门禁;
#[path = "协作分发做种.rs"]
pub mod 协作分发做种;
#[path = "协议响应.rs"]
pub(crate) mod 协议响应;
#[path = "../后台/外壳.rs"]
mod 后台外壳;
#[path = "../媒体/上传/外壳/source_hash复用.rs"]
mod 媒体_source_hash复用外壳;
#[path = "../媒体/上传/外壳/tus代理.rs"]
mod 媒体_tus代理外壳;
#[path = "../媒体/上传/外壳/媒体上传.rs"]
mod 媒体上传共享外壳;
#[path = "../媒体/上传/内容解析.rs"]
mod 媒体内容解析;
#[path = "../媒体/上传/外壳/准备上传.rs"]
mod 媒体准备上传外壳;
#[path = "../媒体/上传/外壳/完成上传.rs"]
mod 媒体完成上传外壳;
#[path = "../媒体/上传/外壳/恢复上传.rs"]
mod 媒体恢复上传外壳;
#[path = "../媒体/上传/外壳/放弃上传.rs"]
mod 媒体放弃上传外壳;
#[path = "媒体清理.rs"]
pub mod 媒体清理;
#[path = "../媒体/资产/外壳.rs"]
mod 媒体资产外壳;
#[path = "../媒体/上传/外壳/附件响应.rs"]
mod 媒体附件上传响应外壳;
#[path = "../媒体/上传/外壳/转发附件.rs"]
mod 媒体附件转发外壳;
#[path = "../房间/外壳.rs"]
mod 房间外壳;
/// 当前媒体上传运输契约仍统一走 TUS sidecar。
/// 先把常量收在 shell 父层，供上传外壳与 Tus hook 外壳共享，避免兄弟模块重复手抄字符串。
const 媒体上传运输方式_TUS: &str = "tus";
pub(crate) const TUS协议版本_HEADER值: &str = "1.0.0";
pub(crate) const TUS_INTERNAL_TERMINATION_GUARD_HEADER: &str = "X-Koko-Internal-Termination";

/// HTTP 入口只负责限制“单次请求体能进壳多少字节”，这是纯资源门禁，不是业务时长或媒体真相。
/// 把它显式收成常量，避免 prepare/脚本/body limit 三处再各写各的数字。
pub(crate) const 媒体上传HTTP请求体上限字节数: usize = 200 * 1024 * 1024;

/// 外壳层统一解析“必填但允许空字符串传进来的 session_id”。
/// 这属于多个 HTTP 壳共享的协议清洗，不应该继续挂在某个具体业务壳名下。
pub(super) fn 读取非空会话标识(
    raw_session_id: Option<String>,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    raw_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ))
}

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
    pub swarm_tracker_upstream_url: String,
    pub swarm_web_seed_public_endpoint: Option<String>,
    pub swarm_seeder_control_base_url: String,
    pub swarm_seeder_tracker_url: String,
    pub swarm_ticket_secret: Option<String>,
    pub swarm_ticket_ttl_seconds: i64,
    pub swarm_peer_presence_stale_seconds: i64,
    /// 连接群友窗口是 shell 运行态节奏，不是持久化业务真相：
    /// 1. 只用于把 locator 的连接/无种子状态节奏保持一致；
    /// 2. key 粒度是 `attachment_id + session_id`；
    /// 3. 进程重启后可重建，不参与 domain 权威事实。
    pub swarm_connecting_window_started_at: Arc<Mutex<HashMap<String, i64>>>,
    pub tus_public_endpoint: Option<String>,
    pub tus_server_port: u16,
    pub tus_base_path: String,
    pub tus_upload_dir: String,
    pub tus_internal_base_url: Option<String>,
    pub tus_internal_termination_token: Option<String>,
    pub media_complete_max_concurrency: usize,
    pub media_complete_gate: Arc<tokio::sync::Semaphore>,
    /// Cloudflare Realtime TURN 凭证缓存（全局 anycast STUN/TURN）。
    /// key_id + api_token 均为 None 时，响应中 ice_servers 为空数组。
    pub cloudflare_turn_key_id: Option<String>,
    pub cloudflare_turn_api_token: Option<String>,
    pub turn_ice_servers_cache: Arc<tokio::sync::RwLock<TurnIceServersCache>>,
    /// DDoS/CC 防御状态（PoW 引擎 + IP 追踪 + 访客计数）。
    /// None = 配置缺失时防御功能禁用（开发模式兑容）。
    pub defense: Option<连接门禁::防御状态>,
    /// 媒体存储驱动（本地/S3），决定做种对账是否下发 localSeed hint。
    pub media_storage_driver: crate::assembly::媒体存储驱动,
    /// pending-first：complete 后需要通过 socketioxide 广播附件状态升级事件。
    /// 启动时写入一次，后续只读。Option 兜底测试/CLI 等不带 realtime 的入口。
    pub realtime_io: Option<socketioxide::SocketIo>,
    /// 全局共享 HTTP Client，所有对外 HTTP 调用复用此连接池。
    /// reqwest 官方要求 Client 创建一次复用，每次 new() 都会重建连接池和 TLS 会话。
    pub http_client: reqwest::Client,
}

/// Cloudflare Realtime TURN 凭证缓存（TTL 24h，半衰期刷新）。
#[derive(Clone, Default)]
pub struct TurnIceServersCache {
    pub ice_servers: serde_json::Value,
    pub fetched_at_epoch_secs: i64,
}

const TURN_CREDENTIAL_TTL: i64 = 86_400;
fn stun_only() -> serde_json::Value {
    serde_json::json!([{ "urls": [
        "stun:stun.cloudflare.com:3478",
        "stun:stun.qq.com:3478",
        "stun:stun.chat.bilibili.com:3478",
        "stun:stun.miwifi.com:3478",
    ] }])
}

impl 应用状态 {
    pub async fn get_turn_ice_servers(&self) -> serde_json::Value {
        let (Some(key_id), Some(api_token)) =
            (self.cloudflare_turn_key_id.as_deref(), self.cloudflare_turn_api_token.as_deref())
        else { return stun_only(); };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64).unwrap_or_default();
        {
            let c = self.turn_ice_servers_cache.read().await;
            if c.fetched_at_epoch_secs > 0 && (now - c.fetched_at_epoch_secs) < TURN_CREDENTIAL_TTL / 2 {
                return c.ice_servers.clone();
            }
        }
        let url = format!(
            "https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
        );
        let res = self.http_client
            .post(&url).bearer_auth(api_token)
            .json(&serde_json::json!({ "ttl": TURN_CREDENTIAL_TTL }))
            .send().await;
        match res.and_then(|r| Ok((r.status(), r))).map_err(|e| e.to_string()) {
            Ok((status, r)) if status.is_success() => {
                let json: serde_json::Value = r.json().await.unwrap_or_default();
                let ice = json.get("iceServers").cloned().unwrap_or_else(stun_only);
                let mut c = self.turn_ice_servers_cache.write().await;
                c.ice_servers = ice.clone();
                c.fetched_at_epoch_secs = now;
                ice
            }
            other => {
                let detail = match other {
                    Ok((s, r)) => format!("{s}: {}", r.text().await.unwrap_or_default()),
                    Err(e) => e,
                };
                tracing::warn!(adapter = "cloudflare_turn", %detail, "TURN 凭证刷新失败，缓存兜底");
                let c = self.turn_ice_servers_cache.read().await;
                if c.fetched_at_epoch_secs > 0 { c.ice_servers.clone() } else { stun_only() }
            }
        }
    }
}

/// 组装 HTTP 冷路径 + Realtime 热路径路由。
///
/// 分层约束：
/// 1. 这里做协议接线，不做业务裁决。
/// 2. 命令是否成立必须交给 application + domain + repository 主链。
/// 3. 前端静态资源同源托管，减少开发期跨域噪音和双端口复杂度。
pub async fn 构建应用状态(
    database_url: String,
    admin_password: String,
) -> std::io::Result<应用状态> {
    let media_storage = crate::assembly::读取媒体存储配置()?;
    let media_packaging = crate::assembly::读取媒体打包配置();
    let swarm = crate::assembly::读取协作分发配置()?;
    let tus = crate::assembly::读取媒体_tus侧车配置()?;
    let media_complete_max_concurrency = crate::assembly::读取媒体上传完成并发上限()?;
    let database_pool = crate::assembly::读取数据库连接池配置()?;
    let attachment_storage_dir = crate::assembly::读取附件存储目录();
    fs::create_dir_all(&tus.upload_dir)
        .map_err(|err| std::io::Error::other(format!("创建媒体 Tus 上传目录失败: {err}")))?;
    let attachment_store = 构建附件对象存储(&media_storage, &attachment_storage_dir)?;
    tracing::info!(
        database_pool_max_connections = database_pool.app_max_connections,
        database_pool_min_connections = database_pool.app_min_connections,
        database_pool_acquire_timeout_ms = database_pool.acquire_timeout_ms,
        database_pool_connect_timeout_ms = database_pool.connect_timeout_ms,
        "应用数据库连接池配置已加载"
    );
    let pool = tokio::time::timeout(
        database_pool.connect_timeout(),
        database_pool.应用连接池选项().connect(&database_url),
    )
    .await
    .map_err(|_| std::io::Error::other("连接数据库超时"))?
    .map_err(|err| std::io::Error::other(format!("连接数据库失败: {err}")))?;

    let http_client = reqwest::Client::builder()
        .http1_only()
        .pool_max_idle_per_host(20)
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|err| std::io::Error::other(format!("构建共享 HTTP Client 失败: {err}")))?;

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
        swarm_tracker_upstream_url: swarm.tracker_upstream_url,
        swarm_web_seed_public_endpoint: swarm.web_seed_public_endpoint,
        swarm_seeder_control_base_url: swarm.seeder_control_base_url,
        swarm_seeder_tracker_url: swarm.seeder_tracker_url,
        swarm_ticket_secret: swarm.ticket_secret,
        swarm_ticket_ttl_seconds: swarm.ticket_ttl_seconds,
        swarm_peer_presence_stale_seconds: swarm.peer_presence_stale_seconds,
        cloudflare_turn_key_id: swarm.cloudflare_turn_key_id,
        cloudflare_turn_api_token: swarm.cloudflare_turn_api_token,
        turn_ice_servers_cache: Arc::new(tokio::sync::RwLock::new(TurnIceServersCache::default())),
        swarm_connecting_window_started_at: Arc::new(Mutex::new(HashMap::new())),
        tus_public_endpoint: tus.public_endpoint,
        tus_server_port: tus.server_port,
        tus_base_path: tus.base_path,
        tus_upload_dir: tus.upload_dir,
        tus_internal_base_url: tus.internal_base_url,
        tus_internal_termination_token: tus.internal_termination_token,
        media_complete_max_concurrency,
        media_complete_gate: Arc::new(tokio::sync::Semaphore::new(media_complete_max_concurrency)),
        media_storage_driver: media_storage.驱动.clone(),
        realtime_io: None,
        http_client,
        defense: match crate::assembly::读取PoW配置() {
            Ok(pow_config) => {
                tracing::info!(
                    application = "服务启动",
                    adapter = "pow",
                    outcome = "succeeded",
                    trusted_proxy = pow_config.trusted_proxy,
                    "PoW 防御已启用"
                );
                Some(连接门禁::防御状态 {
                    engine: Arc::new(连接门禁::PoW引擎::new(&pow_config.secret, 2)),
                    访客: Arc::new(连接门禁::访客计数器::new()),
                    ip追踪: Arc::new(连接门禁::Ip追踪器::new()),
                    trusted_proxy: pow_config.trusted_proxy,
                })
            }
            Err(err) => {
                tracing::warn!(
                    application = "服务启动",
                    adapter = "pow",
                    outcome = "degraded",
                    error = %err,
                    "PoW 配置读取失败，防御功能已禁用"
                );
                None
            }
        },
    })
}

/// 统一装配附件对象存储：
/// - local 继续服务测试与回滚窗；
/// - S3 对象存储模式只负责 canonical 附件对象读写，不再承担浏览器直传签名。
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
        crate::assembly::媒体存储驱动::S3对象存储 => {
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
        .map_err(|err| std::io::Error::other(format!("初始化 S3 对象存储失败: {err}")))
}

pub fn 构建路由(state: 应用状态) -> Router {
    // ── 万人实时场景显式调参（依据 socketioxide 官方 SocketIoBuilder 文档）──
    // max_buffer_size: 128→256，大房间广播时 InternalChannelFull 风险降低。
    // max_payload: 100KB→2MB，附件元数据 JSON 不再被截断。
    // transports: Websocket-only，去掉 polling 开销。
    // ping_timeout: 20s→10s，半开连接更快剔除。
    let (socket_layer, io) = SocketIo::builder()
        .max_buffer_size(256)
        .max_payload(2_000_000)
        .ping_interval(std::time::Duration::from_secs(25))
        .ping_timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(45))
        .transports([TransportType::Websocket])
        .build_layer();
    注册realtime命名空间(&io, state.clone());
    // pending-first：把 SocketIo 引用注入共享状态，供 complete 后广播。
    // 这里用 Arc::get_mut 不行（state 已被 clone），所以直接 field mutation。
    // 由于 应用状态 是 Clone，这里 clone 一份带 io 的新 state 给后面用。
    let mut state = state;
    state.realtime_io = Some(io.clone());
    let normalized_tus_base_path =
        媒体_tus代理外壳::标准化媒体_tus基础路径(state.tus_base_path.as_str());
    let tus_resource_proxy_path = format!("{normalized_tus_base_path}/{{*tus_upload_tail}}");

    // PoW 防御路由：独立 state 避免 handler 签名被主路由 state 类型污染。
    // defense 为 None 时这两个路由不注册，前端走无 PoW 连接路径。
    let pow_routes = if let Some(ref defense) = state.defense {
        Router::new()
            .route("/api/pow/challenge", get(连接门禁::handle_pow_challenge))
            .route("/api/pow/verify", post(连接门禁::handle_pow_verify))
            .with_state(defense.clone())
    } else {
        Router::new()
    };

    let mut app = pow_routes
        .merge(Router::new()
        .route(
            normalized_tus_base_path.as_str(),
            any(媒体_tus代理外壳::proxy_tus_upload_transport),
        )
        .route(
            tus_resource_proxy_path.as_str(),
            any(媒体_tus代理外壳::proxy_tus_upload_transport),
        )
        .route("/api/session/bootstrap", post(房间外壳::bootstrap_session))
        .route(
            "/api/rooms/join-or-create",
            post(房间外壳::join_or_create_room),
        )
        .route(
            "/api/media/{attachment_kind}/prepare",
            post(媒体准备上传外壳::prepare_media_upload),
        )
        .route(
            "/api/media/{attachment_kind}/source-dedupe",
            post(媒体_source_hash复用外壳::reuse_media_by_source_hash),
        )
        .route(
            "/api/media/{attachment_kind}/forward",
            post(媒体附件转发外壳::forward_media_attachment),
        )
        .route(
            "/api/media/{attachment_id}/complete",
            post(媒体完成上传外壳::complete_media_upload),
        )
        .route(
            "/api/media/{attachment_id}/resume",
            post(媒体恢复上传外壳::resume_media_upload),
        )
        .route(
            "/api/media/{attachment_id}/abandon",
            post(媒体放弃上传外壳::abandon_media_upload),
        )
        .route("/internal/tus/hooks", post(tus_hook外壳::handle_tus_hook))
        .route(
            "/api/media/{attachment_id}/locator",
            get(媒体资产外壳::load_media_locator),
        )
        .route(
            "/api/media/{attachment_id}/blob/{asset_variant}",
            get(媒体资产外壳::load_blob_asset_content),
        )
        .route(
            "/api/media/{attachment_id}/torrent",
            get(媒体资产外壳::load_media_torrent),
        )
        .route(
            media_distribution::同源协作分发ANNOUNCE路径,
            get(crate::media::distribution::tracker代理::proxy_swarm_tracker_announce),
        )
        .route(
            "/api/media/{attachment_id}/presence",
            post(媒体资产外壳::update_media_distribution_presence),
        )
        .route(
            "/api/attachments/{attachment_id}/content",
            get(媒体资产外壳::load_attachment_content),
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
        .merge(前端静态入口::构建前端静态资源路由())
        .layer(DefaultBodyLimit::max(媒体上传HTTP请求体上限字节数))
        .layer(socket_layer)
        .with_state(state.clone()));

    // IP 级 HTTP 限流：生产在 Cloudflare + Caddy 后面，不能用默认 peer IP。
    // tower-governor 默认 PeerIpKeyExtractor 会把所有用户归到 Caddy peer IP，
    // 这里显式使用 SmartIpKeyExtractor 消费 X-Forwarded-For / Forwarded。
    if state.defense.is_some() {
        let governor_conf = GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .per_millisecond(33)
            .burst_size(120)
            .finish()
            .unwrap();
        let governor_limiter = governor_conf.limiter().clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            governor_limiter.retain_recent();
        });
        app = app.layer(GovernorLayer::new(governor_conf));
    }

    app
}

/// 注册单节点 realtime 命名空间。
/// 约束：连接级认证在 connect middleware 完成，消息 handler 不再相信 payload 身份。
/// 这里故意只保留 wiring；控制面 payload 翻译和热路径失败分级都继续沉在 `src/实时/外壳.rs`。
fn 注册realtime命名空间(io: &SocketIo, state: 应用状态) {
    let connect_state = state.clone();
    io.ns(
        "/",
        (move |socket: SocketRef| {
            let state_for_subscribe = state.clone();
            let state_for_send = state.clone();
            async move {
                // 每连接限流令牌桶：随 socket 创建，随 socket 销毁，无需定时清理。
                socket
                    .extensions
                    .insert(std::sync::Arc::new(std::sync::Mutex::new(实时外壳::连接消息令牌桶::new())));

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

                // 控制面命令：取消订阅房间事件流（纯适配层，零 DB 开销）。
                socket.on(
                    "unsubscribe_room_stream",
                    |s: SocketRef,
                     Extension(auth): Extension<实时外壳::已认证会话>,
                     Data::<实时外壳::RealtimeUnsubscribeBody>(payload)| async move {
                        实时外壳::handle_realtime_unsubscribe(s, auth, payload);
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
pub(crate) fn 构建共享仓储(state: &应用状态) -> Pg仓储 {
    Pg仓储::从连接池构建(state.pool.clone(), state.runtime_handle.clone())
}

use crate::media_distribution::同源协作分发ANNOUNCE路径;
use sqlx::{
    ConnectOptions,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use std::{
    env, io, panic,
    sync::{Once, OnceLock},
    time::Duration,
};
use tracing_subscriber::{EnvFilter, fmt::time::OffsetTime};

static PANIC_HOOK_INIT: Once = Once::new();
static LOG_INIT_RESULT: OnceLock<Result<(), String>> = OnceLock::new();

/// 启动配置聚合对象：只存“启动必需项”，不混入业务态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 配置 {
    pub database_url: String,
    pub admin_password: String,
    pub app_port: u16,
    pub rust_log: String,
    pub attachment_storage_dir: String,
    pub media_storage: 媒体存储配置,
    pub media_packaging: 媒体打包配置,
    pub tus: 媒体Tus侧车配置,
    pub 协作分发: 协作分发配置,
}

/// 数据库连接池配置只描述“应用如何使用成熟 PostgreSQL 池化能力”。
/// 它不拥有业务真相，也不把在线用户数映射成数据库连接数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct 数据库连接池配置 {
    pub app_max_connections: u32,
    pub app_min_connections: u32,
    pub migration_max_connections: u32,
    pub acquire_timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub idle_timeout_seconds: u64,
}

impl 数据库连接池配置 {
    /// 万人在线场景下，热路径每条消息最多 3 次 roundtrip，
    /// 50 连接可同时服务约 16 条并发消息创建，避免排队超时。
    const 默认应用最大连接数: u32 = 50;
    /// 保持最少 5 条空闲连接，消除冷启动时的建连延迟。
    const 默认应用最小连接数: u32 = 5;
    const 迁移固定连接数: u32 = 1;
    const 默认获取连接超时毫秒: u64 = 3_000;
    const 默认建池超时毫秒: u64 = 5_000;
    const 默认空闲回收秒数: u64 = 600;

    /// 从可注入的环境变量读取函数构建配置，方便测试不触碰进程全局环境。
    pub fn from_env_with<F>(mut read: F) -> io::Result<Self>
    where
        F: FnMut(&str) -> Option<String>,
    {
        let app_max_connections = 读取可选正_u32(
            &mut read,
            "KOKO_DATABASE_MAX_CONNECTIONS",
            Self::默认应用最大连接数,
        )?;
        let app_min_connections = 读取可选_u32(
            &mut read,
            "KOKO_DATABASE_MIN_CONNECTIONS",
            Self::默认应用最小连接数,
        )?;
        if app_min_connections > app_max_connections {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "KOKO_DATABASE_MIN_CONNECTIONS({app_min_connections}) 不能大于 KOKO_DATABASE_MAX_CONNECTIONS({app_max_connections})"
                ),
            ));
        }

        Ok(Self {
            app_max_connections,
            app_min_connections,
            migration_max_connections: Self::迁移固定连接数,
            acquire_timeout_ms: 读取可选正_u64(
                &mut read,
                "KOKO_DATABASE_ACQUIRE_TIMEOUT_MS",
                Self::默认获取连接超时毫秒,
            )?,
            connect_timeout_ms: 读取可选正_u64(
                &mut read,
                "KOKO_DATABASE_CONNECT_TIMEOUT_MS",
                Self::默认建池超时毫秒,
            )?,
            idle_timeout_seconds: 读取可选正_u64(
                &mut read,
                "KOKO_DATABASE_IDLE_TIMEOUT_SECONDS",
                Self::默认空闲回收秒数,
            )?,
        })
    }

    pub fn acquire_timeout(self) -> Duration {
        Duration::from_millis(self.acquire_timeout_ms)
    }

    pub fn connect_timeout(self) -> Duration {
        Duration::from_millis(self.connect_timeout_ms)
    }

    pub fn idle_timeout(self) -> Duration {
        Duration::from_secs(self.idle_timeout_seconds)
    }

    /// 这里直接复用 `sqlx` 成熟连接池，不包装第二套私有池化核心。
    pub fn 应用连接池选项(self) -> PgPoolOptions {
        PgPoolOptions::new()
            .max_connections(self.app_max_connections)
            .min_connections(self.app_min_connections)
            .acquire_timeout(self.acquire_timeout())
            .idle_timeout(Some(self.idle_timeout()))
            // 万人并发场景可观测：连接获取超 500ms 触发 WARN 日志，
            // 帮助定位连接池争抢瓶颈。sqlx 默认 slow_level = Warn。
            .acquire_slow_threshold(Duration::from_millis(500))
    }
}

/// 媒体存储驱动只回答“上传对象最终落在哪类后端”。
/// 它不回答消息业务问题，也不夹带前端页面流程。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 媒体存储驱动 {
    本地目录,
    S3对象存储,
}

/// 媒体存储配置是启动期真相：
/// - local 只需要本地目录；
/// - S3 对象存储直传则需要 endpoint / bucket / credentials 等信息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体存储配置 {
    pub 驱动: 媒体存储驱动,
    pub endpoint: Option<String>,
    pub public_endpoint: Option<String>,
    pub bucket: Option<String>,
    pub region: String,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub path_style: bool,
}

/// 媒体打包配置只回答“外壳该调用哪几个成熟工具”。
/// 这里故意不扩展成私有打包框架配置对象，避免基础设施真相再次膨胀。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体打包配置 {
    pub ffmpeg_bin: String,
    pub ffprobe_bin: String,
    pub shaka_packager_bin: String,
}

/// 媒体 Tus 侧车配置只描述“上传 sidecar 如何暴露与落盘”。
/// 它不回答业务问题，也不拥有附件/消息真相。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体Tus侧车配置 {
    pub public_endpoint: Option<String>,
    pub server_port: u16,
    pub base_path: String,
    pub upload_dir: String,
    pub internal_base_url: Option<String>,
    pub internal_termination_token: Option<String>,
}

/// 协作分发配置只回答“runtime 线索怎么暴露给前端”：
/// 1. tracker public URL 提供给浏览器进入 swarm；
/// 2. web seed public endpoint 决定 24 小时保底源的公开地址；
/// 3. ticket secret / TTL 决定私有 swarm 门禁如何签发；
/// 4. peer presence staleness 为后续 Phase 3 的过期裁决预留稳定配置源；
/// 5. 原始冷源清理间隔只属于启动/运维配置，不进入业务契约；
/// 6. 做种对账间隔只负责刷新 sidecar/tracker 协作分发门禁，必须短于 ticket TTL；
/// 7. seeder control base URL 只用于后端 owner 调 sidecar 命令面，不进入前端 contract。
/// 8. seeder tracker URL 是 sidecar 内网 announce，禁止与浏览器 public announce 混用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发配置 {
    pub tracker_public_url: String,
    pub tracker_port: u16,
    pub tracker_upstream_url: String,
    pub web_seed_public_endpoint: Option<String>,
    pub seeder_control_base_url: String,
    pub seeder_tracker_url: String,
    pub ticket_secret: Option<String>,
    pub ticket_ttl_seconds: i64,
    pub peer_presence_stale_seconds: i64,
    pub media_origin_cleanup_interval_seconds: i64,
    pub swarm_seed_reconcile_interval_seconds: i64,
    /// Cloudflare Realtime TURN key ID，用于调用 TURN 凭证 API。
    /// None = 未配置，响应中 ice_servers 为空数组。
    pub cloudflare_turn_key_id: Option<String>,
    /// Cloudflare Realtime TURN API token。
    pub cloudflare_turn_api_token: Option<String>,
}

/// 读取启动所需的最小配置。缺关键配置时必须失败，避免静默启动。
pub fn 读取配置() -> io::Result<配置> {
    // 先尝试读取 .env，再读系统环境变量；缺失必填项直接失败。
    尝试加载dotenv();
    let database_url = 读取必填环境变量("DATABASE_URL")?;
    let admin_password = 读取必填环境变量("ADMIN_PASSWORD")?;
    let app_port = 读取端口("APP_PORT")?;
    let rust_log = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let attachment_storage_dir = 读取附件存储目录();
    let media_storage = 读取媒体存储配置()?;
    let media_packaging = 读取媒体打包配置();
    let tus = 读取媒体_tus侧车配置()?;
    let 协作分发 = 读取协作分发配置()?;

    Ok(配置 {
        database_url,
        admin_password,
        app_port,
        rust_log,
        attachment_storage_dir,
        media_storage,
        media_packaging,
        tus,
        协作分发,
    })
}

/// 读取应用数据库池化配置。
/// 迁移连接仍由 `自动追平迁移` 的单连接池独立控制，避免 app pool 配置误伤迁移顺序。
pub fn 读取数据库连接池配置() -> io::Result<数据库连接池配置> {
    尝试加载dotenv();
    数据库连接池配置::from_env_with(|key| env::var(key).ok())
}

/// 日志系统必须天然存在：启动时默认初始化，开发和生产只在详细度上有差异。
pub fn 初始化日志() -> io::Result<()> {
    let result = LOG_INIT_RESULT.get_or_init(|| {
        // 日志初始化也走同一套环境变量读取，确保 run.ps1 / cargo run 行为一致。
        尝试加载dotenv();
        let filter_text = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
        let filter = EnvFilter::try_new(filter_text.clone())
            .map_err(|_| format!("RUST_LOG 非法: {filter_text}"))?;
        let subscriber = 构建日志订阅器(filter);

        // 进程级全局 subscriber：让任意层都天然可见日志输出。
        tracing::subscriber::set_global_default(subscriber)
            .map_err(|err| format!("安装全局日志订阅器失败: {err}"))?;
        // panic 也必须回到同一条后端日志主链，避免终端只有 Rust 默认 stderr 而没有结构化证据。
        安装panic日志钩子();
        Ok(())
    });

    result
        .as_ref()
        .map_err(|message| io::Error::other(message.clone()))
        .map(|_| ())
}

/// 构造进程级日志订阅器。
///
/// 设计取舍：
/// 1. 开发态优先尝试本地时区时间，减少终端里出现 `...Z` 带来的阅读成本；
/// 2. 如果当前调用点已经在多线程 runtime 内，官方建议的本地 offset 获取可能失败；
/// 3. 这时宁可优雅回退到默认时间格式，也不能让日志初始化反过来阻断服务启动。
fn 构建日志订阅器(filter: EnvFilter) -> Box<dyn tracing::Subscriber + Send + Sync> {
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_level(true);

    match OffsetTime::local_rfc_3339() {
        Ok(timer) => Box::new(builder.with_timer(timer).finish()),
        Err(_) => Box::new(builder.finish()),
    }
}

/// 安装全局 panic hook，把不可恢复崩溃也收口进统一日志主链。
///
/// 维护者约束：
/// 1. 这里仍然保留 Rust 默认 panic 输出，不吞掉 stderr/backtrace；
/// 2. 这里只做“把 panic 翻译成统一日志事件”，不负责恢复进程；
/// 3. 该 hook 必须幂等，避免测试和运行时重复安装后互相覆盖。
pub fn 安装panic日志钩子() {
    PANIC_HOOK_INIT.call_once(|| {
        let default_hook = panic::take_hook();
        panic::set_hook(Box::new(move |panic_info| {
            记录panic日志(panic_info);
            // 继续调用 Rust 默认 hook：这样后来者既能在统一日志里追踪，也不会丢掉原生 panic 证据。
            default_hook(panic_info);
        }));
    });
}

/// 可选加载 dotenv。
/// `KOKO_SKIP_DOTENV=1` 用于测试场景，避免测试被本机 .env 污染。
fn 尝试加载dotenv() {
    if env::var("KOKO_SKIP_DOTENV").ok().as_deref() == Some("1") {
        return;
    }
    let _ = dotenvy::dotenv();
}

/// 把 panic 信息转成统一结构化日志。
///
/// 这里故意不做“美化崩溃页面”或“自定义恢复”，只负责提供稳定排障字段：
/// - `adapter=panic_hook` 说明证据来自全局崩溃入口
/// - `outcome=failed` 明确这不是业务拒绝，而是不可恢复失败
/// - `error_code=panic` 让后续搜索与未来落盘规则都能稳定依赖同一个码
fn 记录panic日志(panic_info: &panic::PanicHookInfo<'_>) {
    let message = 提取panic消息(panic_info);
    let (panic_file, panic_line, panic_column) = panic_info
        .location()
        .map(|location| {
            (
                location.file().to_string(),
                location.line() as i64,
                location.column() as i64,
            )
        })
        .unwrap_or_else(|| ("unknown".to_string(), 0, 0));

    tracing::error!(
        application = "未恢复崩溃",
        adapter = "panic_hook",
        outcome = "failed",
        error_code = "panic",
        panic_file = panic_file,
        panic_line = panic_line,
        panic_column = panic_column,
        panic_message = message,
        "捕获到未恢复的 panic"
    );
}

/// 提取 panic payload，统一转成可检索字符串。
///
/// panic payload 既可能是 `&str`，也可能是 `String`，还可能是其他任意类型。
/// 这里统一收口成字符串，避免后续日志里出现“有 panic 但消息字段为空”的盲区。
fn 提取panic消息(panic_info: &panic::PanicHookInfo<'_>) -> String {
    if let Some(message) = panic_info.payload().downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = panic_info.payload().downcast_ref::<String>() {
        message.clone()
    } else {
        "panic payload 不是字符串".to_string()
    }
}

/// 启动前自动追平迁移，保证数据库结构与代码版本一致。
/// 这是“基础设施准备动作”，不是业务语义。
/// 维护者注意：
/// - 这里只执行 `migrations/` 目录里被审查过的当前数据库基线；
/// - 探索期或发布期临时 SQL 先在外部验证，稳定后再折叠回单一基线，避免长期迁移膨胀。
pub async fn 自动追平迁移(database_url: &str) -> io::Result<()> {
    let connect_options = 构建迁移数据库连接选项(database_url)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .map_err(|err| io::Error::other(format!("连接数据库失败: {err}")))?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|err| io::Error::other(format!("执行迁移失败: {err}")))?;

    pool.close().await;
    Ok(())
}

/// 迁移阶段的数据库连接只承载 schema 准备，不应把 SQLx 内部探测 SQL 当成业务慢查询噪音打出来。
/// 这里仅关闭迁移连接自己的 statement logging，运行期连接池仍保留默认诊断能力。
fn 构建迁移数据库连接选项(database_url: &str) -> io::Result<PgConnectOptions> {
    database_url
        .parse::<PgConnectOptions>()
        .map(ConnectOptions::disable_statement_logging)
        .map_err(|err| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("DATABASE_URL 非法: {err}"),
            )
        })
}

/// 读取必填环境变量并做“非空字符串”校验。
/// 这样可以把配置问题提前收敛到启动期，而不是运行中随机暴露。
fn 读取必填环境变量(key: &str) -> io::Result<String> {
    // 统一把“缺配置”归类为 InvalidInput，便于上层错误转码。
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("缺少必填环境变量: {key}"),
        )),
    }
}

/// 把端口环境变量解析成 `u16`。
/// 解析失败直接返回启动错误，避免服务以错误端口继续执行。
fn 读取端口(key: &str) -> io::Result<u16> {
    // 端口格式不合法也归入启动前失败，避免运行期才暴露。
    let raw = 读取必填环境变量(key)?;
    raw.parse::<u16>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 不是合法端口: {raw}"),
        )
    })
}

/// 附件存储根目录是可选配置：
/// 1. 显式设置时尊重环境变量
/// 2. 没设置时统一回到项目内 `data/attachments`
pub fn 读取附件存储目录() -> String {
    env::var("ATTACHMENT_STORAGE_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "data/attachments".to_string())
}

/// 打包工具默认优先走显式环境变量，其次才回到约定命令名。
/// Windows 上 `winget` 的 `packager.exe` 可能是错误别名，因此优先尝试我们约定的 `shaka-packager.exe`。
pub fn 读取媒体打包配置() -> 媒体打包配置 {
    媒体打包配置 {
        ffmpeg_bin: 读取可选命令路径("MEDIA_FFMPEG_BIN", "ffmpeg"),
        ffprobe_bin: 读取可选命令路径("MEDIA_FFPROBE_BIN", "ffprobe"),
        shaka_packager_bin: env::var("MEDIA_SHAKA_PACKAGER_BIN")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(推导默认shaka_packager命令),
    }
}

fn 读取可选命令路径(key: &str, default_value: &str) -> String {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_value.to_string())
}

fn 推导默认shaka_packager命令() -> String {
    if cfg!(windows) {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            let candidate = format!(r"{local_app_data}\koko-tools\shaka-packager.exe");
            if std::path::Path::new(candidate.as_str()).exists() {
                return candidate;
            }
        }
        return "shaka-packager".to_string();
    }
    "packager".to_string()
}

/// 媒体 Tus 侧车配置默认保持“浏览器同源 + sidecar 内收”：
/// 1. 未显式配置 `MEDIA_TUS_PUBLIC_ENDPOINT` 时，浏览器公开 contract 默认直接收口成 `/files`；
/// 2. 上传字节继续落到一处稳定共享目录，给 hook / complete / 清理主链复用；
/// 3. `server_port/base_path` 继续保留，给主服务 -> tusd 内部通信与本地调试复用；
/// 4. `internal_*` 只服务主服务 -> tus sidecar 的官方 termination 调用；
///    没配置时继续保留“业务放弃 + 本地残留清理”兜底，不让取消主链退化。
pub fn 读取媒体_tus侧车配置() -> io::Result<媒体Tus侧车配置> {
    let server_port = 读取可选端口("MEDIA_TUS_SERVER_PORT", 1081)?;
    let raw_base_path =
        读取可选环境变量("MEDIA_TUS_BASE_PATH").unwrap_or_else(|| "/files".to_string());
    let base_path = if raw_base_path.starts_with('/') {
        raw_base_path
    } else {
        format!("/{raw_base_path}")
    };
    let public_endpoint = 读取可选环境变量("MEDIA_TUS_PUBLIC_ENDPOINT")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| Some(base_path.clone()));
    let upload_dir =
        读取可选环境变量("MEDIA_TUS_UPLOAD_DIR").unwrap_or_else(|| "data/tus".to_string());
    let internal_base_url = 读取可选环境变量("MEDIA_TUS_INTERNAL_BASE_URL")
        .map(|value| value.trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    let internal_termination_token =
        读取可选环境变量("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

    Ok(媒体Tus侧车配置 {
        public_endpoint,
        server_port,
        base_path,
        upload_dir,
        internal_base_url,
        internal_termination_token,
    })
}

/// 媒体存储驱动默认保持在本地目录，保证测试和最小回滚窗仍然可自洽。
/// 真正要切对象存储直传时，必须显式把驱动切到 `s3` 并给全套配置。
pub fn 读取媒体存储配置() -> io::Result<媒体存储配置> {
    let raw_driver = env::var("MEDIA_STORAGE_DRIVER")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "local".to_string());
    let 驱动 = match raw_driver.as_str() {
        "local" => 媒体存储驱动::本地目录,
        "s3" => 媒体存储驱动::S3对象存储,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("MEDIA_STORAGE_DRIVER 非法: {raw_driver}"),
            ));
        }
    };
    let endpoint = 读取可选环境变量("MEDIA_STORAGE_ENDPOINT");
    let public_endpoint = 读取可选环境变量("MEDIA_STORAGE_PUBLIC_ENDPOINT");
    let bucket = 读取可选环境变量("MEDIA_STORAGE_BUCKET");
    let access_key_id = 读取可选环境变量("MEDIA_STORAGE_ACCESS_KEY_ID");
    let secret_access_key = 读取可选环境变量("MEDIA_STORAGE_SECRET_ACCESS_KEY");
    let region = env::var("MEDIA_STORAGE_REGION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "us-east-1".to_string());
    let path_style = 读取布尔环境变量("MEDIA_STORAGE_PATH_STYLE", false)?;

    if matches!(驱动, 媒体存储驱动::S3对象存储) {
        if bucket.is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "MEDIA_STORAGE_BUCKET 不能为空",
            ));
        }
        if access_key_id.is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "MEDIA_STORAGE_ACCESS_KEY_ID 不能为空",
            ));
        }
        if secret_access_key.is_none() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "MEDIA_STORAGE_SECRET_ACCESS_KEY 不能为空",
            ));
        }
    }

    Ok(媒体存储配置 {
        驱动,
        endpoint,
        public_endpoint,
        bucket,
        region,
        access_key_id,
        secret_access_key,
        path_style,
    })
}

/// 协作分发运行参数默认保持“浏览器同源 + tracker 内收”：
/// 1. 浏览器 public announce 默认直接收口成同源 `/api/swarm/announce`；
/// 2. web seed public endpoint 为空时，后端继续下发同源相对地址；
/// 3. ticket secret 允许为空，此时 locator/complete 会显式不签发门禁令牌；
/// 4. ticket TTL 默认 120 秒，保证浏览器不会长期复用旧门票；
/// 5. stale 秒数先保守收口为 180 秒，给后续 Phase 3 的 presence 裁决复用；
/// 6. 冷源清理默认每 60 秒扫一次，保证 TTL 真相不会只停留在数据库时间戳；
/// 7. 做种对账默认比 ticket TTL 更短，避免 sidecar 拿旧票持续 announce；
/// 8. seeder 命令面默认回落 `http://127.0.0.1:${SWARM_SEEDER_PORT|7073}`，避免 owner 调度入口漂移。
/// 9. tracker upstream 只给 Rust 同源代理使用，浏览器/sidecar 都不能裸连绕过验票。
/// 10. sidecar tracker 默认回落后端同源认证入口，public WSS 只给浏览器 locator。
pub fn 读取协作分发配置() -> io::Result<协作分发配置> {
    let tracker_port = 读取可选端口("SWARM_TRACKER_PORT", 7072)?;
    let seeder_port = 读取可选端口("SWARM_SEEDER_PORT", 7073)?;
    let app_port = 读取可选端口("APP_PORT", 8080)?;
    let tracker_public_url = 读取可选环境变量("SWARM_TRACKER_PUBLIC_URL")
        .unwrap_or_else(|| 同源协作分发ANNOUNCE路径.to_string());
    let tracker_upstream_url = 读取可选环境变量("SWARM_TRACKER_UPSTREAM_URL")
        .unwrap_or_else(|| format!("ws://127.0.0.1:{tracker_port}"));
    let tracker_upstream_url = tracker_upstream_url.trim().to_string();
    if tracker_upstream_url.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "环境变量 SWARM_TRACKER_UPSTREAM_URL 不能为空",
        ));
    }
    let seeder_tracker_url = 读取可选环境变量("SWARM_SEEDER_TRACKER_URL")
        .unwrap_or_else(|| format!("ws://127.0.0.1:{app_port}/api/swarm/announce"));
    let seeder_tracker_url = seeder_tracker_url.trim().to_string();
    if seeder_tracker_url.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "环境变量 SWARM_SEEDER_TRACKER_URL 不能为空",
        ));
    }
    let web_seed_public_endpoint = 读取可选环境变量("SWARM_WEB_SEED_PUBLIC_ENDPOINT");
    let seeder_control_base_url = 读取可选环境变量("SWARM_SEEDER_CONTROL_BASE_URL")
        .unwrap_or_else(|| format!("http://127.0.0.1:{seeder_port}"));
    let seeder_control_base_url = seeder_control_base_url.trim_end_matches('/').to_string();
    if seeder_control_base_url.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "环境变量 SWARM_SEEDER_CONTROL_BASE_URL 不能为空",
        ));
    }
    let ticket_secret = 读取可选环境变量("SWARM_TICKET_SECRET");
    let cloudflare_turn_key_id = 读取可选环境变量("CLOUDFLARE_TURN_KEY_ID");
    let cloudflare_turn_api_token = 读取可选环境变量("CLOUDFLARE_TURN_API_TOKEN");
    let ticket_ttl_seconds = 读取可选整数("SWARM_TICKET_TTL_SECONDS", 120).and_then(|value| {
        if value <= 0 {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("环境变量 SWARM_TICKET_TTL_SECONDS 必须大于 0: {value}"),
            ))
        } else {
            Ok(value)
        }
    })?;
    let peer_presence_stale_seconds = 读取可选整数("SWARM_PEER_PRESENCE_STALE_SECONDS", 180)?;
    let media_origin_cleanup_interval_seconds =
        读取可选整数("MEDIA_ORIGIN_CLEANUP_INTERVAL_SECONDS", 60)?;
    let default_seed_reconcile_interval_seconds = if ticket_ttl_seconds > 1 {
        (ticket_ttl_seconds / 2)
            .clamp(1, 60)
            .min(ticket_ttl_seconds - 1)
    } else {
        1
    };
    let swarm_seed_reconcile_interval_seconds = 读取可选整数(
        "SWARM_SEED_RECONCILE_INTERVAL_SECONDS",
        default_seed_reconcile_interval_seconds,
    )?;
    if swarm_seed_reconcile_interval_seconds <= 0
        || swarm_seed_reconcile_interval_seconds >= ticket_ttl_seconds
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "环境变量 SWARM_SEED_RECONCILE_INTERVAL_SECONDS 必须大于 0 且小于 SWARM_TICKET_TTL_SECONDS",
        ));
    }

    Ok(协作分发配置 {
        tracker_public_url,
        tracker_port,
        tracker_upstream_url,
        web_seed_public_endpoint,
        seeder_control_base_url,
        seeder_tracker_url,
        ticket_secret,
        ticket_ttl_seconds,
        peer_presence_stale_seconds,
        media_origin_cleanup_interval_seconds,
        swarm_seed_reconcile_interval_seconds,
        cloudflare_turn_key_id,
        cloudflare_turn_api_token,
    })
}

/// 上传完成阶段的重活默认只允许少量并发进入：
/// 1. 这不是业务规则，而是保护 complete 热点的资源闸门；
/// 2. 默认值现在向吞吐侧再推一档，让“字节传完以后”的 ready 速度不要继续被过低闸门拖住；
/// 3. 显式环境变量仍可覆盖，方便公网部署按机器规格调优。
pub fn 读取媒体上传完成并发上限() -> io::Result<usize> {
    let raw = 读取可选环境变量("MEDIA_COMPLETE_MAX_CONCURRENCY");
    match raw.as_deref() {
        None => Ok(4),
        Some(value) => value
            .parse::<usize>()
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("环境变量 MEDIA_COMPLETE_MAX_CONCURRENCY 不是合法整数: {value}"),
                )
            })
            .and_then(|value| {
                if value == 0 {
                    Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "MEDIA_COMPLETE_MAX_CONCURRENCY 不能为 0",
                    ))
                } else {
                    Ok(value)
                }
            }),
    }
}

fn 读取可选环境变量(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn 读取可选端口(key: &str, default_value: u16) -> io::Result<u16> {
    let Some(raw) = env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_value);
    };
    raw.parse::<u16>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 不是合法端口: {raw}"),
        )
    })
}

fn 读取可选整数(key: &str, default_value: i64) -> io::Result<i64> {
    let Some(raw) = env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_value);
    };
    raw.parse::<i64>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 不是合法整数: {raw}"),
        )
    })
}

fn 读取可选_u32<F>(read: &mut F, key: &str, default_value: u32) -> io::Result<u32>
where
    F: FnMut(&str) -> Option<String>,
{
    let Some(raw) = read(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_value);
    };
    raw.parse::<u32>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 不是合法非负整数: {raw}"),
        )
    })
}

fn 读取可选正_u32<F>(read: &mut F, key: &str, default_value: u32) -> io::Result<u32>
where
    F: FnMut(&str) -> Option<String>,
{
    let value = 读取可选_u32(read, key, default_value)?;
    if value == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 必须大于 0"),
        ));
    }
    Ok(value)
}

fn 读取可选正_u64<F>(read: &mut F, key: &str, default_value: u64) -> io::Result<u64>
where
    F: FnMut(&str) -> Option<String>,
{
    let Some(raw) = read(key)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_value);
    };
    let value = raw.parse::<u64>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 不是合法正整数: {raw}"),
        )
    })?;
    if value == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 必须大于 0"),
        ));
    }
    Ok(value)
}

fn 读取布尔环境变量(key: &str, default_value: bool) -> io::Result<bool> {
    let Some(raw) = env::var(key)
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
    else {
        return Ok(default_value);
    };
    match raw.as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 不是合法布尔值: {raw}"),
        )),
    }
}

// ─── PoW 防御配置 ───

/// PoW 防御配置只描述"门禁如何读取密钥和信任代理"。
/// 自适应难度参数是运行态值对象，归 adapter 层（连接门禁）own，不混在这里。
#[derive(Debug, Clone)]
pub struct PoW配置 {
    /// HMAC-SHA256 签名密钥，至少 32 字节。
    pub secret: Vec<u8>,
    /// 是否信任反代的 X-Forwarded-For（Caddy 部署场景为 true）。
    pub trusted_proxy: bool,
}

/// 从环境变量读取 PoW 防御配置（生产入口）。
#[allow(non_snake_case)]
pub fn 读取PoW配置() -> io::Result<PoW配置> {
    读取PoW配置_with(|key| env::var(key).ok())
}

/// 可注入读取函数的 PoW 配置构建器，方便测试时不污染进程级环境变量。
#[allow(non_snake_case)]
pub fn 读取PoW配置_with<F>(mut read: F) -> io::Result<PoW配置>
where
    F: FnMut(&str) -> Option<String>,
{
    let enabled = read("KOKO_POW_ENABLED")
        .map(|value| value.trim().to_ascii_lowercase())
        .map(|value| !matches!(value.as_str(), "0" | "false" | "no" | "off"))
        .unwrap_or(true);
    if !enabled {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "KOKO_POW_ENABLED=false，PoW 防御已显式关闭",
        ));
    }
    let secret_str = read("KOKO_POW_SECRET").ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "缺少 KOKO_POW_SECRET 环境变量（至少 32 字节随机字符串，用于 HMAC 签名）",
        )
    })?;
    if secret_str.len() < 32 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "KOKO_POW_SECRET 至少需要 32 字节",
        ));
    }
    let trusted_proxy = read("KOKO_TRUSTED_PROXY")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    Ok(PoW配置 {
        secret: secret_str.into_bytes(),
        trusted_proxy,
    })
}

#[cfg(test)]
#[path = "组合根/配置测试.rs"]
mod tests;

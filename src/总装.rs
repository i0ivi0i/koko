use std::{
    env, io, panic,
    sync::{Once, OnceLock},
};
use tracing_subscriber::{fmt::time::OffsetTime, EnvFilter};

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
}

/// 媒体存储驱动只回答“上传对象最终落在哪类后端”。
/// 它不回答消息业务问题，也不夹带前端页面流程。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 媒体存储驱动 {
    本地目录,
    S3兼容,
}

/// 媒体存储配置是启动期真相：
/// - local 只需要本地目录；
/// - s3 兼容直传则需要 endpoint / bucket / credentials 等信息。
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

    Ok(配置 {
        database_url,
        admin_password,
        app_port,
        rust_log,
        attachment_storage_dir,
        media_storage,
    })
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
        usecase = "未恢复崩溃",
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
pub async fn 自动追平迁移(database_url: &str) -> io::Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .map_err(|err| io::Error::other(format!("连接数据库失败: {err}")))?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|err| io::Error::other(format!("执行迁移失败: {err}")))?;

    pool.close().await;
    Ok(())
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
        "s3" => 媒体存储驱动::S3兼容,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("MEDIA_STORAGE_DRIVER 非法: {raw_driver}"),
            ))
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

    if matches!(驱动, 媒体存储驱动::S3兼容) {
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

fn 读取可选环境变量(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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

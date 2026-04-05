use std::{env, io};
use tracing_subscriber::EnvFilter;

/// 启动配置聚合对象：只存“启动必需项”，不混入业务态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 配置 {
    pub database_url: String,
    pub admin_password: String,
    pub app_port: u16,
    pub rust_log: String,
}

/// 读取启动所需的最小配置。缺关键配置时必须失败，避免静默启动。
pub fn 读取配置() -> io::Result<配置> {
    // 先尝试读取 .env，再读系统环境变量；缺失必填项直接失败。
    尝试加载dotenv();
    let database_url = 读取必填环境变量("DATABASE_URL")?;
    let admin_password = 读取必填环境变量("ADMIN_PASSWORD")?;
    let app_port = 读取端口("APP_PORT")?;
    let rust_log = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());

    Ok(配置 {
        database_url,
        admin_password,
        app_port,
        rust_log,
    })
}

/// 日志系统必须天然存在：启动时默认初始化，开发和生产只在详细度上有差异。
pub fn 初始化日志() -> io::Result<()> {
    // 日志初始化也走同一套环境变量读取，确保 run.ps1 / cargo run 行为一致。
    尝试加载dotenv();
    let filter_text = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let filter = EnvFilter::try_new(filter_text.clone()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("RUST_LOG 非法: {filter_text}"),
        )
    })?;

    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_level(true)
        .finish();

    // 进程级全局 subscriber：让任意层都天然可见日志输出。
    let _ = tracing::subscriber::set_global_default(subscriber);
    Ok(())
}

/// 可选加载 dotenv。
/// `KOKO_SKIP_DOTENV=1` 用于测试场景，避免测试被本机 .env 污染。
fn 尝试加载dotenv() {
    if env::var("KOKO_SKIP_DOTENV").ok().as_deref() == Some("1") {
        return;
    }
    let _ = dotenvy::dotenv();
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

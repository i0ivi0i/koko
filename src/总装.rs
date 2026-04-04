use std::{env, io};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 配置 {
    pub database_url: String,
    pub admin_password: String,
    pub app_port: u16,
    pub rust_log: String,
}

/// 读取启动所需的最小配置。缺关键配置时必须失败，避免静默启动。
pub fn 读取配置() -> io::Result<配置> {
    let _ = dotenvy::dotenv();
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
    let _ = dotenvy::dotenv();
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

    let _ = tracing::subscriber::set_global_default(subscriber);
    Ok(())
}

fn 读取必填环境变量(key: &str) -> io::Result<String> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("缺少必填环境变量: {key}"),
        )),
    }
}

fn 读取端口(key: &str) -> io::Result<u16> {
    let raw = 读取必填环境变量(key)?;
    raw.parse::<u16>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("环境变量 {key} 不是合法端口: {raw}"),
        )
    })
}

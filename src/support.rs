#[cfg(not(target_arch = "wasm32"))]
use std::{
    collections::BTreeSet,
    convert::Infallible,
    env, fs, io,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
#[cfg(not(target_arch = "wasm32"))]
use if_addrs::Interface;
use sha2::{Digest, Sha256};
#[cfg(not(target_arch = "wasm32"))]
use thiserror::Error;
#[cfg(not(target_arch = "wasm32"))]
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::{
    app::{AdminCredentialPort, AppError, Clock, IdGenerator},
    contract::AppErrorCode,
};

pub const APP_NAME: &str = "koko";
#[cfg(not(target_arch = "wasm32"))]
pub const DEFAULT_TRACING_FILTER: &str = "info,tower_http=trace";
pub const SESSION_COOKIE_NAME: &str = "koko_session";

#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8080";
#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_CONFIG_PATH: &str = "config/koko.toml";
#[cfg(not(target_arch = "wasm32"))]
const DATABASE_URL_ENV: &str = "KOKO_DATABASE_URL";
#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_DEV_DATABASE_URL: &str = "postgres://postgres:postgres@127.0.0.1:5432/koko_dev_chat";
#[cfg(not(target_arch = "wasm32"))]
const ADMIN_TOKEN_ENV: &str = "KOKO_ADMIN_TOKEN";
#[cfg(not(target_arch = "wasm32"))]
const ADMIN_COOKIE_SECURE_ENV: &str = "KOKO_ADMIN_COOKIE_SECURE";

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub admin_token: String,
    pub admin_token_notice: Option<String>,
    pub admin_cookie_secure: bool,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub config_path: PathBuf,
    pub admin_token_seed: Option<String>,
    pub admin_cookie_secure: bool,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartupBanner {
    pub home_urls: Vec<String>,
    pub lan_urls: Vec<String>,
    pub admin_url: String,
    pub admin_token: String,
    pub admin_token_notice: Option<String>,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct StartupLanAddressCandidate {
    pub display_name: String,
    pub system_name: Option<String>,
    pub ip: IpAddr,
    pub is_up: bool,
    pub is_loopback_interface: bool,
    pub is_tunnel_interface: bool,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing environment variable {0}")]
    MissingEnv(&'static str),
    #[error("empty environment variable {0}")]
    EmptyEnv(&'static str),
    #[error("invalid bind address `{value}`: {source}")]
    InvalidBindAddr {
        value: String,
        source: std::net::AddrParseError,
    },
    #[error("invalid boolean environment variable {name}: `{value}`")]
    InvalidBoolEnv { name: &'static str, value: String },
    #[error("failed to read config file `{path}`: {source}")]
    ReadConfig { path: PathBuf, source: io::Error },
    #[error("failed to write config file `{path}`: {source}")]
    WriteConfig { path: PathBuf, source: io::Error },
    #[error("invalid config file `{path}`: expected `admin_token = \"...\"`")]
    InvalidConfigFile { path: PathBuf },
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TracingInit {
    Initialized,
    AlreadyInitialized,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemClock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemIdGenerator;

pub fn app_name() -> &'static str {
    APP_NAME
}

pub fn app_error_code(error: &AppError) -> &'static str {
    match error.code() {
        AppErrorCode::InvalidSession => "invalid_session",
        AppErrorCode::MembershipRequired => "membership_required",
        AppErrorCode::InvalidRoomCode => "invalid_room_code",
        AppErrorCode::InvalidMessageBody => "invalid_message_body",
        AppErrorCode::InvalidAdminToken => "invalid_admin_token",
        AppErrorCode::AdminSessionRequired => "admin_session_required",
        AppErrorCode::AdminSessionExpired => "admin_session_expired",
        AppErrorCode::AdminSessionReplaced => "admin_session_replaced",
        AppErrorCode::Internal => "internal",
    }
}

pub fn admin_token_fingerprint(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(not(target_arch = "wasm32"))]
pub fn build_startup_banner_from_bind_addr(
    bind_addr: SocketAddr,
    config: &AppConfig,
) -> StartupBanner {
    let lan_candidates = discover_startup_banner_lan_candidates().unwrap_or_default();
    build_startup_banner_from_bind_addr_with_lan_candidates(bind_addr, config, &lan_candidates)
}

#[cfg(not(target_arch = "wasm32"))]
fn build_startup_banner_from_bind_addr_with_lan_candidates(
    bind_addr: SocketAddr,
    config: &AppConfig,
    lan_candidates: &[StartupLanAddressCandidate],
) -> StartupBanner {
    // 启动横幅的事实必须在 Rust 里生成，而不是继续交给脚本各自推导。
    // 这样 bind_addr、管理员口令和启动提示才能共享同一份真相，避免壳层和脚本打印出不同口径。
    // 局域网地址只补启动展示，不反向影响 bind/config 真相链，也不沉淀成新的网络发现层。
    let home_url = startup_banner_home_url(bind_addr);
    let lan_urls = collect_startup_banner_lan_urls(bind_addr, lan_candidates);

    StartupBanner {
        home_urls: vec![home_url.clone()],
        lan_urls,
        admin_url: format!("{home_url}admin"),
        admin_token: config.admin_token.clone(),
        admin_token_notice: config.admin_token_notice.clone(),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn collect_startup_banner_lan_urls(
    bind_addr: SocketAddr,
    lan_candidates: &[StartupLanAddressCandidate],
) -> Vec<String> {
    if !bind_addr.ip().is_unspecified() {
        return Vec::new();
    }

    let port = bind_addr.port();
    let mut urls = BTreeSet::new();

    for candidate in lan_candidates {
        if !candidate.is_up
            || candidate.is_loopback_interface
            || candidate.is_tunnel_interface
            || startup_banner_interface_name_matches_blocklist(candidate)
        {
            continue;
        }

        let IpAddr::V4(ipv4) = candidate.ip else {
            continue;
        };

        if ipv4.is_loopback() || ipv4.is_link_local() {
            continue;
        }

        urls.insert(format!("http://{ipv4}:{port}/"));
    }

    urls.into_iter().collect()
}

#[cfg(not(target_arch = "wasm32"))]
pub fn write_startup_banner_if_ready<W: std::io::Write>(
    sink: &mut W,
    ready_addr: Result<SocketAddr, &'static str>,
    config: &AppConfig,
) -> io::Result<()> {
    // 横幅是给人看的启动事实，不属于 tracing 的结构化日志。
    // 只有等到 ready 地址确定后再写，才能避免在数据库、迁移或 bind 失败时误报“已启动”。
    let Ok(bind_addr) = ready_addr else {
        return Ok(());
    };

    let banner = build_startup_banner_from_bind_addr(bind_addr, config);
    for line in banner.render_lines() {
        writeln!(sink, "{line}")?;
    }

    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
fn startup_banner_home_url(bind_addr: SocketAddr) -> String {
    let port = bind_addr.port();
    match bind_addr.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => format!("http://127.0.0.1:{port}/"),
        IpAddr::V6(ip) if ip.is_unspecified() => format!("http://[::1]:{port}/"),
        IpAddr::V4(ip) => format!("http://{ip}:{port}/"),
        IpAddr::V6(ip) => format!("http://[{ip}]:{port}/"),
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl StartupBanner {
    // 启动横幅有两条去向：`render_lines()` 只服务终端直出，`render_persistent_log_lines()`
    // 只给长期技术日志。后者默认不落管理员口令，避免把一次性敏感信息写进常驻日志。
    pub fn render_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();

        if let Some(home_url) = self.home_urls.first() {
            lines.push(format!("==> 首页地址: {home_url}"));
        }

        lines.push(format!("==> 管理入口: {}", self.admin_url));
        lines.push(format!("==> 当前管理员口令: {}", self.admin_token));

        if let Some(notice) = self.admin_token_notice.as_deref() {
            lines.push(format!("==> {notice}"));
        }

        if !self.lan_urls.is_empty() {
            lines.push("==> 局域网设备请访问:".to_string());
            for url in &self.lan_urls {
                lines.push(format!("   {url}"));
            }
            lines.push("==> 局域网管理入口:".to_string());
            for url in &self.lan_urls {
                lines.push(format!("   {url}admin"));
            }
        }

        lines
    }

    pub fn render_persistent_log_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();

        if let Some(home_url) = self.home_urls.first() {
            lines.push(format!("==> 首页地址: {home_url}"));
        }

        lines.push(format!("==> 管理入口: {}", self.admin_url));

        if let Some(notice) = self.admin_token_notice.as_deref() {
            lines.push(format!("==> {notice}"));
        }

        if !self.lan_urls.is_empty() {
            lines.push("==> 局域网设备请访问:".to_string());
            for url in &self.lan_urls {
                lines.push(format!("   {url}"));
            }
            lines.push("==> 局域网管理入口:".to_string());
            for url in &self.lan_urls {
                lines.push(format!("   {url}admin"));
            }
        }

        lines
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<Interface> for StartupLanAddressCandidate {
    fn from(interface: Interface) -> Self {
        let ip = interface.ip();
        let is_up = interface.is_oper_up();
        let is_loopback_interface = interface.is_loopback();
        #[cfg(windows)]
        let system_name = Some(interface.adapter_name.clone());
        #[cfg(not(windows))]
        let system_name = None;

        Self {
            display_name: interface.name,
            system_name,
            ip,
            is_up,
            is_loopback_interface,
            // 标准库没有跨平台网卡枚举；对比过 `network-interface` 和 `if-addrs` 后，
            // 这里只有 `if-addrs` 同时暴露 oper status、loopback 判断和 Windows adapter_name，
            // 因此选它做启动展示补齐。它公开的 `is_p2p()` 在多平台上会把 PPP 和 tunnel 混在一起，
            // 超出本次 spec 允许的过滤范围，所以这里默认不把 point-to-point 直接当 tunnel。
            is_tunnel_interface: false,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn discover_startup_banner_lan_candidates() -> io::Result<Vec<StartupLanAddressCandidate>> {
    // 这里的网卡枚举只服务启动横幅展示补齐，失败时退化为“不打印 LAN 列表”。
    // 启动真相仍由 bind 地址决定，不让可选展示逻辑反客为主影响 ready 链。
    if_addrs::get_if_addrs().map(|interfaces| interfaces.into_iter().map(Into::into).collect())
}

#[cfg(not(target_arch = "wasm32"))]
fn startup_banner_interface_name_matches_blocklist(
    candidate: &StartupLanAddressCandidate,
) -> bool {
    // 这些关键字只服务启动横幅的展示去噪，避免把容器/虚拟网卡误当成对外访问提示。
    // 它们不是新的网络发现真相，更不能被别处复用成“系统网络策略”。
    const BLOCKED_KEYWORDS: [&str; 10] = [
        "docker",
        "container",
        "veth",
        "hyper-v",
        "vethernet",
        "wsl",
        "vmware",
        "virtualbox",
        "tailscale",
        "zerotier",
    ];

    let display_name = candidate.display_name.to_ascii_lowercase();
    let system_name = candidate
        .system_name
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();

    BLOCKED_KEYWORDS
        .iter()
        .any(|keyword| display_name.contains(keyword) || system_name.contains(keyword))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminTokenVerifier {
    expected_token: String,
}

impl AdminTokenVerifier {
    pub fn new(expected_token: String) -> Self {
        Self { expected_token }
    }
}

impl AdminCredentialPort for AdminTokenVerifier {
    async fn verify_admin_token(&self, token: &str) -> Result<bool, AppError> {
        Ok(token == self.expected_token)
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn init_tracing(default_filter: &str) -> Result<TracingInit, Infallible> {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter));
    let subscriber = tracing_subscriber_builder(filter).finish();

    let result = match tracing::subscriber::set_global_default(subscriber) {
        Ok(()) => TracingInit::Initialized,
        Err(_) => TracingInit::AlreadyInitialized,
    };

    Ok(result)
}

#[cfg(not(target_arch = "wasm32"))]
fn tracing_subscriber_builder(
    filter: EnvFilter,
) -> tracing_subscriber::fmt::SubscriberBuilder<
    tracing_subscriber::fmt::format::DefaultFields,
    tracing_subscriber::fmt::format::Format<tracing_subscriber::fmt::format::Compact>,
    EnvFilter,
    fn() -> io::Stdout,
> {
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .compact()
}

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

impl IdGenerator for SystemIdGenerator {
    fn next_message_id(&self) -> Uuid {
        Uuid::now_v7()
    }

    fn next_room_id(&self) -> Uuid {
        Uuid::now_v7()
    }

    fn next_room_code_id(&self) -> Uuid {
        Uuid::now_v7()
    }

    fn next_member_id(&self) -> Uuid {
        Uuid::now_v7()
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl AppConfig {
    pub fn load() -> Result<Self, ConfigError> {
        // 启动只认 config/koko.toml 作为管理员口令真相；环境变量这里只承接一次性迁移入口。
        Self::load_from_resolved(ResolvedAppConfig::load()?)
    }

    pub fn load_with_overrides(
        database_url: Option<&str>,
        bind_addr: Option<&str>,
        config_path: Option<PathBuf>,
        admin_token_seed: Option<&str>,
        admin_cookie_secure_override: Option<bool>,
    ) -> Result<Self, ConfigError> {
        Self::load_from_resolved(ResolvedAppConfig::load_with_overrides(
            database_url,
            bind_addr,
            config_path,
            admin_token_seed,
            admin_cookie_secure_override,
        )?)
    }

    pub fn load_for_test(
        database_url: Option<&str>,
        bind_addr: Option<&str>,
        config_path: impl Into<PathBuf>,
        admin_token_seed: Option<&str>,
        admin_cookie_secure_override: Option<bool>,
    ) -> Result<Self, ConfigError> {
        Self::load_from_resolved(ResolvedAppConfig::load_for_test(
            database_url,
            bind_addr,
            config_path,
            admin_token_seed,
            admin_cookie_secure_override,
        )?)
    }

    fn load_from_resolved(resolved: ResolvedAppConfig) -> Result<Self, ConfigError> {
        let (admin_token, admin_token_notice) = load_or_bootstrap_admin_token(
            &resolved.config_path,
            resolved.admin_token_seed.as_deref(),
        )?;

        Ok(Self {
            database_url: resolved.database_url,
            bind_addr: resolved.bind_addr,
            admin_token,
            admin_token_notice,
            admin_cookie_secure: resolved.admin_cookie_secure,
        })
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl ResolvedAppConfig {
    pub fn load() -> Result<Self, ConfigError> {
        Self::load_with_overrides(None, None, None, None, None)
    }

    pub fn load_with_overrides(
        database_url: Option<&str>,
        bind_addr: Option<&str>,
        config_path: Option<PathBuf>,
        admin_token_seed: Option<&str>,
        admin_cookie_secure_override: Option<bool>,
    ) -> Result<Self, ConfigError> {
        let mut resolved =
            Self::load_common_with_overrides(database_url, bind_addr, config_path, admin_cookie_secure_override)?;
        let admin_token_seed = match admin_token_seed {
            Some(raw) => Some(parse_required_value(ADMIN_TOKEN_ENV, Some(raw))?),
            None => env::var(ADMIN_TOKEN_ENV).ok().map(|value| value.trim().to_string()),
        };
        resolved.admin_token_seed = admin_token_seed;
        Ok(resolved)
    }

    pub fn load_for_test(
        database_url: Option<&str>,
        bind_addr: Option<&str>,
        config_path: impl Into<PathBuf>,
        admin_token_seed: Option<&str>,
        admin_cookie_secure_override: Option<bool>,
    ) -> Result<Self, ConfigError> {
        let database_url = parse_required_value(DATABASE_URL_ENV, database_url)?;
        let bind_addr_raw = bind_addr.unwrap_or(DEFAULT_BIND_ADDR).trim().to_string();
        let bind_addr = bind_addr_raw
            .parse()
            .map_err(|source| ConfigError::InvalidBindAddr {
                value: bind_addr_raw,
                source,
            })?;
        let admin_token_seed = match admin_token_seed {
            Some(raw) => Some(parse_required_value(ADMIN_TOKEN_ENV, Some(raw))?),
            None => None,
        };

        Ok(Self {
            database_url,
            bind_addr,
            config_path: config_path.into(),
            admin_token_seed,
            admin_cookie_secure: admin_cookie_secure_override.unwrap_or(false),
        })
    }

    pub fn load_for_dev_preview(
        database_url: Option<&str>,
        bind_addr: Option<&str>,
        config_path: Option<PathBuf>,
        admin_cookie_secure_override: Option<bool>,
    ) -> Result<Self, ConfigError> {
        // dev preview 只需要和主程序同源的地址/数据库/安全位解析结果；
        // 管理员口令真相仍必须留给真实启动路径去读/写 config/koko.toml。
        // 开发启动入口仍需要受控的本地数据库默认值，
        // 这样 `run.ps1` 才能保持开箱可跑，而不把薄壳重新做重。
        let dev_database_url = database_url
            .map(ToOwned::to_owned)
            .or_else(|| env::var(DATABASE_URL_ENV).ok())
            .or_else(|| Some(DEFAULT_DEV_DATABASE_URL.to_string()));

        Self::load_common_with_overrides(
            dev_database_url.as_deref(),
            bind_addr,
            config_path,
            admin_cookie_secure_override,
        )
    }

    fn load_common_with_overrides(
        database_url: Option<&str>,
        bind_addr: Option<&str>,
        config_path: Option<PathBuf>,
        admin_cookie_secure_override: Option<bool>,
    ) -> Result<Self, ConfigError> {
        let database_url = match database_url {
            Some(raw) => parse_required_value(DATABASE_URL_ENV, Some(raw))?,
            None => parse_required_value(
                DATABASE_URL_ENV,
                env::var(DATABASE_URL_ENV).ok().as_deref(),
            )?,
        };
        let bind_addr_raw = match bind_addr {
            Some(raw) => raw.trim().to_string(),
            None => env::var("KOKO_BIND_ADDR").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string()),
        };
        let bind_addr = bind_addr_raw
            .parse()
            .map_err(|source| ConfigError::InvalidBindAddr {
                value: bind_addr_raw,
                source,
            })?;
        let admin_cookie_secure = match admin_cookie_secure_override {
            Some(value) => value,
            None => parse_admin_cookie_secure(env::var(ADMIN_COOKIE_SECURE_ENV).ok().as_deref())?,
        };

        Ok(Self {
            database_url,
            bind_addr,
            config_path: config_path.unwrap_or_else(|| PathBuf::from(DEFAULT_CONFIG_PATH)),
            admin_token_seed: None,
            admin_cookie_secure,
        })
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_required_value(name: &'static str, value: Option<&str>) -> Result<String, ConfigError> {
    let Some(raw) = value else {
        return Err(ConfigError::MissingEnv(name));
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ConfigError::EmptyEnv(name));
    }
    Ok(trimmed.to_string())
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_admin_cookie_secure(raw: Option<&str>) -> Result<bool, ConfigError> {
    let Some(raw) = raw else {
        return Ok(false);
    };
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(ConfigError::InvalidBoolEnv {
            name: ADMIN_COOKIE_SECURE_ENV,
            value: raw.to_string(),
        }),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn load_or_bootstrap_admin_token(
    config_path: &Path,
    admin_token_seed: Option<&str>,
) -> Result<(String, Option<String>), ConfigError> {
    if config_path.exists() {
        let content =
            fs::read_to_string(config_path).map_err(|source| ConfigError::ReadConfig {
                path: config_path.to_path_buf(),
                source,
            })?;
        let token = parse_admin_token_from_config(config_path, &content)?;
        return Ok((token, None));
    }

    // 管理员口令真相必须落在配置文件，避免入口脚本或环境变量各自持有一份事实。
    // KOKO_ADMIN_TOKEN 只允许作为“文件首次缺失时的一跳迁移入口”，写入后立即由文件接管。
    let (token, notice) = match admin_token_seed {
        Some(raw) => {
            let token = parse_required_value(ADMIN_TOKEN_ENV, Some(raw))?;
            (
                token,
                Some(
                    "检测到 KOKO_ADMIN_TOKEN，已一次性导入 config/koko.toml；后续将以配置文件为准。"
                        .to_string(),
                ),
            )
        }
        None => (
            format!("admin-{}", Uuid::now_v7()),
            Some("首次启动未发现 config/koko.toml，已自动生成管理员口令并写入该文件。".to_string()),
        ),
    };

    write_admin_token_config(config_path, &token)?;
    Ok((token, notice))
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_admin_token_from_config(config_path: &Path, content: &str) -> Result<String, ConfigError> {
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(2, '=');
        let Some(key) = parts.next().map(str::trim) else {
            break;
        };
        let Some(value) = parts.next().map(str::trim) else {
            break;
        };
        if key != "admin_token" {
            break;
        }
        let token =
            serde_json::from_str::<String>(value).map_err(|_| ConfigError::InvalidConfigFile {
                path: config_path.to_path_buf(),
            })?;
        if token.trim().is_empty() {
            return Err(ConfigError::InvalidConfigFile {
                path: config_path.to_path_buf(),
            });
        }
        return Ok(token);
    }

    Err(ConfigError::InvalidConfigFile {
        path: config_path.to_path_buf(),
    })
}

#[cfg(not(target_arch = "wasm32"))]
fn write_admin_token_config(config_path: &Path, admin_token: &str) -> Result<(), ConfigError> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|source| ConfigError::WriteConfig {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    let encoded_token =
        serde_json::to_string(admin_token).map_err(|source| ConfigError::WriteConfig {
            path: config_path.to_path_buf(),
            source: io::Error::new(io::ErrorKind::InvalidData, source),
        })?;
    fs::write(config_path, format!("admin_token = {encoded_token}\n")).map_err(|source| {
        ConfigError::WriteConfig {
            path: config_path.to_path_buf(),
            source,
        }
    })
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::{
        AppConfig, DEFAULT_TRACING_FILTER, StartupLanAddressCandidate,
        build_startup_banner_from_bind_addr_with_lan_candidates, collect_startup_banner_lan_urls,
        tracing_subscriber_builder,
    };
    use std::{
        env, fs, io,
        net::{IpAddr, Ipv4Addr, Ipv6Addr},
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };
    use tracing_subscriber::fmt::MakeWriter;
    use tracing_subscriber::EnvFilter;
    use uuid::Uuid;

    #[test]
    fn startup_banner_prefers_localhost_for_unspecified_ipv4_bind() {
        let banner = build_startup_banner_from_bind_addr_with_lan_candidates(
            "0.0.0.0:8080".parse().unwrap(),
            &sample_startup_config(),
            &sample_lan_candidates(),
        );

        assert_eq!(banner.home_urls[0], "http://127.0.0.1:8080/");
        assert_eq!(
            banner.lan_urls,
            vec![
                "http://10.0.0.9:8080/".to_string(),
                "http://10.8.0.2:8080/".to_string(),
                "http://192.168.1.20:8080/".to_string(),
            ]
        );
    }

    #[test]
    fn startup_banner_prefers_loopback_v6_for_unspecified_ipv6_bind() {
        let banner = build_startup_banner_from_bind_addr_with_lan_candidates(
            "[::]:8080".parse().unwrap(),
            &sample_startup_config(),
            &sample_lan_candidates(),
        );

        assert_eq!(banner.home_urls[0], "http://[::1]:8080/");
        assert_eq!(
            banner.lan_urls,
            vec![
                "http://10.0.0.9:8080/".to_string(),
                "http://10.8.0.2:8080/".to_string(),
                "http://192.168.1.20:8080/".to_string(),
            ]
        );
    }

    #[test]
    fn startup_banner_filters_and_sorts_lan_ipv4_candidates_per_spec() {
        let urls = collect_startup_banner_lan_urls(
            "0.0.0.0:8080".parse().unwrap(),
            &sample_lan_candidates(),
        );

        assert_eq!(
            urls,
            vec![
                "http://10.0.0.9:8080/".to_string(),
                "http://10.8.0.2:8080/".to_string(),
                "http://192.168.1.20:8080/".to_string(),
            ]
        );
    }

    #[test]
    fn startup_banner_skips_lan_urls_for_explicit_bind_host() {
        let urls = collect_startup_banner_lan_urls(
            "192.168.1.88:8080".parse().unwrap(),
            &sample_lan_candidates(),
        );

        assert!(urls.is_empty());
    }

    #[test]
    fn init_tracing_uses_compact_target_formatter() {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber_builder(EnvFilter::new("info"))
            .with_writer(BufferWriter(buffer.clone()))
            .with_ansi(false)
            .finish();

        tracing::subscriber::with_default(subscriber, || {
            let span = tracing::info_span!("format_guard_span");
            let _entered = span.enter();
            tracing::info!(request_id = 7, "hello");
        });

        let output = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
        assert!(output.contains("format_guard_span"), "{output}");
        assert!(output.contains("koko::support::tests"), "{output}");
        assert!(output.contains("request_id=7"), "{output}");
        assert!(output.lines().count() == 1, "{output}");
    }

    #[test]
    fn default_tracing_filter_keeps_http_trace_visible() {
        assert!(DEFAULT_TRACING_FILTER.contains("info"));
        assert!(DEFAULT_TRACING_FILTER.contains("tower_http=trace"));
    }

    fn sample_startup_config() -> AppConfig {
        let config_path = temp_config_file_path("support-startup-banner-sample");
        let _cleanup = TempConfigRootGuard::new(config_path.clone());
        AppConfig::load_for_test(
            Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
            Some("127.0.0.1:8080"),
            config_path,
            Some("local-admin-token"),
            None,
        )
        .unwrap()
    }

    fn sample_lan_candidates() -> Vec<StartupLanAddressCandidate> {
        vec![
            lan_candidate("Wi-Fi", Some("intel-wifi"), IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)), true, false, false),
            lan_candidate("Ethernet", Some("usb-lan"), IpAddr::V4(Ipv4Addr::new(10, 0, 0, 9)), true, false, false),
            lan_candidate("Wi-Fi Duplicate", Some("intel-wifi-2"), IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)), true, false, false),
            lan_candidate("Loopback Pseudo-Interface 1", Some("loopback"), IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), true, true, false),
            lan_candidate("Ethernet Link Local", Some("usb-lan-2"), IpAddr::V4(Ipv4Addr::new(169, 254, 12, 34)), true, false, false),
            lan_candidate("Docker Desktop", Some("docker0"), IpAddr::V4(Ipv4Addr::new(172, 17, 0, 1)), true, false, false),
            lan_candidate("vEthernet (WSL)", Some("wsl-switch"), IpAddr::V4(Ipv4Addr::new(172, 25, 160, 1)), true, false, false),
            lan_candidate("Ethernet Down", Some("rtl8168"), IpAddr::V4(Ipv4Addr::new(192, 168, 1, 30)), false, false, false),
            lan_candidate("PPP Adapter", Some("wan-miniport"), IpAddr::V4(Ipv4Addr::new(10, 8, 0, 2)), true, false, false),
            lan_candidate("Tunnel Adapter", Some("corp-tunnel"), IpAddr::V4(Ipv4Addr::new(10, 9, 0, 2)), true, false, true),
            lan_candidate("Wi-Fi IPv6", Some("intel-wifi-v6"), IpAddr::V6(Ipv6Addr::LOCALHOST), true, false, false),
        ]
    }

    fn lan_candidate(
        display_name: &str,
        system_name: Option<&str>,
        ip: IpAddr,
        is_up: bool,
        is_loopback_interface: bool,
        is_tunnel_interface: bool,
    ) -> StartupLanAddressCandidate {
        StartupLanAddressCandidate {
            display_name: display_name.to_string(),
            system_name: system_name.map(ToOwned::to_owned),
            ip,
            is_up,
            is_loopback_interface,
            is_tunnel_interface,
        }
    }

    fn temp_config_file_path(case_name: &str) -> PathBuf {
        env::temp_dir()
            .join("koko-tests")
            .join(format!("{case_name}-{}", Uuid::now_v7()))
            .join("config")
            .join("koko.toml")
    }

    struct TempConfigRootGuard(PathBuf);

    impl TempConfigRootGuard {
        fn new(config_file_path: PathBuf) -> Self {
            Self(config_file_path)
        }
    }

    impl Drop for TempConfigRootGuard {
        fn drop(&mut self) {
            remove_temp_config_root(&self.0);
        }
    }

    #[derive(Clone)]
    struct BufferWriter(Arc<Mutex<Vec<u8>>>);

    impl<'a> MakeWriter<'a> for BufferWriter {
        type Writer = BufferSink;

        fn make_writer(&'a self) -> Self::Writer {
            BufferSink(self.0.clone())
        }
    }

    struct BufferSink(Arc<Mutex<Vec<u8>>>);

    impl io::Write for BufferSink {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn remove_temp_config_root(config_file_path: &Path) {
        let Some(root) = config_file_path.parent().and_then(|value| value.parent()) else {
            return;
        };
        let _ = fs::remove_dir_all(root);
    }
}

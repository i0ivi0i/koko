#[cfg(not(target_arch = "wasm32"))]
use std::{convert::Infallible, env, net::SocketAddr};

use chrono::{DateTime, Utc};
#[cfg(not(target_arch = "wasm32"))]
use thiserror::Error;
#[cfg(not(target_arch = "wasm32"))]
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::{
    app::{
        AdminCredentialPort, AdminSessionContext, AdminSessionPort, AdminSessionState, AppError,
        Clock, IdGenerator,
    },
    contract::AppErrorCode,
};

pub const APP_NAME: &str = "koko";
#[cfg(not(target_arch = "wasm32"))]
pub const DEFAULT_TRACING_FILTER: &str = "info";
pub const SESSION_COOKIE_NAME: &str = "koko_session";

#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8080";

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub admin_token: String,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticAdminAccess {
    expected_token: String,
}

impl StaticAdminAccess {
    pub fn new(expected_token: String) -> Self {
        Self { expected_token }
    }
}

impl AdminCredentialPort for StaticAdminAccess {
    async fn verify_admin_token(&self, token: &str) -> Result<bool, AppError> {
        Ok(token == self.expected_token)
    }
}

impl AdminSessionPort for StaticAdminAccess {
    async fn create_admin_session(&self) -> Result<AdminSessionContext, AppError> {
        Ok(AdminSessionContext::new(Uuid::now_v7()))
    }

    async fn read_admin_session(
        &self,
        _context: &AdminSessionContext,
    ) -> Result<AdminSessionState, AppError> {
        Ok(AdminSessionState::Active)
    }

    async fn revoke_admin_session(
        &self,
        _context: &AdminSessionContext,
    ) -> Result<(), AppError> {
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn init_tracing(default_filter: &str) -> Result<TracingInit, Infallible> {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter));
    let subscriber = tracing_subscriber::fmt().with_env_filter(filter).finish();

    let result = match tracing::subscriber::set_global_default(subscriber) {
        Ok(()) => TracingInit::Initialized,
        Err(_) => TracingInit::AlreadyInitialized,
    };

    Ok(result)
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
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url = env::var("KOKO_DATABASE_URL")
            .map_err(|_| ConfigError::MissingEnv("KOKO_DATABASE_URL"))?;
        if database_url.trim().is_empty() {
            return Err(ConfigError::EmptyEnv("KOKO_DATABASE_URL"));
        }
        let admin_token = env::var("KOKO_ADMIN_TOKEN")
            .map_err(|_| ConfigError::MissingEnv("KOKO_ADMIN_TOKEN"))?;
        let admin_token = admin_token.trim().to_string();
        if admin_token.is_empty() {
            return Err(ConfigError::EmptyEnv("KOKO_ADMIN_TOKEN"));
        }
        let bind_addr_raw =
            env::var("KOKO_BIND_ADDR").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string());
        let bind_addr = bind_addr_raw
            .parse()
            .map_err(|source| ConfigError::InvalidBindAddr {
                value: bind_addr_raw,
                source,
            })?;

        Ok(Self {
            database_url: database_url.trim().to_string(),
            bind_addr,
            admin_token,
        })
    }
}

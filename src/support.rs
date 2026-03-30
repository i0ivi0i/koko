use std::{env, net::SocketAddr};

use thiserror::Error;

pub const APP_NAME: &str = "koko";

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:4000";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub admin_token: String,
}

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

pub fn app_name() -> &'static str {
    APP_NAME
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url =
            env::var("KOKO_DATABASE_URL").map_err(|_| ConfigError::MissingEnv("KOKO_DATABASE_URL"))?;
        let admin_token =
            env::var("KOKO_ADMIN_TOKEN").map_err(|_| ConfigError::MissingEnv("KOKO_ADMIN_TOKEN"))?;
        if admin_token.trim().is_empty() {
            return Err(ConfigError::EmptyEnv("KOKO_ADMIN_TOKEN"));
        }
        let bind_addr_raw = env::var("KOKO_BIND_ADDR").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string());
        let bind_addr = bind_addr_raw.parse().map_err(|source| ConfigError::InvalidBindAddr {
            value: bind_addr_raw,
            source,
        })?;

        Ok(Self {
            database_url,
            bind_addr,
            admin_token,
        })
    }
}

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalEnv {
    pub database_url: String,
    pub api_base: String,
    pub server_bind: String,
    pub web_bind: String,
    pub rust_log: String,
}

pub fn workspace_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask 必须位于 workspace 根目录下一级")
}

pub fn load_local_env(root: &Path) -> Result<LocalEnv, String> {
    let path = root.join(".env.local");
    let content = fs::read_to_string(&path)
        .map_err(|_| format!("未找到 {}。请在项目根目录创建 .env.local。", path.display()))?;

    parse_local_env(&content, path)
}

fn parse_local_env(content: &str, path: PathBuf) -> Result<LocalEnv, String> {
    let mut database_url = None;
    let mut api_base = None;
    let mut server_bind = None;
    let mut web_bind = None;
    let mut rust_log = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        match key.trim() {
            "DATABASE_URL" => database_url = Some(value.trim().to_owned()),
            "KOKO_API_BASE" => api_base = Some(value.trim().to_owned()),
            "SERVER_BIND" => server_bind = Some(value.trim().to_owned()),
            "WEB_BIND" => web_bind = Some(value.trim().to_owned()),
            "RUST_LOG" => rust_log = Some(value.trim().to_owned()),
            _ => {}
        }
    }

    Ok(LocalEnv {
        database_url: database_url.ok_or_else(|| {
            format!(
                "{} 缺少 DATABASE_URL。请补齐数据库连接串。",
                path.display()
            )
        })?,
        api_base: api_base.ok_or_else(|| {
            format!(
                "{} 缺少 KOKO_API_BASE。请补齐后端地址。",
                path.display()
            )
        })?,
        server_bind: server_bind.unwrap_or_else(|| "0.0.0.0:3000".to_owned()),
        web_bind: web_bind.unwrap_or_else(|| "0.0.0.0:8080".to_owned()),
        rust_log: rust_log.unwrap_or_else(|| "info,tower_http=info,sqlx=warn".to_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::{load_local_env, LocalEnv};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn load_local_env_parses_required_keys() {
        let root = create_temp_root(
            "DATABASE_URL=postgres://local\nKOKO_API_BASE=http://127.0.0.1:3000\n",
        );

        let env = load_local_env(&root).expect("应能读取 .env.local");

        assert_eq!(
            env,
            LocalEnv {
                database_url: "postgres://local".into(),
                api_base: "http://127.0.0.1:3000".into(),
                server_bind: "0.0.0.0:3000".into(),
                web_bind: "0.0.0.0:8080".into(),
                rust_log: "info,tower_http=info,sqlx=warn".into(),
            }
        );
    }

    #[test]
    fn load_local_env_rejects_missing_database_url() {
        let root = create_temp_root("KOKO_API_BASE=http://127.0.0.1:3000\n");

        let error = load_local_env(&root).expect_err("缺少 DATABASE_URL 应失败");

        assert!(error.contains("DATABASE_URL"));
    }

    #[test]
    fn load_local_env_missing_rust_log_should_use_dev_default() {
        let root = create_temp_root(
            "DATABASE_URL=postgres://local\nKOKO_API_BASE=http://127.0.0.1:3000\n",
        );

        let env = load_local_env(&root).expect("应能读取 .env.local");

        assert_eq!(env.server_bind, "0.0.0.0:3000");
        assert_eq!(env.web_bind, "0.0.0.0:8080");
        assert_eq!(env.rust_log, "info,tower_http=info,sqlx=warn");
    }

    #[test]
    fn load_local_env_should_accept_custom_bind_addresses() {
        let root = create_temp_root(
            "DATABASE_URL=postgres://local\nKOKO_API_BASE=http://192.168.1.7:3000\nSERVER_BIND=0.0.0.0:3000\nWEB_BIND=0.0.0.0:8088\n",
        );

        let env = load_local_env(&root).expect("应能读取自定义绑定地址");

        assert_eq!(env.server_bind, "0.0.0.0:3000");
        assert_eq!(env.web_bind, "0.0.0.0:8088");
    }

    fn create_temp_root(content: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("koko-xtask-env-{unique}"));
        fs::create_dir_all(&root).expect("应能创建临时目录");
        fs::write(root.join(".env.local"), content).expect("应能写入 .env.local");
        root
    }
}

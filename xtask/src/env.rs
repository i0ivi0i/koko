use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalEnv {
    pub database_url: String,
    pub api_base: String,
    pub admin_password: String,
    pub admin_password_generated: bool,
    pub server_bind: String,
    pub web_bind: String,
    pub admin_bind: String,
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
    let mut env = parse_local_env(&content, path.clone())?;

    if env.admin_password.is_empty() {
        env.admin_password = generate_local_admin_password();
        append_local_admin_password(&path, &env.admin_password)?;
        env.admin_password_generated = true;
    }

    Ok(env)
}

fn parse_local_env(content: &str, path: PathBuf) -> Result<LocalEnv, String> {
    let mut database_url = None;
    let mut api_base = None;
    let mut admin_password = None;
    let mut server_bind = None;
    let mut web_bind = None;
    let mut admin_bind = None;
    let mut rust_log = None;

    for item in dotenvy::from_read_iter(content.as_bytes()) {
        let (key, value) =
            item.map_err(|error| format!("解析 {} 失败: {error}", path.display()))?;

        match key.as_str() {
            "DATABASE_URL" => database_url = Some(value),
            "KOKO_API_BASE" => api_base = Some(value),
            "KOKO_ADMIN_PASSWORD" => admin_password = Some(value),
            "SERVER_BIND" => server_bind = Some(value),
            "WEB_BIND" => web_bind = Some(value),
            "ADMIN_BIND" => admin_bind = Some(value),
            "RUST_LOG" => rust_log = Some(value),
            _ => {}
        }
    }

    Ok(LocalEnv {
        database_url: database_url
            .ok_or_else(|| format!("{} 缺少 DATABASE_URL。请补齐数据库连接串。", path.display()))?,
        api_base: api_base
            .ok_or_else(|| format!("{} 缺少 KOKO_API_BASE。请补齐后端地址。", path.display()))?,
        admin_password: admin_password.unwrap_or_default(),
        admin_password_generated: false,
        server_bind: server_bind.unwrap_or_else(|| "0.0.0.0:3000".to_owned()),
        web_bind: web_bind.unwrap_or_else(|| "0.0.0.0:8080".to_owned()),
        admin_bind: admin_bind.unwrap_or_else(|| "0.0.0.0:8081".to_owned()),
        rust_log: rust_log.unwrap_or_else(|| "info,tower_http=info,sqlx=warn".to_owned()),
    })
}

fn generate_local_admin_password() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("系统时间应晚于 Unix epoch")
        .as_nanos();
    format!("local-admin-{nanos:x}")
}

fn append_local_admin_password(path: &Path, admin_password: &str) -> Result<(), String> {
    let mut content = fs::read_to_string(path)
        .map_err(|error| format!("读取 {} 失败: {error}", path.display()))?;

    if !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&format!("KOKO_ADMIN_PASSWORD={admin_password}\n"));

    fs::write(path, content).map_err(|error| format!("写入 {} 失败: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{LocalEnv, load_local_env};
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
                admin_password: env.admin_password.clone(),
                admin_password_generated: true,
                server_bind: "0.0.0.0:3000".into(),
                web_bind: "0.0.0.0:8080".into(),
                admin_bind: "0.0.0.0:8081".into(),
                rust_log: "info,tower_http=info,sqlx=warn".into(),
            }
        );
        assert!(!env.admin_password.is_empty());
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
        assert_eq!(env.admin_bind, "0.0.0.0:8081");
        assert_eq!(env.rust_log, "info,tower_http=info,sqlx=warn");
        assert!(env.admin_password_generated);
    }

    #[test]
    fn load_local_env_should_accept_custom_bind_addresses() {
        let root = create_temp_root(
            "DATABASE_URL=postgres://local\nKOKO_API_BASE=http://192.168.1.7:3000\nSERVER_BIND=0.0.0.0:3000\nWEB_BIND=0.0.0.0:8088\nADMIN_BIND=0.0.0.0:8089\n",
        );

        let env = load_local_env(&root).expect("应能读取自定义绑定地址");

        assert_eq!(env.server_bind, "0.0.0.0:3000");
        assert_eq!(env.web_bind, "0.0.0.0:8088");
        assert_eq!(env.admin_bind, "0.0.0.0:8089");
    }

    #[test]
    fn load_local_env_should_parse_quoted_values() {
        let root = create_temp_root(
            "DATABASE_URL=\"postgres://local\"\nKOKO_API_BASE=\"http://192.168.1.7:3000\"\nSERVER_BIND=\"0.0.0.0:3000\"\nWEB_BIND=\"0.0.0.0:8088\"\nADMIN_BIND=\"0.0.0.0:8089\"\nRUST_LOG=\"debug,tower_http=info\"\n",
        );

        let env = load_local_env(&root).expect("应能解析带引号的 .env.local");

        assert_eq!(env.database_url, "postgres://local");
        assert_eq!(env.api_base, "http://192.168.1.7:3000");
        assert!(!env.admin_password.is_empty());
        assert!(env.admin_password_generated);
        assert_eq!(env.server_bind, "0.0.0.0:3000");
        assert_eq!(env.web_bind, "0.0.0.0:8088");
        assert_eq!(env.admin_bind, "0.0.0.0:8089");
        assert_eq!(env.rust_log, "debug,tower_http=info");
    }

    #[test]
    fn load_local_env_should_keep_existing_admin_password() {
        let root = create_temp_root(
            "DATABASE_URL=postgres://local\nKOKO_API_BASE=http://127.0.0.1:3000\nKOKO_ADMIN_PASSWORD=existing-password\n",
        );

        let env = load_local_env(&root).expect("应能读取现有后台密码");

        assert_eq!(env.admin_password, "existing-password");
        assert!(!env.admin_password_generated);
        let content = fs::read_to_string(root.join(".env.local")).expect("应能读取 .env.local");
        assert_eq!(content.matches("KOKO_ADMIN_PASSWORD=").count(), 1);
    }

    #[test]
    fn load_local_env_should_generate_and_persist_missing_admin_password() {
        let root = create_temp_root(
            "DATABASE_URL=postgres://local\nKOKO_API_BASE=http://127.0.0.1:3000\n",
        );

        let env = load_local_env(&root).expect("应能自动生成后台密码");
        let content = fs::read_to_string(root.join(".env.local")).expect("应能读取 .env.local");

        assert!(!env.admin_password.is_empty());
        assert!(env.admin_password_generated);
        assert!(content.contains("KOKO_ADMIN_PASSWORD="));
        assert!(content.contains(&env.admin_password));
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

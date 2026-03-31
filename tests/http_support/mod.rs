use std::{env, path::Path, str::FromStr};

use axum::Router;
use sqlx::{
    ConnectOptions,
    PgPool,
    migrate::Migrator,
    postgres::{PgConnectOptions, PgPoolOptions},
};

use koko::{http, store::PgStore};

#[allow(dead_code)]
pub struct DatabaseHarness {
    pub store: PgStore,
    pub pool: PgPool,
    database_url: String,
    admin_database_url: String,
    database_name: String,
}

#[allow(dead_code)]
impl DatabaseHarness {
    pub async fn new(test_name: &str) -> Self {
        let base_database_url =
            validated_test_database_url(env::var("KOKO_TEST_DATABASE_URL").ok().as_deref())
                .unwrap();
        let database_url = derive_isolated_test_database_url(&base_database_url, test_name).unwrap();
        let admin_database_url = default_admin_database_url(&database_url);
        reset_test_database(&database_url).await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .unwrap();
        run_migrations(&pool).await;
        let store = PgStore::new(pool.clone());
        let database_name = database_name_from_url(&database_url);

        Self {
            store,
            pool,
            database_url,
            admin_database_url,
            database_name,
        }
    }

    pub fn database_name(&self) -> &str {
        &self.database_name
    }

    pub async fn cleanup(self) {
        destroy_test_database(&self.database_url, &self.admin_database_url, self.pool).await;
    }
}

#[allow(dead_code)]
pub struct HttpHarness {
    pub router: Router,
    #[allow(dead_code)]
    pub store: PgStore,
    db: DatabaseHarness,
}

#[allow(dead_code)]
impl HttpHarness {
    pub async fn new(test_name: &str) -> Self {
        let db = DatabaseHarness::new(test_name).await;
        let store = db.store.clone();
        let router = http::app_router(db.store.clone(), "local-admin-token".to_string());

        Self {
            router,
            store,
            db,
        }
    }

    pub async fn cleanup(self) {
        self.db.cleanup().await;
    }
}

pub fn derive_isolated_test_database_url(
    base_database_url: &str,
    test_name: &str,
) -> Result<String, String> {
    let base_database_url = validated_test_database_url(Some(base_database_url))?;
    let mut options = PgConnectOptions::from_str(&base_database_url)
        .map_err(|error| format!("failed to parse test database url: {error}"))?;
    let base_database_name = options
        .get_database()
        .ok_or_else(|| "test database url must include a database name".to_string())?;
    let base_prefix = base_database_name
        .strip_suffix("_test")
        .ok_or_else(|| "test database name must end with _test".to_string())?;
    let sanitized_test_name = sanitize_database_component(test_name);
    let unique_suffix = &uuid::Uuid::now_v7().simple().to_string()[..12];
    let candidate_name = format!("{base_prefix}_{sanitized_test_name}_{unique_suffix}_test");
    let database_name = if candidate_name.len() <= 63 {
        candidate_name
    } else {
        format!(
            "{}_{}_test",
            &base_prefix[..base_prefix.len().min(12)],
            unique_suffix
        )
    };

    options = options.database(&database_name);
    let derived_url = options.to_url_lossy().to_string();
    validated_test_database_url(Some(&derived_url))
}

pub fn validated_test_database_url(raw_url: Option<&str>) -> Result<String, String> {
    let database_url = raw_url.unwrap_or(DEFAULT_TEST_DATABASE_URL).to_string();
    let options = PgConnectOptions::from_str(&database_url)
        .map_err(|error| format!("failed to parse test database url: {error}"))?;
    let database_name = options
        .get_database()
        .ok_or_else(|| "test database url must include a database name".to_string())?;

    if !database_name.ends_with("_test") {
        return Err(format!(
            "destructive test reset only allows databases ending with _test, got `{database_name}`"
        ));
    }

    if !database_name
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(format!(
            "test database name `{database_name}` must use lowercase ascii letters, digits, or underscores"
        ));
    }

    Ok(database_url)
}

pub fn default_admin_database_url(test_database_url: &str) -> String {
    let admin_url = env::var("KOKO_TEST_ADMIN_DATABASE_URL")
        .unwrap_or_else(|_| DEFAULT_TEST_ADMIN_DATABASE_URL.to_string());
    validate_admin_database_url(test_database_url, &admin_url).unwrap()
}

pub fn validate_admin_database_url(
    test_database_url: &str,
    admin_database_url: &str,
) -> Result<String, String> {
    let test_options = PgConnectOptions::from_str(test_database_url)
        .map_err(|error| format!("failed to parse test database url: {error}"))?;
    let admin_options = PgConnectOptions::from_str(admin_database_url)
        .map_err(|error| format!("failed to parse admin database url: {error}"))?;

    if test_options.get_host() != admin_options.get_host()
        || test_options.get_port() != admin_options.get_port()
    {
        return Err(format!(
            "admin and test database urls must target the same host/port, got {}:{} vs {}:{}",
            test_options.get_host(),
            test_options.get_port(),
            admin_options.get_host(),
            admin_options.get_port()
        ));
    }

    Ok(admin_database_url.to_string())
}

fn sanitize_database_component(raw: &str) -> String {
    let mut component = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
                ch
            } else if ch.is_ascii_uppercase() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    component.truncate(20);

    let trimmed = component.trim_matches('_');
    if trimmed.is_empty() {
        "test".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn database_name_from_url(database_url: &str) -> String {
    PgConnectOptions::from_str(database_url)
        .unwrap()
        .get_database()
        .unwrap()
        .to_string()
}

async fn reset_test_database(database_url: &str) {
    let options = PgConnectOptions::from_str(database_url).unwrap();
    let database_name = options.get_database().unwrap().to_string();
    let database_user = options.get_username().to_string();
    let admin_url = default_admin_database_url(database_url);
    let admin_options = PgConnectOptions::from_str(&admin_url).unwrap();
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(admin_options.clone())
        .await
        .unwrap();

    sqlx::query(
        "SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1
           AND pid <> pg_backend_pid()",
    )
    .bind(&database_name)
    .execute(&admin_pool)
    .await
    .unwrap();

    sqlx::query(&format!("DROP DATABASE IF EXISTS \"{database_name}\""))
        .execute(&admin_pool)
        .await
        .unwrap();

    sqlx::query(&format!(
        "CREATE DATABASE \"{database_name}\" OWNER \"{database_user}\""
    ))
    .execute(&admin_pool)
    .await
    .unwrap();

    let test_database_admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(admin_options.database(&database_name))
        .await
        .unwrap();

    sqlx::query(&format!("ALTER SCHEMA public OWNER TO \"{database_user}\""))
        .execute(&test_database_admin_pool)
        .await
        .unwrap();

    sqlx::query(&format!("GRANT ALL ON SCHEMA public TO \"{database_user}\""))
        .execute(&test_database_admin_pool)
        .await
        .unwrap();
}

async fn destroy_test_database(database_url: &str, admin_database_url: &str, pool: PgPool) {
    pool.close().await;

    let database_name = database_name_from_url(database_url);
    let admin_url = validate_admin_database_url(database_url, admin_database_url).unwrap();
    let admin_options = PgConnectOptions::from_str(&admin_url).unwrap();
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(admin_options)
        .await
        .unwrap();

    sqlx::query(
        "SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1
           AND pid <> pg_backend_pid()",
    )
    .bind(&database_name)
    .execute(&admin_pool)
    .await
    .unwrap();

    sqlx::query(&format!("DROP DATABASE IF EXISTS \"{database_name}\""))
        .execute(&admin_pool)
        .await
        .unwrap();
}

async fn run_migrations(pool: &PgPool) {
    let migration_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let migrator = Migrator::new(migration_dir.as_path()).await.unwrap();
    migrator.run(pool).await.unwrap();
}

pub const DEFAULT_TEST_DATABASE_URL: &str =
    "postgres://koko:koko_local@127.0.0.1:5432/koko_test";
const DEFAULT_TEST_ADMIN_DATABASE_URL: &str =
    "postgres://postgres:postgres@127.0.0.1:5432/postgres";

#[cfg(not(target_arch = "wasm32"))]
use sqlx::postgres::PgPoolOptions;
#[cfg(not(target_arch = "wasm32"))]
use tower_sessions_sqlx_store::PostgresStore;

#[cfg(not(target_arch = "wasm32"))]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = koko::support::AppConfig::load()?;
    // tracing 负责运行时日志；启动横幅是给人看的 ready 事实，不能混成一层。
    // 先初始化 tracing，保证后续错误和运行日志有统一出口，再等 ready 后写一次横幅。
    let _ = koko::support::init_tracing(koko::support::DEFAULT_TRACING_FILTER)?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    let admin_session_store = PostgresStore::new(pool.clone());
    admin_session_store.migrate().await?;
    let store = koko::store::PgStore::new(pool);
    let admin_session_layer =
        koko::http::build_admin_session_layer(admin_session_store, config.admin_cookie_secure);
    let router = koko::http::server_router(
        store,
        config.admin_token.clone(),
        admin_session_layer,
        koko::http::default_frontend_dist_dir(),
        koko::http::default_frontend_asset_dir(),
    );
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    let ready_addr = listener.local_addr()?;
    let mut stdout = std::io::stdout().lock();
    koko::support::write_startup_banner_if_ready(&mut stdout, Ok(ready_addr), &config)?;

    axum::serve(listener, router).await?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn main() {
    dioxus::launch(koko::root_shell);
}

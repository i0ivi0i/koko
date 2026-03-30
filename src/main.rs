use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = koko::support::AppConfig::from_env()?;
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    let store = koko::store::PgStore::new(pool);
    let router = koko::http::app_router(store, config.admin_token);
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;

    axum::serve(listener, router).await?;
    Ok(())
}

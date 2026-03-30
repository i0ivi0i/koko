use std::sync::Arc;

use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[derive(Clone, Copy)]
struct SystemIdGenerator;

impl koko::app::IdGenerator for SystemIdGenerator {
    fn next_message_id(&self) -> Uuid {
        Uuid::now_v7()
    }
}

#[derive(Clone, Copy)]
struct SystemClock;

impl koko::app::Clock for SystemClock {
    fn now(&self) -> chrono::DateTime<chrono::Utc> {
        chrono::Utc::now()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = koko::support::AppConfig::from_env()?;
    let _ = koko::support::init_tracing(koko::support::DEFAULT_TRACING_FILTER)?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    let store = koko::store::PgStore::new(pool);
    let (socket_layer, io) = socketioxide::SocketIo::new_layer();
    let realtime = Arc::new(koko::rt::RealtimeState::new(
        store.clone(),
        SystemIdGenerator,
        SystemClock,
    ));
    koko::rt::install_realtime(&io, realtime);
    let router = koko::http::app_router(store, config.admin_token).layer(socket_layer);
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;

    axum::serve(listener, router).await?;
    Ok(())
}

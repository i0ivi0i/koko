use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

pub fn init_tracing() {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter()));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            fmt::layer()
                .compact()
                .with_target(false)
                .with_writer(std::io::stdout),
        )
        .init();
}

fn default_filter() -> &'static str {
    "info,tower_http=info,sqlx=warn"
}

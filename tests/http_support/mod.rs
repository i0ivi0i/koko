use std::path::Path;

use axum::Router;
use sqlx::PgPool;

use koko::{assemble_app, store::PgStore};

#[allow(dead_code)]
pub struct HttpHarness {
    pub router: Router,
    pub store: PgStore,
}

#[allow(dead_code)]
impl HttpHarness {
    pub fn new(pool: PgPool) -> Self {
        Self::assemble(PgStore::new(pool))
    }

    pub fn frontend_only() -> Self {
        // Keep router wiring identical while ensuring static/fallback tests never touch Postgres.
        let pool = PgPool::connect_lazy(FRONTEND_ONLY_DATABASE_URL).unwrap();
        Self::assemble(PgStore::new(pool))
    }

    fn assemble(store: PgStore) -> Self {
        let frontend_fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("http_support")
            .join("fixtures")
            .join("frontend");
        let asset_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        let router = assemble_app(
            store.clone(),
            "local-admin-token".to_string(),
            frontend_fixture_dir,
            asset_dir,
        );

        Self { router, store }
    }
}

const FRONTEND_ONLY_DATABASE_URL: &str = "postgres://postgres:postgres@127.0.0.1:1/koko_unused";

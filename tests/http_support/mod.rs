use std::path::Path;

use axum::Router;
use sqlx::PgPool;

use koko::{http, store::PgStore};

#[allow(dead_code)]
pub struct DatabaseHarness {
    pub store: PgStore,
    pub pool: PgPool,
}

#[allow(dead_code)]
impl DatabaseHarness {
    pub fn new(pool: PgPool) -> Self {
        let store = PgStore::new(pool.clone());
        Self { store, pool }
    }
}

#[allow(dead_code)]
pub struct HttpHarness {
    pub router: Router,
    pub store: PgStore,
}

#[allow(dead_code)]
impl HttpHarness {
    pub async fn new(pool: PgPool) -> Self {
        let db = DatabaseHarness::new(pool);
        let frontend_fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("http_support")
            .join("fixtures")
            .join("frontend");
        let asset_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        let router = http::app_router(
            db.store.clone(),
            "local-admin-token".to_string(),
            frontend_fixture_dir,
            asset_dir,
        );

        Self {
            router,
            store: db.store,
        }
    }
}

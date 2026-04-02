use std::path::Path;

use axum::Router;
use koko::contract::{BootstrapSession, RoomSnapshot};
use sqlx::PgPool;
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};

use koko::{http, store::PgStore};

#[allow(dead_code)]
pub struct HttpHarness {
    pub router: Router,
    pub store: PgStore,
}

#[allow(dead_code)]
pub struct RunningHttpHarness {
    base_url: String,
    client: reqwest::Client,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: JoinHandle<()>,
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
        let router = http::server_router(
            store.clone(),
            "local-admin-token".to_string(),
            frontend_fixture_dir,
            asset_dir,
        );

        Self { router, store }
    }

    pub async fn spawn(self) -> RunningHttpHarness {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let server_task = tokio::spawn(async move {
            axum::serve(listener, self.router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        RunningHttpHarness {
            base_url,
            client: reqwest::Client::new(),
            shutdown_tx: Some(shutdown_tx),
            server_task,
        }
    }
}

#[allow(dead_code)]
impl RunningHttpHarness {
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn bootstrap_session_with_cookie(&self) -> (BootstrapSession, String) {
        let response = self
            .client
            .post(format!("{}/api/session/bootstrap", self.base_url()))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::CREATED);

        let cookie = response
            .headers()
            .get(reqwest::header::SET_COOKIE)
            .expect("bootstrap should set a reusable session cookie")
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let session = response.json().await.unwrap();

        (session, cookie)
    }

    pub async fn join_room(&self, cookie: &str, room_code: &str) -> RoomSnapshot {
        let response = self
            .client
            .post(format!("{}/api/rooms/join", self.base_url()))
            .header("content-type", "application/json")
            .header("cookie", cookie)
            .json(&serde_json::json!({ "room_code": room_code }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::OK);

        response.json().await.unwrap()
    }

    pub async fn shutdown(mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
        self.server_task.await.unwrap();
    }
}

const FRONTEND_ONLY_DATABASE_URL: &str = "postgres://postgres:postgres@127.0.0.1:1/koko_unused";

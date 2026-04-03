use std::path::Path;

use axum::Router;
use koko::contract::{BootstrapSession, RoomSnapshot};
use sqlx::PgPool;
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle};
use tower_sessions_sqlx_store::PostgresStore;

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
    pub async fn new(pool: PgPool) -> Self {
        let store = PgStore::new(pool.clone());
        let session_store = PostgresStore::new(pool);
        session_store.migrate().await.unwrap();
        let session_layer = http::build_admin_session_layer(session_store, false);
        Self::assemble_server(store, session_layer)
    }

    pub fn frontend_only() -> Self {
        // 这里只验证静态路由协议面，避免前端入口/回退测试被真实 session store 与数据库初始化牵连。
        // 生产环境 bundle 是否总装完整，仍应由面向 dist/public 的测试单独兜底。
        let pool = PgPool::connect_lazy(FRONTEND_ONLY_DATABASE_URL).unwrap();
        let store = PgStore::new(pool);
        let frontend_fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("http_support")
            .join("fixtures")
            .join("frontend");
        let asset_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("public")
            .join("assets");
        let router = http::frontend_shell_router(frontend_fixture_dir, asset_dir);

        Self { router, store }
    }

    fn assemble_server(
        store: PgStore,
        session_layer: http::AdminSessionLayer,
    ) -> Self {
        let frontend_fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("http_support")
            .join("fixtures")
            .join("frontend");
        let asset_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("public")
            .join("assets");
        let router = http::server_router(
            store.clone(),
            TEST_ADMIN_TOKEN.to_string(),
            session_layer,
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

    pub fn client(&self) -> &reqwest::Client {
        &self.client
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

    pub async fn admin_login_with_cookie(&self) -> String {
        let response = self
            .client
            .post(format!("{}/api/admin/session/login", self.base_url()))
            .json(&serde_json::json!({ "token": TEST_ADMIN_TOKEN }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::OK);

        response
            .headers()
            .get(reqwest::header::SET_COOKIE)
            .expect("admin login should set a reusable admin session cookie")
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string()
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
pub const TEST_ADMIN_TOKEN: &str = "local-admin-token";

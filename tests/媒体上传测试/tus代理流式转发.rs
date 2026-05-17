use super::*;
use axum::{
    body::{Body, Bytes},
    extract::Request as AxumRequest,
    response::Response,
    routing::any,
    Router,
};
use futures_util::StreamExt;
use tokio::{net::TcpListener, task::JoinHandle};
use tower::ServiceExt;

struct 流式假Tus上游 {
    内部上传入口: String,
    handle: JoinHandle<()>,
}

async fn 启动会记录首块的假_tus上游(
    first_chunk_tx: tokio::sync::oneshot::Sender<Vec<u8>>,
) -> 流式假Tus上游 {
    let first_chunk_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(first_chunk_tx)));
    let app = Router::new().route(
        "/files/upload-1",
        any(move |request: AxumRequest| {
            let first_chunk_tx = first_chunk_tx.clone();
            async move {
                let mut stream = request.into_body().into_data_stream();
                if let Some(Ok(chunk)) = stream.next().await {
                    if let Some(tx) = first_chunk_tx.lock().await.take() {
                        let _ = tx.send(chunk.to_vec());
                    }
                }
                while stream.next().await.is_some() {}
                Response::builder()
                    .status(StatusCode::NO_CONTENT)
                    .header("tus-resumable", "1.0.0")
                    .body(Body::empty())
                    .expect("应能组装 fake tusd response")
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能启动 fake tus upstream");
    let port = listener
        .local_addr()
        .expect("应能读取 fake tus 端口")
        .port();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    流式假Tus上游 {
        内部上传入口: format!("http://127.0.0.1:{port}"),
        handle,
    }
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn 媒体Tus代理会在客户端请求体结束前把首块流式转发给sidecar() {
    let backup = 备份并清空环境变量(&[
        "MEDIA_TUS_PUBLIC_ENDPOINT",
        "MEDIA_TUS_SERVER_PORT",
        "MEDIA_TUS_BASE_PATH",
        "MEDIA_TUS_INTERNAL_BASE_URL",
    ]);
    env::set_var("MEDIA_TUS_SERVER_PORT", "1081");
    env::set_var("MEDIA_TUS_BASE_PATH", "/files");
    let (first_chunk_tx, first_chunk_rx) = tokio::sync::oneshot::channel::<Vec<u8>>();
    let fake_upstream = 启动会记录首块的假_tus上游(first_chunk_tx).await;
    env::set_var(
        "MEDIA_TUS_INTERNAL_BASE_URL",
        fake_upstream.内部上传入口.as_str(),
    );
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (release_tail_tx, release_tail_rx) = tokio::sync::oneshot::channel::<()>();
    let body_stream = futures_util::stream::once(async {
        Ok::<Bytes, std::io::Error>(Bytes::from_static(b"first-chunk"))
    })
    .chain(futures_util::stream::once(async move {
        let _ = release_tail_rx.await;
        Ok::<Bytes, std::io::Error>(Bytes::from_static(b"second-chunk"))
    }));
    let request = axum::http::Request::builder()
        .method(Method::PATCH)
        .uri("/files/upload-1")
        .header("tus-resumable", "1.0.0")
        .header("upload-offset", "0")
        .header(header::CONTENT_TYPE, "application/offset+octet-stream")
        .body(Body::from_stream(body_stream))
        .expect("request");

    let request_task =
        tokio::spawn(async move { app.oneshot(request).await.expect("proxy response") });
    let first_chunk_result =
        tokio::time::timeout(Duration::from_millis(500), first_chunk_rx).await;
    let _ = release_tail_tx.send(());
    let response = tokio::time::timeout(Duration::from_secs(3), request_task)
        .await
        .expect("代理请求应能在释放客户端尾块后结束")
        .expect("代理任务不应 panic");
    fake_upstream.handle.abort();
    恢复环境变量(backup);

    let first_chunk = first_chunk_result
        .expect("Tus 代理必须在客户端 body 未结束前把首块流式送到 sidecar")
        .expect("fake sidecar 应收到首块");
    assert_eq!(first_chunk, b"first-chunk".to_vec());
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

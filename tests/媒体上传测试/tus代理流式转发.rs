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

/// 前缀累计目标：fake tusd 累计收到此字节数后即发送信号
const 前缀累计目标: usize = 512 * 1024;

struct 流式假Tus上游 {
    内部上传入口: String,
    handle: JoinHandle<()>,
}

/// 启动一个 fake tusd，累计请求体字节直到 ≥512KiB 后通过 oneshot 发送已收前缀。
/// 不依赖单个 TCP/Hyper frame 边界，只看累计字节数。
async fn 启动会记录首个前缀的假_tus上游(
    prefix_tx: tokio::sync::oneshot::Sender<Vec<u8>>,
) -> 流式假Tus上游 {
    let prefix_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(prefix_tx)));
    let app = Router::new().route(
        "/files/upload-1",
        any(move |request: AxumRequest| {
            let prefix_tx = prefix_tx.clone();
            async move {
                let mut stream = request.into_body().into_data_stream();
                let mut accumulated = Vec::new();
                let mut signaled = false;
                while let Some(Ok(chunk)) = stream.next().await {
                    accumulated.extend_from_slice(&chunk);
                    if !signaled && accumulated.len() >= 前缀累计目标 {
                        if let Some(tx) = prefix_tx.lock().await.take() {
                            let _ = tx.send(accumulated[..前缀累计目标].to_vec());
                        }
                        signaled = true;
                    }
                }
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
    let (prefix_tx, prefix_rx) = tokio::sync::oneshot::channel::<Vec<u8>>();
    let fake_upstream = 启动会记录首个前缀的假_tus上游(prefix_tx).await;
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

    // 首段发送 1MiB（填充 0x07），tail 阻塞直到信号释放
    let first_segment = Bytes::from(vec![0x07u8; 1024 * 1024]);
    let (release_tail_tx, release_tail_rx) = tokio::sync::oneshot::channel::<()>();
    let body_stream = futures_util::stream::once({
        let first_segment = first_segment.clone();
        async move { Ok::<Bytes, std::io::Error>(first_segment) }
    })
    .chain(futures_util::stream::once(async move {
        let _ = release_tail_rx.await;
        Ok::<Bytes, std::io::Error>(Bytes::from(vec![0x08u8; 1024]))
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
    let prefix_result =
        tokio::time::timeout(Duration::from_secs(2), prefix_rx).await;
    let _ = release_tail_tx.send(());
    let response = tokio::time::timeout(Duration::from_secs(3), request_task)
        .await
        .expect("代理请求应能在释放客户端尾块后结束")
        .expect("代理任务不应 panic");
    fake_upstream.handle.abort();
    恢复环境变量(backup);

    let prefix = prefix_result
        .expect("Tus 代理必须在客户端 body 未结束前把首个 512KiB 前缀流式送到 sidecar")
        .expect("fake sidecar 应收到前缀");
    assert_eq!(prefix.len(), 前缀累计目标, "前缀应恰好 512KiB");
    assert!(
        prefix.iter().all(|b| *b == 0x07),
        "前缀全部字节应为 0x07，验证字节顺序未被破坏"
    );
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

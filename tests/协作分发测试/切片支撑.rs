use super::*;

/// 这组 helper 只负责协作分发 slice 的测试装配：
/// - 搭起 fake tracker upstream 与最小测试后端；
/// - 签发 join_ticket、拼 tracker 首帧；
/// - 归一化受控地址，方便比较不同成员看到的同一条主链。
///
/// 它们不承载任何 locator / torrent / tracker 业务断言，
/// 业务断言必须继续留在测试本体里。
pub(crate) struct 测试服务器 {
    base_ws_url: String,
    handle: JoinHandle<()>,
}

impl 测试服务器 {
    pub(crate) fn announce_url(&self) -> String {
        format!("{}/api/swarm/announce", self.base_ws_url)
    }

    pub(crate) fn 停止(self) {
        self.handle.abort();
    }
}

pub(crate) struct 假Tracker上游 {
    pub(crate) port: u16,
    pub(crate) received: tokio::sync::mpsc::Receiver<String>,
    handle: JoinHandle<()>,
}

impl 假Tracker上游 {
    pub(crate) fn 停止(self) {
        self.handle.abort();
    }
}

pub(crate) async fn 启动假tracker上游() -> 假Tracker上游 {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能启动 fake tracker upstream");
    let port = listener
        .local_addr()
        .expect("应能读取 fake tracker 端口")
        .port();
    let (tx, rx) = tokio::sync::mpsc::channel(1);
    let handle = tokio::spawn(async move {
        let Ok((stream, _addr)) = listener.accept().await else {
            return;
        };
        let Ok(mut socket) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        if let Some(Ok(message)) = socket.next().await {
            let text = match message {
                TungsteniteMessage::Text(text) => text.to_string(),
                TungsteniteMessage::Binary(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                _ => String::new(),
            };
            let _ = tx.send(text).await;
        }
    });
    假Tracker上游 {
        port,
        received: rx,
        handle,
    }
}

pub(crate) async fn 启动协作分发测试应用(
    upstream_port: u16,
    ticket_secret: &str,
) -> 测试服务器 {
    let backup = 备份并清空环境变量(&[
        "SWARM_TRACKER_PORT",
        "SWARM_TRACKER_UPSTREAM_URL",
        "SWARM_TICKET_SECRET",
    ]);
    env::set_var("SWARM_TRACKER_PORT", upstream_port.to_string());
    env::set_var(
        "SWARM_TRACKER_UPSTREAM_URL",
        format!("ws://127.0.0.1:{upstream_port}"),
    );
    env::set_var("SWARM_TICKET_SECRET", ticket_secret);

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state = koko::shell::构建应用状态(cfg.database_url, cfg.admin_password)
        .await
        .expect("应能构建共享应用状态");
    恢复环境变量(backup);

    let app = koko::shell::构建路由(state);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能启动测试后端");
    let port = listener.local_addr().expect("应能读取测试后端端口").port();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    测试服务器 {
        base_ws_url: format!("ws://127.0.0.1:{port}"),
        handle,
    }
}

pub(crate) fn 签发测试join_ticket(secret: &str, info_hash: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_secs() as usize;
    encode(
        &Header::new(Algorithm::HS256),
        &serde_json::json!({
            "sub": "session-for-tracker-proxy-test",
            "aid": "attachment-for-tracker-proxy-test",
            "ih": info_hash,
            "iat": now,
            "exp": now + 120,
        }),
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .expect("应能签发测试 join_ticket")
}

pub(crate) fn 构造tracker首帧(info_hash: &str, ticket: Option<&str>) -> String {
    let mut payload = serde_json::json!({
        "action": 1,
        "info_hash": info_hash,
        "peer_id": "00112233445566778899",
        "offers": [],
        "numwant": 1,
    });
    if let Some(ticket) = ticket {
        payload["ticket"] = serde_json::Value::String(ticket.to_string());
    }
    payload.to_string()
}

pub(crate) async fn 发送tracker首帧(url: &str, payload: String) {
    let (mut socket, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("应能连上同源 tracker 代理");
    let _ = socket.send(TungsteniteMessage::Text(payload.into())).await;
}

/// locator 给不同成员返回的受控地址，允许 `session_id` 不同，
/// 但不允许主链事实本身漂移。
pub(crate) fn 归一化受控地址(url: &str) -> String {
    let Some((prefix, suffix)) = url.split_once("?session_id=") else {
        return url.to_string();
    };
    if let Some((_, rest)) = suffix.split_once('&') {
        return format!("{prefix}?session_id=<session>&{rest}");
    }
    format!("{prefix}?session_id=<session>")
}

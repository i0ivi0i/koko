use super::*;
use super::distribution_slice_support::{
    启动假tracker上游, 启动协作分发测试应用, 发送tracker首帧, 构造tracker首帧, 签发测试join_ticket,
};

#[tokio::test]
#[serial]
async fn 同源tracker代理入口会响应websocket握手而不是404() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state = koko::shell::构建应用状态(cfg.database_url, cfg.admin_password)
        .await
        .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, _headers, _body) = send_bytes(
        app,
        Method::GET,
        "/api/swarm/announce?info_hash=fake&peer_id=fake&port=6881",
        &[
            ("connection", "Upgrade"),
            ("upgrade", "websocket"),
            ("sec-websocket-version", "13"),
            ("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ=="),
        ],
    )
    .await;

    assert_eq!(
        status,
        StatusCode::UPGRADE_REQUIRED,
        "同源 tracker announce 入口必须被路由识别；即使测试请求未完整升级，也不应返回 404"
    );
}

#[tokio::test]
#[serial]
async fn 同源tracker代理首帧缺少join_ticket会拒绝而不是放行到tracker() {
    let mut upstream = 启动假tracker上游().await;
    let server = 启动协作分发测试应用(upstream.port, "tracker-proxy-secret").await;
    let info_hash = "0123456789abcdef0123456789abcdef01234567";

    发送tracker首帧(
        server.announce_url().as_str(),
        构造tracker首帧(info_hash, None),
    )
    .await;

    let forwarded = tokio::time::timeout(
        std::time::Duration::from_millis(400),
        upstream.received.recv(),
    )
    .await;

    server.停止();
    upstream.停止();
    assert!(
        forwarded.is_err(),
        "缺少 join_ticket 的首帧不得透传到成熟 tracker upstream；Rust 同源代理必须先做业务入场门禁"
    );
}

#[tokio::test]
#[serial]
async fn 同源tracker代理首帧join_ticket的info_hash不匹配会拒绝() {
    let mut upstream = 启动假tracker上游().await;
    let server = 启动协作分发测试应用(upstream.port, "tracker-proxy-secret").await;
    let info_hash = "0123456789abcdef0123456789abcdef01234567";
    let ticket = 签发测试join_ticket(
        "tracker-proxy-secret",
        "fedcba9876543210fedcba9876543210fedcba98",
    );

    发送tracker首帧(
        server.announce_url().as_str(),
        构造tracker首帧(info_hash, Some(ticket.as_str())),
    )
    .await;

    let forwarded = tokio::time::timeout(
        std::time::Duration::from_millis(400),
        upstream.received.recv(),
    )
    .await;

    server.停止();
    upstream.停止();
    assert!(
        forwarded.is_err(),
        "join_ticket.ih 与首帧 info_hash 不一致时不得入群，避免拿别的 swarm 门票混入当前 swarm"
    );
}

#[tokio::test]
#[serial]
async fn 同源tracker代理首帧join_ticket有效会放行到tracker_upstream() {
    let mut upstream = 启动假tracker上游().await;
    let server = 启动协作分发测试应用(upstream.port, "tracker-proxy-secret").await;
    let info_hash = "0123456789abcdef0123456789abcdef01234567";
    let ticket = 签发测试join_ticket("tracker-proxy-secret", info_hash);
    let first_frame = 构造tracker首帧(info_hash, Some(ticket.as_str()));

    发送tracker首帧(server.announce_url().as_str(), first_frame.clone()).await;

    let forwarded =
        tokio::time::timeout(std::time::Duration::from_secs(2), upstream.received.recv())
            .await
            .expect("有效票据应被放行到 tracker upstream")
            .expect("fake upstream 应收到首帧");

    server.停止();
    upstream.停止();
    assert_eq!(
        forwarded, first_frame,
        "验票成功后首帧必须原样透明转发，Rust 代理不能改写 WebTorrent tracker 协议"
    );
}

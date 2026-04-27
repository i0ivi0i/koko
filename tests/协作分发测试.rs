use axum::http::{Method, StatusCode, header};
use futures_util::{SinkExt, StreamExt};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serial_test::serial;
use sqlx::{Row, postgres::PgPoolOptions};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

#[path = "协作分发测试/可用性裁决.rs"]
mod availability_ruling_tests;
#[path = "协作分发测试/内容读取.rs"]
mod content_read_tests;
#[path = "协作分发测试/分发元数据.rs"]
mod distribution_metadata_tests;
#[path = "协作分发测试/投影一致性.rs"]
mod projection_consistency_tests;
#[path = "测试支撑/mod.rs"]
mod test_support;

// 顶层现在只保留 locator / torrent 读侧契约：
// - 分发元数据、投影一致性、可用性裁决、内容读取都已拆到子模块
// - 这里继续守 locator/torrent 共享的地址与协作分发合同
use test_support::{env_support::*, http::*, media::*};

struct 测试服务器 {
    base_ws_url: String,
    handle: JoinHandle<()>,
}

impl 测试服务器 {
    fn announce_url(&self) -> String {
        format!("{}/api/swarm/announce", self.base_ws_url)
    }
}

struct 假Tracker上游 {
    port: u16,
    received: tokio::sync::mpsc::Receiver<String>,
    handle: JoinHandle<()>,
}

async fn 启动假tracker上游() -> 假Tracker上游 {
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

async fn 启动协作分发测试应用(
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

fn 签发测试join_ticket(secret: &str, info_hash: &str) -> String {
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

fn 构造tracker首帧(info_hash: &str, ticket: Option<&str>) -> String {
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

async fn 发送tracker首帧(url: &str, payload: String) {
    let (mut socket, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("应能连上同源 tracker 代理");
    let _ = socket.send(TungsteniteMessage::Text(payload.into())).await;
}

/// locator 给不同成员返回的受控地址，允许 `session_id` 不同，但不允许主链事实本身漂移。
/// 这里把会话参数统一折叠成占位符，专门用于比较“同一附件对不同成员看到的是不是同一条主链”。
fn 归一化受控地址(url: &str) -> String {
    let Some((prefix, suffix)) = url.split_once("?session_id=") else {
        return url.to_string();
    };
    if let Some((_, rest)) = suffix.split_once('&') {
        return format!("{prefix}?session_id=<session>&{rest}");
    }
    format!("{prefix}?session_id=<session>")
}
#[tokio::test]
#[serial]
async fn locator会返回协作分发片段但不泄漏仓储私货() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("ML{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-locator-device-{uniq}");
    let attachment_id = format!("att-locator-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity =
            koko::usecase::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
                .expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("应能创建局部运行时");
        let database_url_for_attachment = database_url.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("locator-client-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能先创建带视频附件的消息");

        (identity.会话标识, room_id)
    })
    .await
    .expect("阻塞 locator 任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["attachment_id"].as_str(), Some(attachment_id.as_str()));
    assert_eq!(body["kind"].as_str(), Some("video"));
    assert_eq!(body["status"].as_str(), Some("ready"));
    assert_eq!(
        body["streaming_asset"]["kind"].as_str(),
        Some("streaming_video"),
        "视频 locator 必须开始返回流媒体资产过渡面，不能继续只给一次性原始附件地址"
    );
    assert_eq!(
        body["streaming_asset"]["asset_id"].as_str(),
        Some(attachment_id.as_str())
    );
    assert_eq!(
        body["streaming_asset"]["manifest"]["hls_master_url"].as_str(),
        Some(
            format!("/api/media/{attachment_id}/stream/hls/master.m3u8?session_id={session_id}")
                .as_str()
        ),
        "视频 locator 应返回正式 HLS 主清单入口，而不是继续留空"
    );
    assert_eq!(
        body["streaming_asset"]["manifest"]["dash_mpd_url"].as_str(),
        Some(
            format!("/api/media/{attachment_id}/stream/dash/stream.mpd?session_id={session_id}")
                .as_str()
        ),
        "视频 locator 也应返回正式 DASH 主清单入口"
    );
    assert_eq!(
        body["streaming_asset"]["origin"]["role"].as_str(),
        Some("cold_backup_only")
    );
    assert!(
        body.get("original_url").is_none(),
        "locator 顶层 original_url 已退场，冷源只允许留在 streaming_asset.origin"
    );
    assert_eq!(
        body["streaming_asset"]["distribution"]["swarm_id"].as_str(),
        body["distribution"]["swarm_id"].as_str(),
        "asset 分发表面与顶层 runtime distribution 必须继续引用同一份 swarm 真相"
    );
    assert_eq!(
        body["distribution"]["content_id"].as_str(),
        Some(format!("content_{attachment_id}").as_str())
    );
    assert!(body["distribution"]["content_hash"].as_str().is_some());
    assert!(body["distribution"]["swarm_id"].as_str().is_some());
    assert!(body["distribution"]["web_seed_until"].as_str().is_some());
    assert!(
        body.get("storage_key").is_none()
            && body.get("owner_anonymous_identity_id").is_none()
            && body.get("room_id").is_none()
            && body.get("thumbnail_storage_key").is_none(),
        "locator 只能暴露 transport 信息，不能把仓储私货和业务真相泄漏给壳层"
    );
    assert!(
        body["distribution"]["announce_urls"].is_array(),
        "Phase 2 允许 locator 下发 runtime transport 线索"
    );
    assert!(room_id.starts_with("r-"), "应返回稳定房间标识");
}

#[tokio::test]
#[serial]
async fn 同一视频对发送者与群友返回同一套流媒体主链真相() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("VP{:010}", uniq % 10_000_000_000);
    let sender_device_token = format!("video-sender-device-{uniq}");
    let peer_device_token = format!("video-peer-device-{uniq}");
    let attachment_id = format!("att-video-peer-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (sender_session_id, peer_session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let sender = koko::usecase::引导匿名身份(&mut repo, &sender_device_token)
            .expect("应能引导发送者匿名身份");
        let peer = koko::usecase::引导匿名身份(&mut repo, &peer_device_token)
            .expect("应能引导群友匿名身份");
        let room = koko::usecase::按短码进房或建房(&mut repo, &sender.会话标识, &room_code)
            .expect("发送者应能进房");
        koko::usecase::按短码进房或建房(&mut repo, &peer.会话标识, &room_code)
            .expect("群友也应能进同一个房间");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("应能创建局部运行时");
        let database_url_for_attachment = database_url.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入 ready 视频附件");
            插入ready视频附件记录(&pool, &sender.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &sender.会话标识,
            &format!("sender-peer-locator-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能创建带视频附件的消息");

        (sender.会话标识, peer.会话标识, room_id)
    })
    .await
    .expect("阻塞 sender/peer locator 任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let (sender_status, sender_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={sender_session_id}"),
        None,
        &[],
    )
    .await;
    let (peer_status, peer_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={peer_session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(sender_status, StatusCode::OK);
    assert_eq!(peer_status, StatusCode::OK);
    assert_eq!(
        sender_body["streaming_asset"]["asset_id"].as_str(),
        peer_body["streaming_asset"]["asset_id"].as_str(),
        "同一视频对发送者和群友必须锚到同一个稳定 asset_id"
    );
    assert_eq!(
        sender_body["streaming_asset"]["kind"].as_str(),
        peer_body["streaming_asset"]["kind"].as_str(),
        "流媒体资产种类不应随着查看成员变化"
    );
    assert_eq!(
        sender_body["distribution"]["swarm_id"].as_str(),
        peer_body["distribution"]["swarm_id"].as_str(),
        "协作分发 swarm 真相必须对房间成员一致"
    );
    assert_eq!(
        sender_body["streaming_asset"]["distribution"]["swarm_id"].as_str(),
        peer_body["streaming_asset"]["distribution"]["swarm_id"].as_str(),
        "新流媒体资产面和顶层 distribution 兼容面都必须对齐到同一份 swarm 真相"
    );

    let sender_hls = sender_body["streaming_asset"]["manifest"]["hls_master_url"]
        .as_str()
        .expect("发送者 locator 应返回 HLS 主清单入口");
    let peer_hls = peer_body["streaming_asset"]["manifest"]["hls_master_url"]
        .as_str()
        .expect("群友 locator 也应返回 HLS 主清单入口");
    let sender_dash = sender_body["streaming_asset"]["manifest"]["dash_mpd_url"]
        .as_str()
        .expect("发送者 locator 应返回 DASH 主清单入口");
    let peer_dash = peer_body["streaming_asset"]["manifest"]["dash_mpd_url"]
        .as_str()
        .expect("群友 locator 也应返回 DASH 主清单入口");
    let sender_origin = sender_body["streaming_asset"]["origin"]["original_url"]
        .as_str()
        .expect("发送者 locator 应返回冷备原图入口");
    let peer_origin = peer_body["streaming_asset"]["origin"]["original_url"]
        .as_str()
        .expect("群友 locator 也应返回冷备原图入口");

    assert!(
        sender_hls.contains(sender_session_id.as_str())
            && peer_hls.contains(peer_session_id.as_str()),
        "受控 HLS 地址必须带各自会话，用来保持成员可见性裁决"
    );
    assert!(
        sender_dash.contains(sender_session_id.as_str())
            && peer_dash.contains(peer_session_id.as_str()),
        "受控 DASH 地址同样必须带各自会话"
    );
    assert!(
        sender_origin.contains(sender_session_id.as_str())
            && peer_origin.contains(peer_session_id.as_str()),
        "冷备原图地址也必须继续走各自会话的受控读路径"
    );
    assert_eq!(
        归一化受控地址(sender_hls),
        归一化受控地址(peer_hls),
        "去掉 session_id 之后，发送者和群友看到的应该是同一条 HLS 主链"
    );
    assert_eq!(
        归一化受控地址(sender_dash),
        归一化受控地址(peer_dash),
        "去掉 session_id 之后，发送者和群友看到的应该是同一条 DASH 主链"
    );
    assert_eq!(
        归一化受控地址(sender_origin),
        归一化受控地址(peer_origin),
        "去掉 session_id 之后，发送者和群友看到的应该是同一条冷备入口"
    );
    assert_eq!(
        sender_body["streaming_asset"]["origin"]["role"].as_str(),
        peer_body["streaming_asset"]["origin"]["role"].as_str(),
        "冷备角色语义必须对所有成员一致"
    );
    assert!(room_id.starts_with("r-"), "应返回稳定房间标识");
}

#[tokio::test]
#[serial]
async fn 图片locator会返回blob_asset而不是只给original_url() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("IL{:010}", uniq % 10_000_000_000);
    let device_token = format!("image-locator-device-{uniq}");
    let attachment_id = format!("att-image-locator-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity =
            koko::usecase::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
                .expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("应能创建局部运行时");
        let database_url_for_attachment = database_url.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready图片附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("image-locator-client-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能先创建带图片附件的消息");

        (identity.会话标识, room_id)
    })
    .await
    .expect("阻塞图片 locator 任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["attachment_id"].as_str(), Some(attachment_id.as_str()));
    assert_eq!(body["kind"].as_str(), Some("image"));
    assert_eq!(body["status"].as_str(), Some("ready"));
    assert_eq!(
        body["blob_asset"]["kind"].as_str(),
        Some("blob_image"),
        "图片 locator 必须开始返回 blob_asset，而不是继续只给顶层 original_url"
    );
    assert_eq!(
        body["blob_asset"]["asset_id"].as_str(),
        Some(attachment_id.as_str())
    );
    assert_eq!(
        body["blob_asset"]["variants"]["canonical"]["id"].as_str(),
        Some("canonical")
    );
    assert!(body["blob_asset"].get("preview").is_none());
    assert!(body["blob_asset"].get("full").is_none());
    assert!(body["blob_asset"].get("original").is_none());
    assert_eq!(
        body["blob_asset"]["variants"]["canonical"]["url"].as_str(),
        Some(format!("/api/media/{attachment_id}/blob/canonical?session_id={session_id}").as_str())
    );
    assert_eq!(
        body["blob_asset"]["origin"]["role"].as_str(),
        Some("cold_backup_only")
    );
    assert!(
        body.get("original_url").is_none(),
        "图片 locator 顶层 original_url 已退场，冷源只允许留在 blob_asset.origin"
    );
    assert_eq!(
        body["blob_asset"]["distribution"]["swarm_id"].as_str(),
        body["distribution"]["swarm_id"].as_str(),
        "blob_asset 和顶层 runtime distribution 必须继续引用同一份 swarm 真相"
    );
    assert!(
        body["thumbnail_url"].is_null(),
        "canonical 图片不再生成缩略图派生，locator 不能继续伪造顶层 thumbnail_url"
    );
    assert!(
        body.get("storage_key").is_none()
            && body.get("owner_anonymous_identity_id").is_none()
            && body.get("room_id").is_none()
            && body.get("thumbnail_storage_key").is_none(),
        "locator 只能暴露 transport 信息，不能把仓储私货和业务真相泄漏给壳层"
    );
    assert!(body["distribution"]["announce_urls"].is_array());
    assert!(room_id.starts_with("r-"), "应返回稳定房间标识");
}

#[tokio::test]
#[serial]
async fn torrent接口会返回稳定metainfo并与locator对齐() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let tus_upload_dir = state.tus_upload_dir.clone();
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("torrent-route-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let room_code = format!("TR{:010}", uniq % 10_000_000_000);
    let database_url = cfg.database_url.clone();
    let room_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &room_code).expect("应能进房");
        match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        }
    })
    .await
    .expect("阻塞建房任务应完成");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id"),
            "file_name": "torrent-route.mp4",
            "mime_type": "video/mp4",
            "byte_size": 最小mp4字节().len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "torrent-route.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 tus 临时视频文件");
    let upload_id = format!("upload-torrent-route-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "torrent-route.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id")
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");

    let session_id_for_message = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let attachment_id_for_message = attachment_id.clone();
    let database_url = cfg.database_url.clone();
    tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &session_id_for_message,
            &format!("torrent-message-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带视频附件的消息");
    })
    .await
    .expect("阻塞写消息任务应完成");

    let (_, locator_body) = send_json(
        app.clone(),
        Method::GET,
        &format!(
            "/api/media/{attachment_id}/locator?session_id={}",
            bootstrap["session_id"].as_str().expect("session_id")
        ),
        None,
        &[],
    )
    .await;

    let torrent_url = locator_body["distribution"]["torrent_url"]
        .as_str()
        .expect("locator 必须返回受控 torrent_url");
    let (status, headers, body) = send_bytes(app, Method::GET, torrent_url, &[]).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/x-bittorrent")
    );

    let metainfo =
        bip_metainfo::Metainfo::from_bytes(body.as_slice()).expect("torrent bytes 必须可解析");
    let content_hash = locator_body["distribution"]["content_hash"]
        .as_str()
        .expect("locator 必须返回稳定的 content_hash");
    let single_file = metainfo
        .info()
        .files()
        .next()
        .expect("单文件附件的 torrent 内必须保留一个可播放文件条目");
    assert_eq!(
        single_file.path().to_str(),
        Some(format!("content-{content_hash}.mp4").as_str()),
        "视频协作分发 torrent 内文件名必须保留稳定的可播放扩展，不能退化成 .bin"
    );
    let info_hash_hex = hex::encode(metainfo.info().info_hash().as_ref());
    assert_eq!(
        locator_body["distribution"]["torrent_info_hash"].as_str(),
        Some(info_hash_hex.as_str())
    );
}

#[tokio::test]
#[serial]
async fn locator会返回announce_web_seed与短时join_ticket() {
    let backup = 备份并清空环境变量(&[
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_TRACKER_PORT",
        "SWARM_WEB_SEED_PUBLIC_ENDPOINT",
        "SWARM_PEER_PRESENCE_STALE_SECONDS",
        "SWARM_TICKET_SECRET",
        "SWARM_TICKET_TTL_SECONDS",
    ]);
    env::set_var(
        "SWARM_TRACKER_PUBLIC_URL",
        "wss://swarm.example.com/announce",
    );
    env::set_var("SWARM_TRACKER_PORT", "7072");
    env::set_var("SWARM_WEB_SEED_PUBLIC_ENDPOINT", "https://cdn.example.com");
    env::set_var("SWARM_PEER_PRESENCE_STALE_SECONDS", "180");
    env::set_var("SWARM_TICKET_SECRET", "locator-ticket-secret-for-tests");
    env::set_var("SWARM_TICKET_TTL_SECONDS", "120");

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let tus_upload_dir = state.tus_upload_dir.clone();
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("locator-runtime-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let room_code = format!("LR{:010}", uniq % 10_000_000_000);
    let database_url = cfg.database_url.clone();
    let room_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &room_code).expect("应能进房");
        match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        }
    })
    .await
    .expect("阻塞建房任务应完成");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id"),
            "file_name": "locator-runtime.mp4",
            "mime_type": "video/mp4",
            "byte_size": 最小mp4字节().len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "locator-runtime.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 tus 临时视频文件");
    let upload_id = format!("upload-locator-runtime-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "locator-runtime.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id")
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");

    let session_id_for_message = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let attachment_id_for_message = attachment_id.clone();
    let database_url = cfg.database_url.clone();
    tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &session_id_for_message,
            &format!("locator-runtime-message-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带视频附件的消息");
    })
    .await
    .expect("阻塞写消息任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/media/{attachment_id}/locator?session_id={}",
            bootstrap["session_id"].as_str().expect("session_id")
        ),
        None,
        &[],
    )
    .await;

    恢复环境变量(backup);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["distribution"]["announce_urls"]
            .as_array()
            .map(|values| values.is_empty()),
        Some(false)
    );
    let expected_web_seed_url = format!(
        "https://cdn.example.com/api/attachments/{attachment_id}/content?session_id={}&variant=original",
        bootstrap["session_id"].as_str().expect("session_id")
    );
    assert_eq!(
        body["distribution"]["web_seed_url"].as_str(),
        Some(expected_web_seed_url.as_str())
    );
    let expected_presence_url = format!(
        "/api/media/{attachment_id}/presence?session_id={}",
        bootstrap["session_id"].as_str().expect("session_id")
    );
    assert_eq!(
        body["distribution"]["presence_url"].as_str(),
        Some(expected_presence_url.as_str())
    );
    assert!(
        body["distribution"]["join_ticket"]
            .as_str()
            .is_some_and(|ticket| !ticket.is_empty()),
        "locator 只要存在可用 swarm，就必须返回短时 join_ticket"
    );
    assert!(
        body["distribution"]["ticket_expires_at"]
            .as_str()
            .is_some_and(|expires_at| !expires_at.is_empty()),
        "locator 必须同时返回 ticket_expires_at，避免前端只能盲猜 refresh 时机"
    );
}

#[tokio::test]
#[serial]
async fn 未显式配置tracker公网地址时locator会优先返回同源相对announce路径() {
    let backup = 备份并清空环境变量(&[
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_TRACKER_PORT",
        "SWARM_WEB_SEED_PUBLIC_ENDPOINT",
        "SWARM_PEER_PRESENCE_STALE_SECONDS",
        "SWARM_TICKET_SECRET",
        "SWARM_TICKET_TTL_SECONDS",
    ]);
    env::set_var("SWARM_TRACKER_PORT", "7072");
    env::set_var("SWARM_PEER_PRESENCE_STALE_SECONDS", "180");
    env::set_var(
        "SWARM_TICKET_SECRET",
        "derive-tracker-public-url-ticket-secret",
    );
    env::set_var("SWARM_TICKET_TTL_SECONDS", "120");

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("DH{:010}", uniq % 10_000_000_000);
    let device_token = format!("derive-tracker-public-url-device-{uniq}");
    let attachment_id = format!("att-derive-tracker-public-url-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let session_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity =
            koko::usecase::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
                .expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("应能创建局部运行时");
        let database_url_for_attachment = database_url.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("derive-tracker-public-url-message-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 locator 任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (lan_status, lan_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[("host", "192.168.31.50:8080")],
    )
    .await;
    let (proxy_status, proxy_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[
            ("host", "10.0.0.8:8080"),
            ("x-forwarded-host", "im.example.com"),
            ("x-forwarded-proto", "https"),
            ("x-forwarded-port", "443"),
        ],
    )
    .await;

    恢复环境变量(backup);

    assert_eq!(lan_status, StatusCode::OK);
    assert_eq!(
        lan_body["distribution"]["announce_urls"][0].as_str(),
        Some("/api/swarm/announce"),
        "未显式配置 SWARM_TRACKER_PUBLIC_URL 时，浏览器 contract 应优先收口成同源相对 announce 路径"
    );
    assert_eq!(proxy_status, StatusCode::OK);
    assert_eq!(
        proxy_body["distribution"]["announce_urls"][0].as_str(),
        Some("/api/swarm/announce"),
        "即使当前请求已经处在公网 HTTPS 代理后，locator 仍应返回同源路径，禁止再给浏览器第二套 announce 绝对地址"
    );
}

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

    server.handle.abort();
    upstream.handle.abort();
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

    server.handle.abort();
    upstream.handle.abort();
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

    server.handle.abort();
    upstream.handle.abort();
    assert_eq!(
        forwarded, first_frame,
        "验票成功后首帧必须原样透明转发，Rust 代理不能改写 WebTorrent tracker 协议"
    );
}

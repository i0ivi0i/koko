use axum::http::{header, Method, StatusCode};
use object_store::{path::Path as ObjectPath, ObjectStoreExt};
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::{env_support::*, http::*, media::*};

/// 直接往对象存储写入测试资产字节，确保“数据库真相”和“物理对象”同时成立。
/// 这样冷源清理测试才能分清楚：到底是清理逻辑删掉了对象，还是一开始就没把对象写进去。
async fn 写入测试对象(state: &koko::shell::应用状态, 存储键: &str, 字节: Vec<u8>) {
    state
        .attachment_store
        .put(&ObjectPath::from(存储键), 字节.into())
        .await
        .expect("应能写入测试对象");
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

/// 协作分发测试：
/// 1. 这里只守 locator / torrent / presence / web seed 可用性裁决。
/// 2. 不负责消息成立、房间快照或 realtime 控制面。
#[tokio::test]
#[serial]
async fn ready附件会落协作分发元数据() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("distribution-ready-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "distribution-ready.png",
            "mime_type": "image/png",
            "byte_size": 68
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
        &state.tus_upload_dir,
        &attachment_id,
        "distribution-ready.png",
        &最小png字节(),
    )
    .expect("应能写入 tus 临时图片文件");
    let upload_id = format!("upload-distribution-ready-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "distribution-ready.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

    let (complete_status, complete_body) = send_json(
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验协作分发元数据");
    let row = sqlx::query(
        "SELECT content_id, content_hash, swarm_id, \
                EXTRACT(EPOCH FROM web_seed_until)::BIGINT AS web_seed_until_epoch \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("ready 后应存在协作分发元数据");

    let content_id: String = row.get("content_id");
    let content_hash: String = row.get("content_hash");
    let swarm_id: String = row.get("swarm_id");
    let web_seed_until_epoch: i64 = row.get("web_seed_until_epoch");

    assert_eq!(content_id, format!("content_{attachment_id}"));
    assert_eq!(swarm_id, format!("swarm_{content_hash}"));
    assert_eq!(content_hash.len(), 64, "SHA-256 十六进制摘要长度应为 64");
    assert!(
        web_seed_until_epoch
            > SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_secs() as i64,
        "24 小时保底窗口至少应落到未来时刻"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 相同内容的不同附件可以共享同一swarm_id() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let device_token = format!("distribution-share-device-{uniq}");
    let attachment_id_first = format!("att-share-first-{uniq}");
    let attachment_id_second = format!("att-share-second-{uniq}");
    let database_url = cfg.database_url.clone();
    let session_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入 ready 附件");
    插入ready图片附件记录(&pool, &session_id, &attachment_id_first).await;
    插入ready图片附件记录(&pool, &session_id, &attachment_id_second).await;
    pool.close().await;

    let shared_hash = format!("{uniq:016x}{uniq:016x}{uniq:016x}{uniq:016x}");
    let shared_swarm_id = format!("swarm_{shared_hash}");
    let database_url = cfg.database_url.clone();
    let attachment_id_first_for_worker = attachment_id_first.clone();
    let attachment_id_second_for_worker = attachment_id_second.clone();
    let shared_swarm_id_for_worker = shared_swarm_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let first = koko::usecase::写入协作分发元数据(
            &mut repo,
            &koko::usecase::协作分发元数据写入请求 {
                附件标识: attachment_id_first_for_worker.clone(),
                content_id: format!("content_{attachment_id_first_for_worker}"),
                content_hash: shared_hash.to_string(),
                swarm_id: shared_swarm_id_for_worker.clone(),
                web_seed_until秒: 1_775_942_400,
            },
        );
        let second = koko::usecase::写入协作分发元数据(
            &mut repo,
            &koko::usecase::协作分发元数据写入请求 {
                附件标识: attachment_id_second_for_worker.clone(),
                content_id: format!("content_{attachment_id_second_for_worker}"),
                content_hash: shared_hash.to_string(),
                swarm_id: shared_swarm_id_for_worker.clone(),
                web_seed_until秒: 1_775_942_500,
            },
        );
        (first, second)
    })
    .await
    .expect("阻塞写入任务应完成");

    assert!(result.0.is_ok(), "第一条相同内容附件应能落协作分发元数据");
    assert!(
        result.1.is_ok(),
        "第二条相同内容附件不应因为相同 swarm_id 被唯一索引卡死"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验共享 swarm_id");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM attachment_distribution_metadata WHERE swarm_id = $1",
    )
    .bind(&shared_swarm_id)
    .fetch_one(&pool)
    .await
    .expect("应能统计共享 swarm_id 的记录数");
    assert_eq!(count, 2, "同一内容的不同附件应该都能挂到同一个 swarm_id 下");
    pool.close().await;
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
    assert_eq!(
        body["streaming_asset"]["origin"]["original_url"].as_str(),
        body["original_url"].as_str(),
        "旧 original_url 还在兼容期时，必须和新的冷源描述保持一致"
    );
    assert_eq!(
        body["streaming_asset"]["distribution"]["swarm_id"].as_str(),
        body["distribution"]["swarm_id"].as_str(),
        "新旧过渡面在兼容期内必须引用同一份 swarm 真相"
    );
    assert!(
        body["original_url"].as_str().is_some(),
        "locator 必须返回受控原始内容地址"
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
async fn 视频locator与房间快照会共享同一套preview_asset() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("VS{:010}", uniq % 10_000_000_000);
    let device_token = format!("video-snapshot-preview-device-{uniq}");
    let attachment_id = format!("att-video-preview-{uniq}");
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
                .expect("应能直连数据库插入 ready 视频附件");
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            // 这里直接把缩略图存储键写进数据库，专门锁投影层：
            // 如果 locator/snapshot 仍然拿不到 preview_asset，说明 bug 在合同与投影链，不在对象存储。
            sqlx::query(
                "UPDATE attachments SET thumbnail_storage_key = $2 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .bind(format!("videos/{attachment_id_for_worker}/thumbnail.webp"))
            .execute(&pool)
            .await
            .expect("应能为测试视频补静态封面存储键");
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("video-preview-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能创建带视频附件的消息");

        (identity.会话标识, room_id)
    })
    .await
    .expect("阻塞 preview 投影任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let (locator_status, locator_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    let (snapshot_status, snapshot_body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(locator_status, StatusCode::OK);
    assert_eq!(snapshot_status, StatusCode::OK);
    let snapshot_video = snapshot_body["snapshot_messages"]
        .as_array()
        .expect("房间快照必须直接返回首屏消息")
        .iter()
        .find_map(|message| {
            message["attachments"]
                .as_array()?
                .iter()
                .find(|attachment| {
                    attachment["kind"].as_str() == Some("video")
                        && attachment["attachment_id"].as_str() == Some(attachment_id.as_str())
                })
        })
        .expect("房间快照里必须能找到刚发送的视频附件");
    let expected_preview_url = format!(
        "/api/attachments/{attachment_id}/content?session_id={session_id}&variant=thumbnail"
    );

    assert_eq!(
        locator_body["preview_asset"]["still_url"].as_str(),
        Some(expected_preview_url.as_str()),
        "视频 locator 必须直接返回静态封面真相，不能继续让视频附件没有 preview"
    );
    assert_eq!(
        snapshot_video["preview_asset"]["still_url"].as_str(),
        Some(expected_preview_url.as_str()),
        "房间快照里的视频附件也必须直接带出同一份静态封面真相"
    );
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
        body["blob_asset"]["preview"]["id"].as_str(),
        Some("preview")
    );
    assert_eq!(body["blob_asset"]["full"]["id"].as_str(), Some("full"));
    assert_eq!(
        body["blob_asset"]["original"]["id"].as_str(),
        Some("original")
    );
    assert_eq!(
        body["blob_asset"]["preview"]["url"].as_str(),
        Some(format!("/api/media/{attachment_id}/blob/preview?session_id={session_id}").as_str())
    );
    assert_eq!(
        body["blob_asset"]["full"]["url"].as_str(),
        Some(format!("/api/media/{attachment_id}/blob/full?session_id={session_id}").as_str())
    );
    assert_eq!(
        body["blob_asset"]["original"]["url"].as_str(),
        Some(format!("/api/media/{attachment_id}/blob/original?session_id={session_id}").as_str())
    );
    assert_eq!(
        body["blob_asset"]["origin"]["role"].as_str(),
        Some("cold_backup_only")
    );
    assert_eq!(
        body["blob_asset"]["origin"]["original_url"].as_str(),
        body["original_url"].as_str(),
        "兼容期里旧 original_url 只能留在 origin 里，不能再和 blob 主链分叉成两套真相"
    );
    assert_eq!(
        body["blob_asset"]["distribution"]["swarm_id"].as_str(),
        body["distribution"]["swarm_id"].as_str(),
        "blob_asset 和顶层 distribution 在兼容期内必须引用同一份 swarm 真相"
    );
    assert!(
        body["thumbnail_url"].as_str().is_some(),
        "过渡期 locator 仍应保留顶层 thumbnail_url 兼容旧调用方"
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
async fn 查询附件快照会带出图片真实资产与冷源生命周期字段() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let attachment_id = format!("att-image-snapshot-{uniq}");
    let device_token = format!("image-snapshot-device-{uniq}");
    let session_id = {
        let database_url = cfg.database_url.clone();
        tokio::task::spawn_blocking(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            koko::usecase::引导匿名身份(&mut repo, &device_token)
                .expect("应能引导匿名身份")
                .会话标识
        })
        .await
        .expect("阻塞引导任务应完成")
    };

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入图片附件");
    let owner_identity_db_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
    )
    .bind(&session_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询会话对应的匿名身份")
    .expect("附件 owner 必须能落到稳定匿名身份");
    let future_origin_expires_at = 未来冷源到期时间戳秒();
    sqlx::query(
        "INSERT INTO attachments (
            attachment_id,
            owner_anonymous_identity_id,
            kind,
            mime_type,
            byte_size,
            width,
            height,
            storage_key,
            thumbnail_storage_key,
            asset_original_storage_key,
            full_storage_key,
            origin_expires_at,
            origin_deleted_at,
            status
         ) VALUES (
            $1, $2, 'image', 'image/png', 68, 1, 1,
            $3, $4, $5, $6, TO_TIMESTAMP($7), NULL, 'ready'
         )",
    )
    .bind(&attachment_id)
    .bind(owner_identity_db_id)
    .bind(format!("images/{attachment_id}/origin-raw.png"))
    .bind(format!("images/{attachment_id}/thumbnail.png"))
    .bind(format!("images/{attachment_id}/asset-original.png"))
    .bind(format!("images/{attachment_id}/full.webp"))
    .bind(future_origin_expires_at)
    .execute(&pool)
    .await
    .expect("应能插入带真实图片资产字段的附件记录");
    pool.close().await;

    // 这个测试直接锁 repo -> usecase 快照边界，避免以后又把 full/original/origin 生命周期
    // 只留在 adapter 私货或 HTTP 壳层里。
    let database_url = cfg.database_url.clone();
    let attachment_id_for_query = attachment_id.clone();
    let snapshot = tokio::task::spawn_blocking(move || {
        let repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::仓储端口::查询附件快照(&repo, &attachment_id_for_query)
            .expect("query ok")
            .expect("attachment exists")
    })
    .await
    .expect("阻塞查询任务应完成");

    assert_eq!(
        snapshot.资产原图存储键.as_deref(),
        Some(format!("images/{attachment_id}/asset-original.png").as_str())
    );
    assert_eq!(
        snapshot.完整图存储键.as_deref(),
        Some(format!("images/{attachment_id}/full.webp").as_str())
    );
    assert_eq!(
        snapshot.原始冷源到期时间戳秒,
        Some(future_origin_expires_at)
    );
    assert_eq!(snapshot.原始冷源删除时间戳秒, None);
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
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
    let info_hash_hex = hex::encode(metainfo.info().info_hash().as_ref());
    assert_eq!(
        locator_body["distribution"]["torrent_info_hash"].as_str(),
        Some(info_hash_hex.as_str())
    );
}

#[tokio::test]
#[serial]
async fn locator会返回announce与web_seed并保留ticket占位() {
    let backup = 备份并清空环境变量(&[
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_TRACKER_PORT",
        "SWARM_WEB_SEED_PUBLIC_ENDPOINT",
        "SWARM_PEER_PRESENCE_STALE_SECONDS",
    ]);
    env::set_var(
        "SWARM_TRACKER_PUBLIC_URL",
        "wss://swarm.example.com/announce",
    );
    env::set_var("SWARM_TRACKER_PORT", "7072");
    env::set_var("SWARM_WEB_SEED_PUBLIC_ENDPOINT", "https://cdn.example.com");
    env::set_var("SWARM_PEER_PRESENCE_STALE_SECONDS", "180");

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
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
    assert!(body["distribution"]["join_ticket"].is_null());
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("available")
    );
}

#[tokio::test]
#[serial]
async fn presence上报会让web_seed过期但最近peer仍存活的locator保持available() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MP{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-presence-device-{uniq}");
    let attachment_id = format!("att-presence-{uniq}");
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
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '5 minutes', \
                     last_peer_seen_at = NULL \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 窗口挪到过去");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("presence-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能先创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 presence 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (presence_status, presence_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/presence?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(presence_status, StatusCode::NO_CONTENT, "{presence_body:?}");

    let (status, body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("available"),
        "最近 peer 仍在活跃时，后端不应该仅因 24 小时 WebSeed 窗口结束就直接裁决 expired"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验 presence");
    let last_peer_seen_epoch: Option<i64> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM last_peer_seen_at)::BIGINT \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 last_peer_seen_at");
    assert!(
        last_peer_seen_epoch.is_some(),
        "presence 上报后必须写入最近 peer 存活时间"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn web_seed过期且最近没有peer存活时locator会裁决expired() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MX{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-expired-device-{uniq}");
    let attachment_id = format!("att-expired-{uniq}");
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
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '5 minutes', \
                     last_peer_seen_at = NOW() - INTERVAL '10 minutes' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 和 peer 存活窗口一起挪到过去");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("expired-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能先创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 expired 建数任务应完成");

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
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("expired")
    );
}

#[tokio::test]
#[serial]
async fn 原始冷源超过24小时后会被后台清理并写入删除时间() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let attachment_id = format!("att-origin-cleanup-{uniq}");
    let device_token = format!("origin-cleanup-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let session_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready图片附件记录(&pool, &session_id, &attachment_id).await;
    sqlx::query(
        "UPDATE attachments
         SET origin_expires_at = NOW() - INTERVAL '25 hours',
             origin_deleted_at = NULL
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把原始冷源挪到 24 小时外");
    pool.close().await;

    let origin_storage_key = format!("original/{attachment_id_for_worker}.png");
    写入测试对象(&state, &origin_storage_key, 最小png字节()).await;

    koko::shell::执行一次媒体冷源清理(state.clone())
        .await
        .expect("应能执行一次冷源清理");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验清理结果");
    let row = sqlx::query(
        "SELECT EXTRACT(EPOCH FROM origin_deleted_at)::BIGINT AS origin_deleted_at_epoch
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id_for_worker)
    .fetch_one(&pool)
    .await
    .expect("应能查询冷源删除时间");
    let origin_deleted_at_epoch: Option<i64> = row.get("origin_deleted_at_epoch");
    assert!(
        origin_deleted_at_epoch.is_some(),
        "后台清理跑完后，附件真相里必须留下 origin_deleted_at，后续 locator 和内容读取才能共享同一条删除事实"
    );
    pool.close().await;

    let head_result = state
        .attachment_store
        .head(&ObjectPath::from(origin_storage_key.as_str()))
        .await;
    assert!(
        head_result.is_err(),
        "原始冷源超过 24 小时后必须被物理删除，不能只在数据库里写个过期时间假装完成"
    );
}

#[tokio::test]
#[serial]
async fn 视频mezzanine超过24小时后会被后台清理并写入删除时间() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let attachment_id = format!("att-mezzanine-cleanup-{uniq}");
    let device_token = format!("mezzanine-cleanup-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let session_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入视频附件");
    插入ready视频附件记录(&pool, &session_id, &attachment_id).await;
    sqlx::query(
        "UPDATE attachments
         SET mezzanine_expires_at = NOW() - INTERVAL '25 hours',
             mezzanine_deleted_at = NULL
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把视频 mezzanine 挪到 24 小时外");
    pool.close().await;

    let mezzanine_storage_key = format!("videos/{attachment_id_for_worker}/mezzanine.mp4");
    写入测试对象(&state, &mezzanine_storage_key, 最小mp4字节()).await;

    koko::shell::执行一次媒体冷源清理(state.clone())
        .await
        .expect("应能执行一次冷源清理");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验视频 mezzanine 清理结果");
    let row = sqlx::query(
        "SELECT EXTRACT(EPOCH FROM mezzanine_deleted_at)::BIGINT AS mezzanine_deleted_at_epoch
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id_for_worker)
    .fetch_one(&pool)
    .await
    .expect("应能查询视频 mezzanine 删除时间");
    let mezzanine_deleted_at_epoch: Option<i64> = row.get("mezzanine_deleted_at_epoch");
    assert!(
        mezzanine_deleted_at_epoch.is_some(),
        "视频 mezzanine 超时后必须留下 mezzanine_deleted_at，后续 locator 才能共享同一条回退层退场事实"
    );
    pool.close().await;

    let head_result = state
        .attachment_store
        .head(&ObjectPath::from(mezzanine_storage_key.as_str()))
        .await;
    assert!(
        head_result.is_err(),
        "视频 mezzanine 超过 24 小时后必须被物理删除，不能在对象存储里继续滞留"
    );
}

#[tokio::test]
#[serial]
async fn 冷源删除后locator顶层original失效但blob_original仍可读() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("OY{:010}", uniq % 10_000_000_000);
    let device_token = format!("origin-fallback-device-{uniq}");
    let attachment_id = format!("att-origin-fallback-{uniq}");
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
            插入ready图片附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachments
                 SET origin_expires_at = NOW() - INTERVAL '25 hours',
                     origin_deleted_at = NULL
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把图片冷源挪到 24 小时外");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("origin-fallback-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带图片附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    写入测试对象(
        &state,
        format!("original/{attachment_id}.png").as_str(),
        最小png字节(),
    )
    .await;
    写入测试对象(
        &state,
        format!("asset-original/{attachment_id}.png").as_str(),
        最小png字节(),
    )
    .await;
    写入测试对象(
        &state,
        format!("full/{attachment_id}.webp").as_str(),
        最小png字节(),
    )
    .await;
    let app = koko::shell::构建路由(state.clone());

    koko::shell::执行一次媒体冷源清理(state.clone())
        .await
        .expect("应能执行一次冷源清理");

    let (locator_status, locator_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(locator_status, StatusCode::OK);
    assert_eq!(
        locator_body["blob_asset"]["origin"]["available"].as_bool(),
        Some(false),
        "冷源物理删除后，blob_asset.origin 必须明确变成 unavailable，不能继续拿旧 original_url 冒充可用冷源"
    );

    let (legacy_origin_status, _, _) = send_bytes(
        app.clone(),
        Method::GET,
        &format!(
            "/api/attachments/{attachment_id}/content?session_id={session_id}&variant=original"
        ),
        &[],
    )
    .await;
    assert_eq!(
        legacy_origin_status,
        StatusCode::NOT_FOUND,
        "旧 original 冷源路由在物理删除后必须失效，避免 Web 继续偷偷依赖已经退场的原始附件主链"
    );

    let (blob_origin_status, _, blob_origin_body) = send_bytes(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/blob/original?session_id={session_id}"),
        &[],
    )
    .await;
    assert_eq!(blob_origin_status, StatusCode::OK);
    assert_eq!(
        blob_origin_body,
        最小png字节(),
        "图片长期原图资产必须继续可读，证明冷源退场后查看器仍依赖资产主链而不是 legacy original"
    );
}

#[tokio::test]
#[serial]
async fn 原图内容接口支持标准range读取() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("range-original-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let room_code = format!("RG{:010}", uniq % 10_000_000_000);
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
            "file_name": "range-original.mp4",
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
        "range-original.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 tus 临时视频文件");
    let upload_id = format!("upload-range-original-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "range-original.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
            &format!("range-original-message-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带视频附件的消息");
    })
    .await
    .expect("阻塞写消息任务应完成");

    let (status, headers, body) = send_bytes(
        app,
        Method::GET,
        &format!(
            "/api/attachments/{attachment_id}/content?session_id={}&variant=original",
            bootstrap["session_id"].as_str().expect("session_id")
        ),
        &[("range", "bytes=0-63")],
    )
    .await;

    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        headers
            .get(header::ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok()),
        Some("bytes")
    );
    let content_range = headers
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .expect("Range 响应必须带 Content-Range");
    assert!(
        content_range.starts_with("bytes 0-63/"),
        "视频 original range 现在读到的是 mezzanine，不能再假定总长度仍等于原始上传字节"
    );
    assert_eq!(body.len(), 64);
    assert!(
        !body.is_empty(),
        "视频 mezzanine 的 range 读取必须返回真实字节，而不是空响应"
    );
}

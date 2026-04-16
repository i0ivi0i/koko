use super::*;
use object_store::{path::Path as ObjectPath, ObjectStoreExt};

/// 冷源清理 owner：
/// 这里只验证后台如何回收原始冷源 / mezzanine 以及清理后共享事实如何收口。
/// 它不负责 locator / snapshot / presence 的读侧契约本身。
///
/// 直接往对象存储写测试字节的 helper 只对冷源 cleanup owner 有意义：
/// 它要证明“数据库里的待删事实”和“物理对象确实存在”同时成立。
/// 因此把它本地化在这个模块，避免它继续污染协作分发读侧顶层。
async fn 写入测试对象(state: &koko::shell::应用状态, 存储键: &str, 字节: Vec<u8>) {
    state
        .attachment_store
        .put(&ObjectPath::from(存储键), 字节.into())
        .await
        .expect("应能写入测试对象");
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
async fn 视频流媒体清单超过24小时后会被后台清理并写入删除时间() {
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
    let attachment_id = format!("att-streaming-cleanup-{uniq}");
    let device_token = format!("streaming-cleanup-device-{uniq}");
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
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    插入流媒体清单元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_streaming_manifests
         SET streaming_expires_at = NOW() - INTERVAL '25 hours',
             streaming_deleted_at = NULL
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把视频流媒体清单挪到 24 小时外");
    pool.close().await;

    // 这里故意同时放入主清单和子清单/分片，防止后续实现只删顶层文件，留下实际仍可读取的段资源。
    let hls_master_storage_key = format!("streams/{attachment_id_for_worker}/hls/master.m3u8");
    let hls_child_playlist_storage_key = format!("streams/{attachment_id_for_worker}/hls/video-720p.m3u8");
    let hls_segment_storage_key = format!("streams/{attachment_id_for_worker}/hls/video-720p-00001.ts");
    let dash_mpd_storage_key = format!("streams/{attachment_id_for_worker}/dash/stream.mpd");
    let dash_segment_storage_key = format!("streams/{attachment_id_for_worker}/dash/video-00001.m4s");
    写入测试对象(&state, &hls_master_storage_key, b"#EXTM3U\n".to_vec()).await;
    写入测试对象(
        &state,
        &hls_child_playlist_storage_key,
        b"#EXTM3U\n#EXTINF:2.0,\nvideo-720p-00001.ts\n".to_vec(),
    )
    .await;
    写入测试对象(&state, &hls_segment_storage_key, 最小mp4字节()).await;
    写入测试对象(
        &state,
        &dash_mpd_storage_key,
        br#"<?xml version="1.0" encoding="UTF-8"?><MPD />"#.to_vec(),
    )
    .await;
    写入测试对象(&state, &dash_segment_storage_key, 最小mp4字节()).await;

    koko::shell::执行一次媒体冷源清理(state.clone())
        .await
        .expect("应能执行一次冷源清理");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验流媒体清理结果");
    let row = sqlx::query(
        "SELECT EXTRACT(EPOCH FROM streaming_deleted_at)::BIGINT AS streaming_deleted_at_epoch
         FROM attachment_streaming_manifests
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id_for_worker)
    .fetch_one(&pool)
    .await
    .expect("应能查询流媒体清单删除时间");
    let streaming_deleted_at_epoch: Option<i64> = row.get("streaming_deleted_at_epoch");
    assert!(
        streaming_deleted_at_epoch.is_some(),
        "流媒体冷备窗口结束后，manifest 真相里必须留下 streaming_deleted_at，后续 locator 和内容读取才能共享同一条退场事实"
    );
    pool.close().await;

    for storage_key in [
        hls_master_storage_key.as_str(),
        hls_child_playlist_storage_key.as_str(),
        hls_segment_storage_key.as_str(),
        dash_mpd_storage_key.as_str(),
        dash_segment_storage_key.as_str(),
    ] {
        let head_result = state
            .attachment_store
            .head(&ObjectPath::from(storage_key))
            .await;
        assert!(
            head_result.is_err(),
            "流媒体清单超过 24 小时后，manifest 与 segment 都必须物理删除，不能继续让服务端承担长期标准流媒体主链"
        );
    }
}

#[tokio::test]
#[serial]
async fn streaming清理后distribution仍保留peer_only生存语义而不是回退服务器主链() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("SC{:010}", uniq % 10_000_000_000);
    let device_token = format!("streaming-peer-only-device-{uniq}");
    let attachment_id = format!("att-streaming-peer-only-{uniq}");
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
                "UPDATE attachment_distribution_metadata
                 SET web_seed_until = NOW() - INTERVAL '5 minutes',
                     last_peer_seen_at = NULL
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 窗口挪到过去");
            sqlx::query(
                "UPDATE attachment_streaming_manifests
                 SET streaming_expires_at = NOW() - INTERVAL '25 hours',
                     streaming_deleted_at = NULL
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把流媒体窗口挪到 24 小时外");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("streaming-peer-only-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带视频附件的消息");

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
        format!("streams/{attachment_id}/hls/master.m3u8").as_str(),
        b"#EXTM3U\n".to_vec(),
    )
    .await;
    写入测试对象(
        &state,
        format!("streams/{attachment_id}/dash/stream.mpd").as_str(),
        br#"<?xml version="1.0" encoding="UTF-8"?><MPD />"#.to_vec(),
    )
    .await;
    let app = koko::shell::构建路由(state.clone());

    let (presence_status, presence_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/presence?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(presence_status, StatusCode::NO_CONTENT, "{presence_body:?}");

    koko::shell::执行一次媒体冷源清理(state)
        .await
        .expect("应能执行一次冷源清理");

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
        Some("available"),
        "流媒体冷备窗口结束后，只要最近 peer 仍活着，distribution 就必须保持 peer 侧可存活，不能因为服务器 manifest 被删就直接裁决 expired"
    );
    assert!(
        body["distribution"]["web_seed_url"].is_null(),
        "web_seed 已过期时必须明确退场，避免 locator 偷偷把服务器 original 冷源继续当长期主链"
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

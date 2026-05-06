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
        koko::identity::application::引导匿名身份(&mut repo, &device_token)
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

    let origin_storage_key = format!("images/{attachment_id_for_worker}/canonical.webp");
    写入测试对象(&state, &origin_storage_key, 最小webp字节()).await;

    koko::shell::媒体清理::执行一次媒体冷源清理(state.clone())
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
async fn 共享canonical资产超过24小时只删除一次并同步标记所有引用附件() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平 source_hash 资产迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let attachment_id_a = format!("att-canonical-cleanup-a-{uniq}");
    let attachment_id_b = format!("att-canonical-cleanup-b-{uniq}");
    let device_token = format!("canonical-cleanup-device-{uniq}");
    let database_url = cfg.database_url.clone();

    let session_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::identity::application::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识
    })
    .await
    .expect("阻塞建数任务应完成");

    let content_hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let torrent_info_hash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let canonical_storage_key = format!("media-assets/{content_hash}/canonical.webp");
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入 canonical 资产");
    插入ready图片附件记录(&pool, &session_id, &attachment_id_a).await;
    插入ready图片附件记录(&pool, &session_id, &attachment_id_b).await;
    sqlx::query(
        "INSERT INTO canonical_media_assets (
            content_hash,
            kind,
            mime_type,
            byte_size,
            width,
            height,
            storage_key,
            torrent_bytes,
            torrent_info_hash,
            piece_length_bytes,
            web_seed_until,
            origin_expires_at
         ) VALUES (
            $1, 'image', 'image/webp', $2, 1, 1, $3, $4, $5, 16384,
            NOW() - INTERVAL '25 hours',
            NOW() - INTERVAL '25 hours'
         )
         ON CONFLICT (content_hash) DO UPDATE SET
            storage_key = EXCLUDED.storage_key,
            origin_expires_at = EXCLUDED.origin_expires_at,
            origin_deleted_at = NULL",
    )
    .bind(content_hash)
    .bind(最小webp字节().len() as i64)
    .bind(&canonical_storage_key)
    .bind(vec![1_u8, 2, 3])
    .bind(torrent_info_hash)
    .execute(&pool)
    .await
    .expect("应能插入待清理 canonical 资产");
    for attachment_id in [&attachment_id_a, &attachment_id_b] {
        sqlx::query(
            "UPDATE attachments
                SET storage_key = $2,
                    origin_expires_at = NOW() - INTERVAL '25 hours',
                    origin_deleted_at = NULL
              WHERE attachment_id = $1",
        )
        .bind(attachment_id)
        .bind(&canonical_storage_key)
        .execute(&pool)
        .await
        .expect("应能把附件指向共享 canonical 资产");
        sqlx::query(
            "INSERT INTO attachment_canonical_asset_refs (attachment_id, content_hash)
             VALUES ($1, $2)
             ON CONFLICT (attachment_id) DO UPDATE SET content_hash = EXCLUDED.content_hash",
        )
        .bind(attachment_id)
        .bind(content_hash)
        .execute(&pool)
        .await
        .expect("应能绑定附件到 canonical 资产");
    }
    pool.close().await;

    写入测试对象(&state, &canonical_storage_key, 最小webp字节()).await;
    koko::shell::媒体清理::执行一次媒体冷源清理(state.clone())
        .await
        .expect("应能执行一次 canonical 资产冷源清理");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验 canonical 清理结果");
    let asset_deleted_at: Option<i64> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM origin_deleted_at)::BIGINT
         FROM canonical_media_assets
         WHERE content_hash = $1",
    )
    .bind(content_hash)
    .fetch_one(&pool)
    .await
    .expect("应能查询 canonical 资产删除时间");
    assert!(
        asset_deleted_at.is_some(),
        "共享 canonical 资产物理删除后必须在资产表留下删除时间"
    );
    let deleted_attachment_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM attachments
         WHERE attachment_id = ANY($1)
           AND origin_deleted_at IS NOT NULL",
    )
    .bind(vec![attachment_id_a.clone(), attachment_id_b.clone()])
    .fetch_one(&pool)
    .await
    .expect("应能统计引用附件删除时间");
    assert_eq!(
        deleted_attachment_count, 2,
        "共享 canonical 资产删除后，所有引用附件都必须同步留下 origin_deleted_at"
    );
    pool.close().await;

    let head_result = state
        .attachment_store
        .head(&ObjectPath::from(canonical_storage_key.as_str()))
        .await;
    assert!(
        head_result.is_err(),
        "共享 canonical 对象超过 24 小时后必须只按内容资产删除一次"
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
        koko::identity::application::引导匿名身份(&mut repo, &device_token)
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

    koko::shell::媒体清理::执行一次媒体冷源清理(state.clone())
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
            koko::identity::application::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let room =
            koko::room::application::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
                .expect("应能进房");
        let room_id = match room {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
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
            sqlx::query(
                "UPDATE attachment_distribution_metadata
                 SET web_seed_until = NOW() - INTERVAL '5 minutes'
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 窗口挪到过去");
            pool.close().await;
        });

        koko::message::application::创建消息(
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
        Some(serde_json::json!({
            "peer_kind": "complete_peer"
        })),
        &[],
    )
    .await;
    assert_eq!(presence_status, StatusCode::NO_CONTENT, "{presence_body:?}");

    koko::shell::媒体清理::执行一次媒体冷源清理(state)
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
    assert!(
        body["distribution"]["web_seed_url"].is_null(),
        "web_seed 已过期时必须明确退场，避免 locator 偷偷把服务器 original 冷源继续当长期主链"
    );
}

#[tokio::test]
#[serial]
async fn 冷源删除后locator顶层original和blob_canonical都会失效() {
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
            koko::identity::application::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let room =
            koko::room::application::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
                .expect("应能进房");
        let room_id = match room {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
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

        koko::message::application::创建消息(
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
        format!("images/{attachment_id}/canonical.webp").as_str(),
        最小webp字节(),
    )
    .await;
    let app = koko::shell::构建路由(state.clone());

    koko::shell::媒体清理::执行一次媒体冷源清理(state.clone())
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

    let (blob_canonical_status, _, _) = send_bytes(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/blob/canonical?session_id={session_id}"),
        &[],
    )
    .await;
    assert_eq!(
        blob_canonical_status,
        StatusCode::GONE,
        "新图片正式面已经切到 WebTorrent 后，blob canonical 只剩 legacy/迁移壳；24 小时后继续访问也应显式拒绝，而不是伪装成可长期读取对象"
    );
}

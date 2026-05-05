use super::*;

#[tokio::test]
#[serial]
async fn 空body_presence不会把无种子附件抬成media_ready() {
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
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '5 minutes', \
                     swarm_id = $2 \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .bind(format!("swarm-no-seed-{uniq}"))
            .execute(&pool)
            .await
            .expect("应能把 web seed 窗口挪到过去");
            pool.close().await;
        });

        koko::message::application::创建消息(
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
    assert!(
        body["distribution"].get("availability").is_none(),
        "正式 locator contract 只能暴露 media_state，不能继续挂着 availability 兼容字段"
    );
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "空 body presence 不能再被当成 complete peer；首次访问仍应先进入连接群友窗口"
    );
    assert_eq!(
        body["distribution"]["media_state"]["retry_after_ms"].as_i64(),
        Some(2_000),
        "连接群友窗口必须保持短重试节奏"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验 presence");
    let viewer_intent_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM swarm_peer_presence \
         WHERE attachment_id = $1 AND peer_kind = 'viewer_intent'",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 viewer_intent 运行态记录");
    assert!(
        viewer_intent_count > 0,
        "空 body presence 仍应登记为 viewer_intent，便于运行态观测"
    );
    let complete_peer_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM swarm_peer_presence \
         WHERE attachment_id = $1 AND peer_kind = 'complete_peer'",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete_peer 运行态记录");
    assert_eq!(
        complete_peer_count, 0,
        "空 body presence 不能冒充 complete_peer 来源"
    );
    pool.close().await;
}
#[tokio::test]
#[serial]
async fn recent_partial_peer会让过期附件保持connecting而不是直接no_seed() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PP{:010}", uniq % 10_000_000_000);
    let device_token = format!("partial-peer-recent-device-{uniq}");
    let attachment_id = format!("att-partial-peer-recent-{uniq}");
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
        let session_id_for_attachment = identity.会话标识.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(
                &pool,
                &session_id_for_attachment,
                &attachment_id_for_worker,
            )
            .await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '2 hours' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web_seed 调整到明显过期窗口");
            写入指定类型peer存活记录(
                &pool,
                &attachment_id_for_worker,
                &session_id_for_attachment,
                "partial_peer",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_secs() as i64,
            )
            .await;
            pool.close().await;
        });

        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("partial-peer-recent-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 recent partial peer 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());

    let (status, first_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{first_body:?}");
    assert_eq!(
        first_body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "只有 recent partial_peer 活跃时，过期附件仍应进入连接群友态"
    );
}
#[tokio::test]
#[serial]
async fn stale_partial_peer不会把附件永久抬在connecting() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PQ{:010}", uniq % 10_000_000_000);
    let device_token = format!("partial-peer-stale-device-{uniq}");
    let attachment_id = format!("att-partial-peer-stale-{uniq}");
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
        let session_id_for_attachment = identity.会话标识.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(
                &pool,
                &session_id_for_attachment,
                &attachment_id_for_worker,
            )
            .await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '2 hours' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web_seed 调整到明显过期窗口");
            写入指定类型peer存活记录(
                &pool,
                &attachment_id_for_worker,
                &session_id_for_attachment,
                "partial_peer",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_secs() as i64
                    - 3600,
            )
            .await;
            pool.close().await;
        });

        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("partial-peer-stale-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 stale partial peer 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());

    let (status, first_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{first_body:?}");
    assert_eq!(
        first_body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "首次无源访问仍应先进入统一的连接群友窗口"
    );
    tokio::time::sleep(std::time::Duration::from_secs(9)).await;
    let (status, body) = send_json(
        koko::shell::构建路由(state),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_NO_ONLINE_SEED"),
        "过了 stale window 的 partial_peer 不能让附件永久停在连接群友态"
    );
}
#[tokio::test]
#[serial]
async fn partial_peer不能冒充available_ready来源() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PR{:010}", uniq % 10_000_000_000);
    let device_token = format!("partial-peer-availability-device-{uniq}");
    let attachment_id = format!("att-partial-peer-availability-{uniq}");
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
        let session_id_for_attachment = identity.会话标识.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(
                &pool,
                &session_id_for_attachment,
                &attachment_id_for_worker,
            )
            .await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '2 hours' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web_seed 调整到明显过期窗口");
            写入指定类型peer存活记录(
                &pool,
                &attachment_id_for_worker,
                &session_id_for_attachment,
                "partial_peer",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_secs() as i64,
            )
            .await;
            pool.close().await;
        });

        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("partial-peer-availability-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 partial peer availability 建数任务应完成");

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

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_ne!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "partial_peer 不能冒充 available-ready 等价真相"
    );
}
#[tokio::test]
#[serial]
async fn 同swarm的另一条完整peer能让旧附件保持ready() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MS{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-shared-peer-device-{uniq}");
    let attachment_id_target = format!("att-shared-target-{uniq}");
    let attachment_id_seed = format!("att-shared-seed-{uniq}");
    let shared_swarm_id = format!("swarm-shared-peer-{uniq}");
    let shared_content_hash = format!("{uniq:016x}{uniq:016x}{uniq:016x}{uniq:016x}");
    let database_url = cfg.database_url.clone();
    let attachment_id_target_for_worker = attachment_id_target.clone();
    let attachment_id_seed_for_worker = attachment_id_seed.clone();
    let shared_swarm_id_for_worker = shared_swarm_id.clone();
    let shared_content_hash_for_worker = shared_content_hash.clone();

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
            插入ready视频附件记录(
                &pool,
                &identity.会话标识,
                &attachment_id_target_for_worker,
            )
            .await;
            插入附件协作分发元数据记录(&pool, &attachment_id_target_for_worker).await;
            插入ready视频附件记录(
                &pool,
                &identity.会话标识,
                &attachment_id_seed_for_worker,
            )
            .await;
            插入附件协作分发元数据记录(&pool, &attachment_id_seed_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '5 minutes', \
                     swarm_id = $2, \
                     content_hash = $3 \
                 WHERE attachment_id IN ($1, $4)",
            )
            .bind(&attachment_id_target_for_worker)
            .bind(&shared_swarm_id_for_worker)
            .bind(&shared_content_hash_for_worker)
            .bind(&attachment_id_seed_for_worker)
            .execute(&pool)
            .await
            .expect("应能把两条附件收口到同一个共享 swarm，并把 web_seed 窗口挪到过去");
            pool.close().await;
        });

        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("shared-target-client-{uniq}"),
            "",
            &[attachment_id_target_for_worker],
        )
        .expect("应能创建目标附件消息");
        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("shared-seed-client-{uniq}"),
            "",
            &[attachment_id_seed_for_worker],
        )
        .expect("应能创建做种附件消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 shared swarm 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (presence_status, presence_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id_seed}/presence?session_id={session_id}"),
        Some(serde_json::json!({
            "peer_kind": "complete_peer"
        })),
        &[],
    )
    .await;
    assert_eq!(presence_status, StatusCode::NO_CONTENT, "{presence_body:?}");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id_target}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "同一 swarm 的完整来源应统一投影成 MEDIA_READY"
    );
}

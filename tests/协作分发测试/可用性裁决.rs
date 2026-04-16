use super::*;

/// 可用性裁决测试只守 availability 真相：
/// 1. presence 上报会刷新最近 peer 存活时间；
/// 2. web_seed 过期后，是 available 还是 expired，只由 peer 存活窗口裁决。
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

use super::*;

#[tokio::test]
#[serial]
async fn 附件已删除时locator会返回media_deleted终态而不是附件未就绪错误() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MD{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-deleted-device-{uniq}");
    let attachment_id = format!("att-deleted-{uniq}");
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
            pool.close().await;
        });

        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("deleted-client-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能先创建带视频附件的消息");

        let attachment_id_for_update = attachment_id_for_worker.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库更新附件状态");
            sqlx::query(
                "UPDATE attachments
                 SET status = 'expired'
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_update)
            .execute(&pool)
            .await
            .expect("应能把附件状态标记为已删除终态");
            pool.close().await;
        });

        identity.会话标识
    })
    .await
    .expect("阻塞 deleted 建数任务应完成");

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
    assert_eq!(
        body["status"].as_str(),
        Some("deleted"),
        "附件已删除时，locator 顶层状态要明确进入 deleted，而不是继续报 ready/expired"
    );
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_DELETED"),
        "删除终态必须明确返回 MEDIA_DELETED，不能混成附件未就绪或无在线种子"
    );
    assert!(
        body["distribution"]["join_ticket"].is_null(),
        "删除终态不应继续签发 swarm join ticket"
    );
}
#[tokio::test]
#[serial]
async fn web_seed过期且streaming已删除但最近peer仍存活时locator会进入peer_only可用态() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(
            serde_json::json!({"device_anonymous_token": format!("peer-only-after-streaming-delete-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-peer-only-after-streaming-delete-{uniq}");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET web_seed_until = NOW() - INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把 web_seed 挪出窗口");
    写入完整peer存活记录(&pool, &attachment_id, session_id).await;
    pool.close().await;

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "peer-only 可用态本质仍是 READY，前端不应被迫做二次状态翻译"
    );
    assert_eq!(
        body["distribution"]["survival_mode"].as_str(),
        Some("peer_only_after_expiry")
    );
    assert!(
        body["distribution"]["web_seed_url"].is_null(),
        "web_seed 已过期时，locator 顶层分发表面必须明确退场"
    );
    assert!(
        body["file_asset"]["manifest"].is_null(),
        "唯一 WebTorrent 正式链下，locator 不能继续投影 HLS/DASH manifest 第二链"
    );
    assert!(
        body["file_asset"]["lifecycle"].is_null(),
        "正式视频资产不再对外暴露 streaming 生命周期第二真相"
    );
    assert_eq!(
        body["file_asset"]["origin"]["role"].as_str(),
        Some("cold_backup_only"),
        "peer-only 之后仍只允许通过 file_asset.origin 表达冷备语义"
    );
}
#[tokio::test]
#[serial]
async fn active_backend_strong_seed会让同swarm过期附件保持ready() {
    let (fake_seeder_base_url, _seeder_records, fake_seeder_server) = 启动假seeder控制面().await;
    let backup = 备份并清空环境变量(&[
        "SWARM_SEEDER_CONTROL_BASE_URL",
        "SWARM_TICKET_SECRET",
    ]);
    env::set_var(
        "SWARM_SEEDER_CONTROL_BASE_URL",
        fake_seeder_base_url.as_str(),
    );
    env::set_var("SWARM_TICKET_SECRET", "active-backend-strong-seed-ticket-secret");

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
        Some(serde_json::json!({
            "device_anonymous_token": format!("backend-seed-shared-swarm-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id_expired = format!("att-backend-seed-expired-{uniq}");
    let attachment_id_active = format!("att-backend-seed-active-{uniq}");
    let shared_swarm_id = format!("swarm-backend-seed-shared-{uniq}");
    let shared_content_hash = format!("{uniq:016x}{uniq:016x}{uniq:016x}{uniq:016x}");
    let (torrent_bytes, active_info_hash, piece_length) =
        构造有效测试torrent元信息(format!("backend-seed-active-{uniq}").as_str());

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id_expired).await;
    插入附件协作分发元数据记录(&pool, &attachment_id_expired).await;
    插入ready视频附件记录(&pool, session_id, &attachment_id_active).await;
    插入附件协作分发元数据记录(&pool, &attachment_id_active).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET swarm_id = $2,
             content_hash = $3
         WHERE attachment_id IN ($1, $4)",
    )
    .bind(&attachment_id_expired)
    .bind(&shared_swarm_id)
    .bind(&shared_content_hash)
    .bind(&attachment_id_active)
    .execute(&pool)
    .await
    .expect("应能把两条附件收口到同一个共享 swarm");
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET web_seed_until = NOW() - INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id_expired)
    .execute(&pool)
    .await
    .expect("应能把过期附件挪出 web_seed 窗口");
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET web_seed_until = NOW() + INTERVAL '30 minutes',
             torrent_info_hash = $2,
             torrent_bytes = $3,
             piece_length_bytes = $4
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id_active)
    .bind(&active_info_hash)
    .bind(&torrent_bytes)
    .bind(piece_length)
    .execute(&pool)
    .await
    .expect("应能把 active 附件补齐做种所需 torrent 元信息");
    pool.close().await;

    koko::shell::协作分发做种::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id_expired}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "backend strong seed 应被当成正式可用来源，状态必须保持 READY"
    );

    let cleanup_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库清理测试附件");
    sqlx::query(
        "DELETE FROM attachment_distribution_metadata
         WHERE attachment_id IN ($1, $2)",
    )
    .bind(&attachment_id_expired)
    .bind(&attachment_id_active)
    .execute(&cleanup_pool)
    .await
    .expect("应能清理协作分发元数据");
    sqlx::query("DELETE FROM attachments WHERE attachment_id IN ($1, $2)")
        .bind(&attachment_id_expired)
        .bind(&attachment_id_active)
        .execute(&cleanup_pool)
        .await
        .expect("应能清理附件记录");
    cleanup_pool.close().await;

    fake_seeder_server.abort();
    恢复环境变量(backup);
}

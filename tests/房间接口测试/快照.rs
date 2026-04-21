use super::*;

/// 快照测试：
/// 1. 这里只守 snapshot 的恢复窗口、未读定位和首屏排序。
/// 2. 重点是“房间如何返回消息首屏”，不是“消息如何成立”。
#[tokio::test]
#[serial]
async fn 有阅读锚点时房间快照围绕第一条未读返回首屏() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("S{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..100 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-c-{index}"),
                &format!("snapshot-{index}"),
            )
            .expect("应能连续发送消息");
        }
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &session_id, 80)
            .expect("应能先建立阅读锚点");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(80));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(81));
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    let positions = messages
        .iter()
        .map(|msg| msg["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();

    assert!(
        positions.iter().any(|position| *position < 81),
        "首屏必须带已读上下文"
    );
    assert!(positions.contains(&81), "首屏必须覆盖第一条未读");
    assert!(
        positions.first().copied().unwrap_or_default() > 1,
        "围绕未读恢复时不应回到整房最老消息"
    );
    assert_eq!(
        positions.last().copied(),
        Some(100),
        "首屏应覆盖当前房间最新位置附近"
    );
}

#[tokio::test]
#[serial]
async fn 房间快照会返回首条未读事件位置和是否仍有更早历史() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("Q{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-order-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..100 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-order-c-{index}"),
                &format!("order-{index}"),
            )
            .expect("应能连续发送消息");
        }
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &session_id, 90)
            .expect("应能先推进阅读位置");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(90));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(91));
    assert_eq!(body["has_more_before"].as_bool(), Some(true));
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    let positions = messages
        .iter()
        .map(|message| message["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();
    assert!(
        positions.windows(2).all(|window| window[0] < window[1]),
        "房间快照里的首屏消息必须按升序返回"
    );
}

#[tokio::test]
#[serial]
async fn 无阅读锚点时房间快照回退到最近一屏消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("P{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-short-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..60 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-short-c-{index}"),
                &format!("latest-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), None);
    assert_eq!(body["first_unread_event_position"].as_i64(), None);
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    assert!(!messages.is_empty(), "无阅读锚点时也应返回最近一屏消息");
    assert_eq!(
        messages.last().and_then(|msg| msg["body"].as_str()),
        Some("latest-59")
    );
    assert_ne!(
        messages.first().and_then(|msg| msg["body"].as_str()),
        Some("latest-0"),
        "无阅读锚点时不应回到整房最老消息"
    );
}

#[tokio::test]
#[serial]
async fn 晚进群历史视频消息快照仍会带legacy_preview_asset() {
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
    let room_code = format!("SV{:010}", uniq % 10_000_000_000);
    let device_token = format!("snapshot-video-preview-device-{uniq}");
    let attachment_id = format!("att-snapshot-video-preview-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
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
                .expect("应能直连数据库插入视频附件");
            super::test_support::media::插入ready视频附件记录(
                &pool,
                &identity.会话标识,
                &attachment_id_for_worker,
            )
            .await;
            sqlx::query(
                "UPDATE attachments SET thumbnail_storage_key = $2 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .bind(format!("videos/{attachment_id_for_worker}/thumbnail.webp"))
            .execute(&pool)
            .await
            .expect("应能为测试视频补静态封面存储键");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("snapshot-video-preview-message-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能创建纯视频消息");

        (identity.会话标识, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let snapshot_video = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages")
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
        .expect("晚进群时首屏快照里必须能找到视频附件");
    assert_eq!(
        snapshot_video["preview_asset"]["still_url"].as_str(),
        Some(
            format!(
                "/api/attachments/{attachment_id}/content?session_id={session_id}&variant=thumbnail"
            )
            .as_str()
        ),
        "晚进群恢复时，视频消息必须直接带静态封面真相，不能再等 locator 二次补图"
    );
}

#[tokio::test]
#[serial]
async fn 晚进群新单文件视频消息快照默认不带preview_asset() {
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
    let room_code = format!("SN{:010}", uniq % 10_000_000_000);
    let device_token = format!("snapshot-video-no-preview-device-{uniq}");
    let attachment_id = format!("att-snapshot-video-no-preview-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
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
                .expect("应能直连数据库插入视频附件");
            super::test_support::media::插入ready视频附件记录(
                &pool,
                &identity.会话标识,
                &attachment_id_for_worker,
            )
            .await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("snapshot-video-no-preview-message-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能创建纯视频消息");

        (identity.会话标识, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let snapshot_video = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages")
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
        .expect("晚进群时首屏快照里必须能找到视频附件");
    assert!(
        snapshot_video["preview_asset"].is_null(),
        "新单文件视频晚进群恢复时不应再靠后端 still 撑首屏；客户端应根据拿到的 source bytes 自己派生 preview"
    );
}

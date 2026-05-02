use super::*;

/// 投影一致性测试只守“同一媒体事实投影到不同读模型时不能漂移”：
/// 1. 历史 still 资产在 locator 与房间快照里仍要共享同一份 legacy preview_asset；
/// 2. 新单文件视频默认不能被投影层偷偷伪造出 still；
/// 3. 附件快照必须直接带出图片真实资产与冷源生命周期字段。
#[tokio::test]
#[serial]
async fn 历史带thumbnail_storage_key的视频locator与房间快照仍共享同一套preview_asset() {
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

        koko::message::application::创建消息(
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
async fn 新单文件视频locator与房间快照默认不会投影preview_asset() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("VN{:010}", uniq % 10_000_000_000);
    let device_token = format!("video-snapshot-no-preview-device-{uniq}");
    let attachment_id = format!("att-video-no-preview-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
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
                .expect("应能直连数据库插入 ready 视频附件");
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            pool.close().await;
        });

        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("video-no-preview-{uniq}"),
            "",
            std::slice::from_ref(&attachment_id_for_worker),
        )
        .expect("应能创建带视频附件的消息");

        (identity.会话标识, room_id)
    })
    .await
    .expect("阻塞无 still 投影任务应完成");

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

    assert!(
        locator_body["preview_asset"].is_null(),
        "新单文件视频 locator 默认不该继续脑补 still；有没有预览改由客户端 runtime 根据 source bytes 自己裁决"
    );
    assert!(
        snapshot_video["preview_asset"].is_null(),
        "晚进群快照对新视频也不应伪造 still，否则前端会继续被旧字段绑死"
    );
}

#[tokio::test]
#[serial]
async fn 视频complete与locator会共享同一套file_asset与peer_only生存字段() {
    let backup = 备份并清空环境变量(&["SWARM_TICKET_SECRET", "SWARM_TICKET_TTL_SECONDS"]);
    std::env::set_var("SWARM_TICKET_SECRET", "projection-ticket-secret-for-tests");
    std::env::set_var("SWARM_TICKET_TTL_SECONDS", "180");
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let tus_upload_dir = state.tus_upload_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(
            serde_json::json!({"device_anonymous_token": format!("projection-video-lifecycle-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let video_bytes = 最小mp4字节();
    let video_byte_size = video_bytes.len() as i64;
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "projection.mp4",
            "mime_type": "video/mp4",
            "byte_size": video_bytes.len()
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
    let upload_id = format!("upload-projection-video-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "projection.mp4",
        &video_bytes,
    )
    .expect("应能写入 tus 临时视频文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "projection.mp4",
            "video/mp4",
            video_byte_size,
            video_byte_size,
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
        Some(serde_json::json!({ "session_id": session_id })),
        &[],
    )
    .await;
    let (locator_status, locator_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    恢复环境变量(backup);

    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");
    assert_eq!(locator_status, StatusCode::OK, "{locator_body:?}");
    assert_eq!(
        complete_body["media_asset"]["kind"].as_str(),
        Some("file_video"),
        "complete 必须返回单文件视频资产，而不是重新长出 streaming_video"
    );
    assert_eq!(
        locator_body["file_asset"]["kind"].as_str(),
        Some("file_video"),
        "locator 也必须投影同一份 file_asset 真相"
    );
    assert_eq!(
        complete_body["media_asset"]["variants"]["canonical"]["url"].as_str(),
        locator_body["file_asset"]["variants"]["canonical"]["url"].as_str(),
        "complete 与 locator 必须共享同一条 canonical 受控读取入口"
    );
    assert_eq!(
        complete_body["media_asset"]["lifecycle"], locator_body["file_asset"]["lifecycle"],
        "单文件视频没有 streaming 生命周期，complete 和 locator 都不能各自脑补"
    );
    assert_eq!(
        complete_body["media_asset"]["distribution"]["survival_mode"].as_str(),
        Some("peer_only_after_expiry"),
        "complete 必须直接表达删源后的长期正式平面只剩 peer"
    );
    assert!(
        locator_body.get("original_url").is_none(),
        "locator 顶层 original_url 必须退场，冷源只允许留在 file_asset.origin"
    );
    assert_eq!(
        locator_body["distribution"]["survival_mode"].as_str(),
        Some("peer_only_after_expiry"),
        "locator 顶层 runtime distribution 仍必须共享同一套 survival_mode"
    );
    assert_eq!(
        complete_body["media_asset"]["distribution"]["survival_mode"].as_str(),
        locator_body["file_asset"]["distribution"]["survival_mode"].as_str(),
        "complete.media_asset 与 locator.file_asset 不能把 survival_mode 投影成两套不同语义"
    );
    assert_eq!(
        locator_body["distribution"]["survival_mode"].as_str(),
        locator_body["file_asset"]["distribution"]["survival_mode"].as_str(),
        "locator 顶层 runtime distribution 与 file_asset.distribution 不能各说各话"
    );
    assert!(
        complete_body["media_asset"]["distribution"]["join_ticket"]
            .as_str()
            .is_some_and(|ticket| !ticket.is_empty()),
        "complete.media_asset 也必须带上 join_ticket，不能只让 locator 独占门禁线索"
    );
    assert!(
        locator_body["distribution"]["join_ticket"]
            .as_str()
            .is_some_and(|ticket| !ticket.is_empty()),
        "locator 顶层 runtime distribution 必须同步下发可用 join_ticket"
    );
    assert!(
        complete_body["media_asset"]["distribution"]["ticket_expires_at"]
            .as_str()
            .is_some_and(|expires_at| !expires_at.is_empty()),
        "complete.media_asset 必须同步带出 ticket 过期时间"
    );
    assert!(
        locator_body["distribution"]["ticket_expires_at"]
            .as_str()
            .is_some_and(|expires_at| !expires_at.is_empty()),
        "locator 顶层 runtime distribution 也必须共享同一类 ticket 过期语义"
    );
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
            koko::identity::application::引导匿名身份(&mut repo, &device_token)
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

    // 这个测试直接锁 repo -> application 快照边界，避免以后又把 full/original/origin 生命周期
    // 只留在 adapter 私货或 HTTP 壳层里。
    let database_url = cfg.database_url.clone();
    let attachment_id_for_query = attachment_id.clone();
    let snapshot = tokio::task::spawn_blocking(move || {
        let repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::application::仓储端口::查询附件快照(&repo, &attachment_id_for_query)
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

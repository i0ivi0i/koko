use super::*;

/// 历史分页测试：
/// 1. 这里只守 history 查询的窗口裁剪、参数校验和成员可见性。
/// 2. 返回顺序必须稳定按事件位置升序。
#[tokio::test]
#[serial]
async fn 房间历史分页会返回before_event_position之前的消息() {
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
    let code = format!("H{:011}", (uniq + 1) % 100_000_000_000);
    let device_token = format!("history-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id, initial_alias) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let identity =
            koko::identity::application::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let session_id = identity.会话标识;
        let initial_alias = identity.展示花名;
        let room =
            koko::room::application::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..6 {
            koko::message::application::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("history-c-{index}"),
                &format!("history-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id, initial_alias)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=5&limit=2"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let messages = body["messages"].as_array().expect("messages 应为数组");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["body"].as_str(), Some("history-2"));
    assert_eq!(messages[1]["body"].as_str(), Some("history-3"));
    assert_eq!(
        messages[0]["sender_display_alias"].as_str(),
        Some(initial_alias.as_str()),
        "首次历史读取应先拿到当前展示花名"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库修改当前花名投影");
    sqlx::query(
        "UPDATE anonymous_identities \
         SET display_alias = $1 \
         WHERE id = (SELECT anonymous_identity_id FROM sessions WHERE session_id = $2)",
    )
    .bind("失眠的海豹")
    .bind(&session_id)
    .execute(&pool)
    .await
    .expect("应能直接改掉匿名身份当前花名");

    let (status_after, body_after) = send_json(
        koko::shell::构建路由(state),
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=5&limit=2"
        ),
        None,
        &[],
    )
    .await;
    assert_eq!(status_after, StatusCode::OK);
    let messages_after = body_after["messages"]
        .as_array()
        .expect("messages 应为数组");
    assert_eq!(
        messages_after[0]["sender_display_alias"].as_str(),
        Some("失眠的海豹"),
        "修改 anonymous_identities.display_alias 后，旧消息也必须显示新花名"
    );

    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 房间历史分页缺少before_event_position会返回invalid_argument() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, identity) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(
            serde_json::json!({"device_anonymous_token": format!("history-missing-before-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = identity["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/r-missing/history?session_id={session_id}&limit=20"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
}

#[tokio::test]
#[serial]
async fn 房间历史分页仍按事件位置升序返回() {
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
    let code = format!("I{:011}", (uniq + 2) % 100_000_000_000);
    let device_token = format!("history-order-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::identity::application::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::room::application::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..4 {
            koko::message::application::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("history-order-c-{index}"),
                &format!("history-order-{index}"),
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
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=5&limit=4"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let positions = body["messages"]
        .as_array()
        .expect("messages 应为数组")
        .iter()
        .map(|message| message["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();
    assert_eq!(positions, vec![1, 2, 3, 4]);
}

#[tokio::test]
#[serial]
async fn 房间历史分页无更早消息时返回空数组() {
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
    let code = format!("J{:011}", (uniq + 3) % 100_000_000_000);
    let device_token = format!("history-empty-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::identity::application::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::room::application::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        koko::message::application::发送文本消息(
            &mut repo,
            &room_id,
            &session_id,
            "history-empty-c-1",
            "first",
        )
        .expect("应能发送消息");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=1&limit=55"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let messages = body["messages"].as_array().expect("messages 应为数组");
    assert!(messages.is_empty(), "没有更早历史时必须返回空数组");
}

#[tokio::test]
#[serial]
async fn 非成员不能通过history接口读取更早消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("K{:011}", (uniq + 4) % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("history-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("history-stranger-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger["session_id"].as_str().expect("stranger session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/history?session_id={stranger_session_id}&before_event_position=1&limit=55"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

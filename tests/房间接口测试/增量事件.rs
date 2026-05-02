use super::*;

/// 增量事件测试：
/// 1. 这里只守 events 查询的参数约束、成员可见性和增量游标语义。
/// 2. 不在这里验证消息创建链路本身，只验证房间事件读取接口。
#[tokio::test]
#[serial]
async fn 房间增量事件查询缺少session_id会被拒绝() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(
        app,
        Method::GET,
        "/api/rooms/r-missing/events?from=0",
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
}

#[tokio::test]
#[serial]
async fn 非成员不能通过events接口拉取房间增量() {
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
    let code = format!("E{:011}", uniq % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("owner-device-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("stranger-device-{uniq}")})),
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
        &format!("/api/rooms/{room_id}/events?session_id={stranger_session_id}&from=0"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[tokio::test]
#[serial]
async fn 成员通过events接口只会拿到from之后的事件() {
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
    let code = format!("F{:011}", uniq % 100_000_000_000);
    let device_token = format!("events-device-{uniq}");
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
        koko::message::application::发送文本消息(&mut repo, &room_id, &session_id, "c-1", "first")
            .expect("应能发送第一条消息");
        koko::message::application::发送文本消息(&mut repo, &room_id, &session_id, "c-2", "second")
            .expect("应能发送第二条消息");
        (session_id, room_id, initial_alias)
    })
    .await
    .expect("阻塞建数任务应完成");

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
    .bind("冷静的水獭")
    .bind(&session_id)
    .execute(&pool)
    .await
    .expect("应能直接改掉匿名身份当前花名");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/events?session_id={session_id}&from=0"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let events = body["events"].as_array().expect("events 应为数组");
    assert_eq!(events.len(), 2, "from=0 时应拿到所有已成立事件");
    assert_eq!(events[0]["event_position"].as_i64(), Some(1));
    assert_eq!(events[1]["event_position"].as_i64(), Some(2));
    assert_eq!(
        events[0]["sender_display_alias"].as_str(),
        Some("冷静的水獭"),
        "修改 anonymous_identities.display_alias 后，增量事件也必须读取当前花名投影"
    );
    assert_ne!(
        events[0]["sender_display_alias"].as_str(),
        Some(initial_alias.as_str()),
        "测试前提错误：更新后的花名必须和原始花名不同"
    );
    assert_eq!(body["latest_event_position"].as_i64(), Some(2));

    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 不存在的房间通过events接口会返回room_not_found() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": "missing-room-device"})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/r-nope/events?session_id={session_id}&from=0"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"].as_str(), Some("room_not_found"));
}

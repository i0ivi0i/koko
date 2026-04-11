use super::*;

/// 阅读推进测试：
/// 1. 这里只守 read-anchor 的成员约束、单调性和失败后可恢复性。
/// 2. 既覆盖 HTTP 入口，也覆盖锚点落库真相。
#[tokio::test]
#[serial]
async fn 阅读锚点会写入当前匿名身份与房间的唯一记录() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平阅读锚点迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("RA{:010}", uniq % 10_000_000_000);
    let device_token = format!("read-anchor-device-{uniq}");
    let database_url = cfg.database_url.clone();

    let (identity_id, room_id) = tokio::task::spawn_blocking(move || {
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

        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 0)
            .expect("应能写入初始阅读锚点");
        (identity.匿名身份标识, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验阅读锚点");
    let row = sqlx::query(
        "SELECT ai.anonymous_identity_id, rra.last_read_event_position \
         FROM room_read_anchors rra \
         JOIN anonymous_identities ai ON ai.id = rra.anonymous_identity_id \
         JOIN rooms r ON r.id = rra.room_id \
         WHERE r.room_id = $1",
    )
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .expect("应存在阅读锚点记录");

    let stored_identity: String = row.get("anonymous_identity_id");
    let stored_position: i64 = row.get("last_read_event_position");
    assert_eq!(stored_identity, identity_id);
    assert_eq!(stored_position, 0);

    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 阅读锚点只会单调前进不会被回退覆盖() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平阅读锚点迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("RB{:010}", uniq % 10_000_000_000);
    let device_token = format!("read-anchor-advance-{uniq}");
    let database_url = cfg.database_url.clone();

    let room_id = tokio::task::spawn_blocking(move || {
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

        for index in 0..5 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &identity.会话标识,
                &format!("read-anchor-c-{index}"),
                &format!("read-anchor-{index}"),
            )
            .expect("应能先制造已成立消息");
        }

        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 5)
            .expect("应能先写入更靠后的位置");
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 2)
            .expect("较早位置不应破坏已有锚点");
        room_id
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验阅读锚点");
    let stored_position: i64 = sqlx::query_scalar(
        "SELECT rra.last_read_event_position \
         FROM room_read_anchors rra \
         JOIN rooms r ON r.id = rra.room_id \
         WHERE r.room_id = $1",
    )
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询到阅读位置");

    assert_eq!(stored_position, 5, "较早写入不应把阅读锚点回退");
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 阅读推进成功后下一次进房会按新锚点恢复() {
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
    let code = format!("U{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-http-device-{uniq}");
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
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-http-c-{index}"),
                &format!("read-http-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 3
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(3));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(4));
}

#[tokio::test]
#[serial]
async fn 阅读推进不能回退到更早位置() {
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
    let code = format!("V{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-regress-device-{uniq}");
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
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-regress-c-{index}"),
                &format!("regress-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (first_status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 5
        })),
        &[],
    )
    .await;
    assert_eq!(first_status, StatusCode::OK);

    let (second_status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 2
        })),
        &[],
    )
    .await;
    assert_eq!(second_status, StatusCode::OK);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(5));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(6));
}

#[tokio::test]
#[serial]
async fn 非成员阅读推进会被拒绝() {
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
    let code = format!("W{:011}", uniq % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-stranger-{uniq}")})),
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
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": stranger_session_id,
            "last_read_event_position": 0
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[tokio::test]
#[serial]
async fn 阅读推进缺少last_read_event_position会返回invalid_argument() {
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
    let code = format!("WM{:010}", uniq % 10_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-missing-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

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
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": owner_session_id
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
}

#[tokio::test]
#[serial]
async fn 阅读推进失败不会影响房间快照和历史查询可用性() {
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
    let code = format!("X{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-failure-device-{uniq}");
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
        for index in 0..3 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-failure-c-{index}"),
                &format!("read-anchor-failure-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 99
        })),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));

    let (snapshot_status, snapshot_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(snapshot_status, StatusCode::OK);
    assert_eq!(snapshot_body["room_id"].as_str(), Some(room_id.as_str()));

    let (history_status, history_body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=3&limit=2"
        ),
        None,
        &[],
    )
    .await;
    assert_eq!(history_status, StatusCode::OK);
    assert!(history_body["messages"].as_array().is_some());
}

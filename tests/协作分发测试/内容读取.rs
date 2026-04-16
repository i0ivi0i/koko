use super::*;
use object_store::{path::Path as ObjectPath, ObjectStoreExt};

/// 内容读取测试只守受控媒体读路径：
/// 1. original 变体仍要支持标准 HTTP range；
/// 2. 视频 original 现在读的是 mezzanine，但仍必须返回真实可续传字节。
async fn 写入测试对象(state: &koko::shell::应用状态, 存储键: &str, 字节: Vec<u8>) {
    state
        .attachment_store
        .put(&ObjectPath::from(存储键), 字节.into())
        .await
        .expect("应能写入测试对象");
}

#[tokio::test]
#[serial]
async fn 原图内容接口支持标准range读取() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let tus_upload_dir = state.tus_upload_dir.clone();
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("range-original-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let room_code = format!("RG{:010}", uniq % 10_000_000_000);
    let database_url = cfg.database_url.clone();
    let room_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &room_code).expect("应能进房");
        match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        }
    })
    .await
    .expect("阻塞建房任务应完成");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id"),
            "file_name": "range-original.mp4",
            "mime_type": "video/mp4",
            "byte_size": 最小mp4字节().len()
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
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "range-original.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 tus 临时视频文件");
    let upload_id = format!("upload-range-original-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "range-original.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
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
        Some(serde_json::json!({
            "session_id": bootstrap["session_id"].as_str().expect("session_id")
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");

    let session_id_for_message = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let attachment_id_for_message = attachment_id.clone();
    let database_url = cfg.database_url.clone();
    tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &session_id_for_message,
            &format!("range-original-message-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带视频附件的消息");
    })
    .await
    .expect("阻塞写消息任务应完成");

    let (status, headers, body) = send_bytes(
        app,
        Method::GET,
        &format!(
            "/api/attachments/{attachment_id}/content?session_id={}&variant=original",
            bootstrap["session_id"].as_str().expect("session_id")
        ),
        &[("range", "bytes=0-63")],
    )
    .await;

    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        headers
            .get(header::ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok()),
        Some("bytes")
    );
    let content_range = headers
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .expect("Range 响应必须带 Content-Range");
    assert!(
        content_range.starts_with("bytes 0-63/"),
        "视频 original range 现在读到的是 mezzanine，不能再假定总长度仍等于原始上传字节"
    );
    assert_eq!(body.len(), 64);
    assert!(
        !body.is_empty(),
        "视频 mezzanine 的 range 读取必须返回真实字节，而不是空响应"
    );
}

#[tokio::test]
#[serial]
async fn 流媒体清单删除后hls和dash受控内容读取会返回not_found() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("streaming-deleted-read-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-streaming-read-deleted-{uniq}");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    插入流媒体清单元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_streaming_manifests
         SET streaming_expires_at = NOW() - INTERVAL '25 hours',
             streaming_deleted_at = NOW() - INTERVAL '1 minute'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把 streaming_deleted_at 写成已退场");
    pool.close().await;

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

    let (hls_status, hls_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/media/{attachment_id}/stream/hls/master.m3u8?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(hls_status, StatusCode::NOT_FOUND, "{hls_body:?}");
    assert_eq!(hls_body["code"].as_str(), Some("attachment_not_ready"));

    let (dash_status, dash_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/stream/dash/stream.mpd?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(dash_status, StatusCode::NOT_FOUND, "{dash_body:?}");
    assert_eq!(dash_body["code"].as_str(), Some("attachment_not_ready"));
}

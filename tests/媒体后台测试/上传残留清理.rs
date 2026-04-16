use super::*;

/// 上传残留清理 owner：
/// 这里只验证后台维护逻辑如何处理已结束 / 已过期 / 历史异常 locator 的上传残留。
/// 它不负责上传 prepare/complete 主链，也不负责协作分发读侧契约。
#[tokio::test]
#[serial]
async fn 后台会清理final完成后遗留的partial临时文件() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("cleanup-finalized-partials-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "cleanup-finalized.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id")
        .to_string();
    let authorization = 提取媒体上传授权头(&prepare_body);

    let partial_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "cleanup-finalized.part",
        &[1, 2, 3, 4],
    )
    .expect("应能写入 partial 文件");
    let final_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "cleanup-finalized.png",
        &最小png字节(),
    )
    .expect("应能写入 final 文件");

    let (partial_status, partial_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("cleanup-partial-{attachment_id}"),
            &attachment_id,
            &upload_session_id,
            "cleanup-finalized.png",
            "image/png",
            34,
            34,
            Some(partial_file.as_str()),
            true,
            false,
            None,
        )),
        &[],
    )
    .await;
    断言TusHook已接受(partial_status, &partial_body);

    let (final_status, final_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &format!("cleanup-final-{attachment_id}"),
            &attachment_id,
            &upload_session_id,
            "cleanup-finalized.png",
            "image/png",
            68,
            68,
            Some(final_file.as_str()),
            false,
            true,
            Some(vec![
                "http://127.0.0.1:7070/files/part-1",
                "http://127.0.0.1:7070/files/part-2",
            ]),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(final_status, &final_body);

    koko::shell::执行一次媒体上传残留清理(state.clone())
        .await
        .expect("应能执行一次上传残留清理");

    assert!(
        !std::path::Path::new(partial_file.as_str()).exists(),
        "final 已经落成后，后台应清掉 partial 临时文件，避免分片残留越积越多"
    );
    assert!(
        std::path::Path::new(final_file.as_str()).exists(),
        "final 临时文件仍然要留给 complete 主链消费，不能被后台残留清理误删"
    );
}

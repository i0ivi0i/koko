use super::*;

#[tokio::test]
#[serial]
async fn 内部tus_hook入口应使用协议命名而不是供应商命名() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    /*
     * 这条红测只锁切换 cut line：
     * - 新协议入口必须是 /internal/tus/hooks；
     * - 旧 vendor 路由后面会整体退场；
     * - 这里先不要求完整业务成功，只要求新入口真实存在。
     */
    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "pre-create",
            Some("Bearer not-a-real-token"),
            "upload-invalid-token",
            "att-invalid-token",
            "invalid.png",
            "image/png",
            68,
            0,
            None,
        )),
        &[],
    )
    .await;

    assert_ne!(status, StatusCode::NOT_FOUND, "{body:?}");
}
#[tokio::test]
#[serial]
async fn tus_pre_create非法token会被拒绝() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "pre-create",
            Some("Bearer not-a-real-token"),
            "upload-invalid-token",
            "att-invalid-token",
            "invalid.png",
            "image/png",
            68,
            0,
            None,
        )),
        &[],
    )
    .await;

    断言TusHook拒绝上传(
        status,
        &body,
        StatusCode::UNAUTHORIZED,
        "attachment_upload_unauthorized",
    );
}
#[tokio::test]
#[serial]
async fn tus_pre_create允许offset为0且length等于metadata_byte_size() {
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
        Some(serde_json::json!({
            "device_anonymous_token": format!("tus-pre-create-{uniq}")
        })),
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
            "file_name": "pre-create.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let authorization = 提取媒体上传授权头(&prepare_body);

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "pre-create",
            Some(authorization.as_str()),
            &format!("upload-pre-create-{attachment_id}"),
            attachment_id,
            "pre-create.png",
            "image/png",
            68,
            0,
            None,
        )),
        &[],
    )
    .await;

    断言TusHook已接受(status, &body);
}
#[tokio::test]
#[serial]
async fn tus_pre_create缺少byte_size元数据时仍按prepare权威长度放行() {
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
        Some(serde_json::json!({
            "device_anonymous_token": format!("tus-pre-create-metadata-{uniq}")
        })),
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
            "file_name": "pre-create-metadata.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let mut hook_body = 构造tus_hook请求体(
        "pre-create",
        Some(authorization.as_str()),
        &format!("upload-pre-create-metadata-{attachment_id}"),
        attachment_id,
        "pre-create-metadata.png",
        "image/png",
        68,
        0,
        None,
    );
    /*
     * 真实 Tus create-upload 场景里，hook 不保证把每个 metadata 键都稳定回显给主服务。
     * 这里故意只保留 attachment_id，锁住“pre-create 应依赖 prepare 权威长度，而不是重复 metadata.byte_size”。
     */
    hook_body["Event"]["Upload"]["MetaData"] = serde_json::json!({
        "attachment_id": attachment_id
    });

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(hook_body),
        &[],
    )
    .await;

    断言TusHook已接受(status, &body);
}
#[tokio::test]
#[serial]
async fn tus_pre_create长度小于prepare整文件大小时会拒绝当前partial_upload语义() {
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
        Some(serde_json::json!({
            "device_anonymous_token": format!("tus-pre-create-partial-{uniq}")
        })),
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
            "file_name": "pre-create-partial.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let authorization = 提取媒体上传授权头(&prepare_body);

    /*
     * 当前主链仍以“单附件 = 一条最终运输回执”为真相：
     * - pre-create 里的 length 必须就是 prepare 时登记的整文件大小；
     * - 这条测试专门防止前端再次偷偷打开 partial upload / concatenation，
     *   却忘了同时升级 Tus hook 与 complete 契约。
     */
    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "pre-create",
            Some(authorization.as_str()),
            &format!("upload-pre-create-partial-{attachment_id}"),
            attachment_id,
            "pre-create-partial.png",
            "image/png",
            34,
            0,
            None,
        )),
        &[],
    )
    .await;

    断言TusHook拒绝上传(status, &body, StatusCode::BAD_REQUEST, "invalid_argument");
    let inner = serde_json::from_str::<serde_json::Value>(
        body["HTTPResponse"]["Body"]
            .as_str()
            .expect("拒绝上传必须带回客户端错误体"),
    )
    .expect("拒绝上传的 HTTPResponse.Body 必须是 JSON");
    assert_eq!(
        inner["message"].as_str(),
        Some("上传文件大小与 prepare 不一致")
    );
}
#[tokio::test]
#[serial]
async fn tus_pre_create_partial在同会话下未来应当放行但当前还做不到() {
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
        Some(serde_json::json!({
            "device_anonymous_token": format!("tus-pre-create-partial-session-{uniq}")
        })),
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
            "file_name": "future-partial.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id");
    let authorization = 提取媒体上传授权头(&prepare_body);

    /*
     * 这条红测锁的是未来真正要打通的语义：
     * - partial upload 只要和 prepare 返回的 upload_session_id 对上，
     *   就应该允许在 pre-create 进入传输层；
     * - 当前实现还只有 attachment_id -> 单运输回执，所以这里会先失败。
     */
    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(serde_json::json!({
            "Type": "pre-create",
            "Event": {
                "Upload": {
                    "ID": serde_json::Value::Null,
                    "Size": 34,
                    "SizeIsDeferred": false,
                    "Offset": 0,
                    "MetaData": {
                        "attachment_id": attachment_id,
                        "upload_session_id": upload_session_id,
                        "file_name": "future-partial.png",
                        "mime_type": "image/png",
                        "byte_size": "68"
                    },
                    "IsPartial": true,
                    "IsFinal": false,
                    "PartialUploads": serde_json::Value::Null,
                    "Storage": serde_json::Value::Null
                },
                "HTTPRequest": {
                    "Method": "POST",
                    "URI": "/files",
                    "Header": {
                        "Authorization": [authorization.as_str()]
                    }
                }
            }
        })),
        &[],
    )
    .await;

    断言TusHook已接受(status, &body);
}
#[tokio::test]
#[serial]
async fn tus_pre_create_final_concat在同会话下会放行() {
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
        Some(serde_json::json!({
            "device_anonymous_token": format!("tus-pre-create-final-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "future-final.mp4",
            "mime_type": "video/mp4",
            "byte_size": 96
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id");
    let upload_session_id = prepare_body["upload_session_id"]
        .as_str()
        .expect("upload_session_id");
    let authorization = 提取媒体上传授权头(&prepare_body);

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_concatenation_hook请求体(
            "pre-create",
            Some(authorization.as_str()),
            &format!("final-upload-{attachment_id}"),
            attachment_id,
            upload_session_id,
            "future-final.mp4",
            "video/mp4",
            96,
            0,
            None,
            false,
            true,
            Some(vec![
                "http://127.0.0.1:7070/files/partial-1",
                "http://127.0.0.1:7070/files/partial-2",
            ]),
        )),
        &[],
    )
    .await;

    断言TusHook已接受(status, &body);
}

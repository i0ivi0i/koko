use super::*;

/// 分发元数据测试只守写侧事实：
/// 1. ready 附件落库后必须生成稳定的 content_id / content_hash / swarm_id；
/// 2. 相同内容的不同附件可以共享同一 swarm_id，不能被错误唯一约束卡死。
#[tokio::test]
#[serial]
async fn ready附件会落协作分发元数据() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("distribution-ready-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
    let image_bytes = 最小webp字节();
    let image_byte_size = image_bytes.len() as i64;

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "canonical.webp",
            "mime_type": "image/webp",
            "byte_size": image_byte_size
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
        &state.tus_upload_dir,
        &attachment_id,
        "canonical.webp",
        &image_bytes,
    )
    .expect("应能写入 tus 临时图片文件");
    let upload_id = format!("upload-distribution-ready-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/tus/hooks",
        Some(构造tus_hook请求体(
            "post-finish",
            Some(authorization.as_str()),
            &upload_id,
            &attachment_id,
            "canonical.webp",
            "image/webp",
            image_byte_size,
            image_byte_size,
            Some(temp_file.as_str()),
        )),
        &[],
    )
    .await;
    断言TusHook已接受(hook_status, &hook_body);

    let (complete_status, complete_body) = send_json(
        app,
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": session_id
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK, "{complete_body:?}");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验协作分发元数据");
    let row = sqlx::query(
        "SELECT content_id, content_hash, swarm_id, \
                EXTRACT(EPOCH FROM web_seed_until)::BIGINT AS web_seed_until_epoch \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("ready 后应存在协作分发元数据");

    let content_id: String = row.get("content_id");
    let content_hash: String = row.get("content_hash");
    let swarm_id: String = row.get("swarm_id");
    let web_seed_until_epoch: i64 = row.get("web_seed_until_epoch");

    assert_eq!(content_id, format!("content_{attachment_id}"));
    assert_eq!(swarm_id, format!("swarm_{content_hash}"));
    assert_eq!(content_hash.len(), 64, "SHA-256 十六进制摘要长度应为 64");
    assert!(
        web_seed_until_epoch
            > SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_secs() as i64,
        "24 小时保底窗口至少应落到未来时刻"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 相同内容的不同附件可以共享同一swarm_id() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let device_token = format!("distribution-share-device-{uniq}");
    let attachment_id_first = format!("att-share-first-{uniq}");
    let attachment_id_second = format!("att-share-second-{uniq}");
    let database_url = cfg.database_url.clone();
    let session_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::application::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入 ready 附件");
    插入ready图片附件记录(&pool, &session_id, &attachment_id_first).await;
    插入ready图片附件记录(&pool, &session_id, &attachment_id_second).await;
    pool.close().await;

    let shared_hash = format!("{uniq:016x}{uniq:016x}{uniq:016x}{uniq:016x}");
    let shared_swarm_id = format!("swarm_{shared_hash}");
    let database_url = cfg.database_url.clone();
    let attachment_id_first_for_worker = attachment_id_first.clone();
    let attachment_id_second_for_worker = attachment_id_second.clone();
    let shared_swarm_id_for_worker = shared_swarm_id.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let first = koko::application::写入协作分发元数据(
            &mut repo,
            &koko::application::协作分发元数据写入请求 {
                附件标识: attachment_id_first_for_worker.clone(),
                content_id: format!("content_{attachment_id_first_for_worker}"),
                content_hash: shared_hash.to_string(),
                swarm_id: shared_swarm_id_for_worker.clone(),
                web_seed_until秒: 1_775_942_400,
            },
        );
        let second = koko::application::写入协作分发元数据(
            &mut repo,
            &koko::application::协作分发元数据写入请求 {
                附件标识: attachment_id_second_for_worker.clone(),
                content_id: format!("content_{attachment_id_second_for_worker}"),
                content_hash: shared_hash.to_string(),
                swarm_id: shared_swarm_id_for_worker.clone(),
                web_seed_until秒: 1_775_942_500,
            },
        );
        (first, second)
    })
    .await
    .expect("阻塞写入任务应完成");

    assert!(result.0.is_ok(), "第一条相同内容附件应能落协作分发元数据");
    assert!(
        result.1.is_ok(),
        "第二条相同内容附件不应因为相同 swarm_id 被唯一索引卡死"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验共享 swarm_id");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM attachment_distribution_metadata WHERE swarm_id = $1",
    )
    .bind(&shared_swarm_id)
    .fetch_one(&pool)
    .await
    .expect("应能统计共享 swarm_id 的记录数");
    assert_eq!(count, 2, "同一内容的不同附件应该都能挂到同一个 swarm_id 下");
    pool.close().await;
}

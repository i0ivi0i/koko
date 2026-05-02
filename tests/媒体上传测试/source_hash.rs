use super::*;

const SOURCE_HASH_一号: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const SOURCE_HASH_二号: &str = "2222222222222222222222222222222222222222222222222222222222222222";

async fn 启动会话并进房(
    app: axum::Router,
    device_token: String,
    room_code: String,
) -> (String, String) {
    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": device_token})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (join_status, join) = send_json(
        app,
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_code": room_code,
        })),
        &[],
    )
    .await;
    assert_eq!(join_status, StatusCode::OK, "进房失败: {join:?}");
    (
        session_id.to_string(),
        join["room_id"].as_str().expect("room_id").to_string(),
    )
}

async fn 既有会话进房(app: axum::Router, session_id: &str, room_code: String) -> String {
    let (join_status, join) = send_json(
        app,
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_code": room_code,
        })),
        &[],
    )
    .await;
    assert_eq!(join_status, StatusCode::OK, "既有会话进房失败: {join:?}");
    join["room_id"].as_str().expect("room_id").to_string()
}

async fn 上传带source_hash的最小图片(
    app: axum::Router,
    tus_upload_dir: String,
    session_id: &str,
    source_hash: &str,
    source_file_name: &str,
    uniq: u128,
) -> String {
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
            "byte_size": image_byte_size,
            "source_hash": source_hash,
            "source_byte_size": image_byte_size,
            "source_file_name": source_file_name,
        })),
        &[],
    )
    .await;
    assert_eq!(
        prepare_status,
        StatusCode::OK,
        "prepare 失败: {prepare_body:?}"
    );
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();

    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-source-hash-{uniq}-{attachment_id}");
    let temp_file = 写入tus测试文件(
        &tus_upload_dir,
        &attachment_id,
        "canonical.webp",
        &image_bytes,
    )
    .expect("应能写入 source_hash 图片上传临时文件");
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
        Some(serde_json::json!({ "session_id": session_id })),
        &[],
    )
    .await;
    assert_eq!(
        complete_status,
        StatusCode::OK,
        "complete 失败: {complete_body:?}"
    );
    attachment_id
}

async fn 用附件创建房间消息(
    database_url: String,
    room_id: String,
    session_id: String,
    attachment_id: String,
    client_message_id: String,
) {
    tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::message::application::创建消息(
            &mut repo,
            &room_id,
            &session_id,
            &client_message_id,
            "",
            &[attachment_id],
        )
        .expect("source_hash 测试前置消息应能成立");
    })
    .await
    .expect("创建附件消息任务应完成");
}

async fn 构建source_hash测试应用() -> (String, koko::shell::应用状态, axum::Router) {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平 source_hash 迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    (cfg.database_url, state, app)
}

#[tokio::test]
#[serial]
async fn 同一身份跨房间同source_hash会复用全局canonical资产但创建目标房间新附件事实() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let (session_id, room_a) = 启动会话并进房(
        app.clone(),
        format!("source-cross-owner-{uniq}"),
        format!("XA{:010}", uniq % 10_000_000_000),
    )
    .await;
    let room_b = 既有会话进房(
        app.clone(),
        &session_id,
        format!("XB{:010}", uniq % 10_000_000_000),
    )
    .await;

    let original_attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_id,
        SOURCE_HASH_一号,
        "same-source-cross-room.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        room_a,
        session_id.clone(),
        original_attachment_id.clone(),
        format!("source-cross-original-{uniq}"),
    )
    .await;

    let (reuse_status, reuse_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/source-dedupe",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_id": room_b,
            "source_hash": SOURCE_HASH_一号,
            "source_byte_size": 最小webp字节().len() as i64,
            "source_file_name": "same-source-cross-room.webp",
        })),
        &[],
    )
    .await;
    assert_eq!(
        reuse_status,
        StatusCode::OK,
        "source-dedupe 响应: {reuse_body:?}"
    );
    assert_eq!(reuse_body["status"].as_str(), Some("reused"));
    let reused_attachment_id = reuse_body["attachment"]["attachment_id"]
        .as_str()
        .expect("复用命中必须创建新附件")
        .to_string();
    assert_ne!(
        original_attachment_id, reused_attachment_id,
        "跨房间 source_hash 命中只能新增目标房间附件引用，不能复用旧附件事实"
    );

    let asset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT acar.content_hash)
           FROM attachment_canonical_asset_refs acar
          WHERE acar.attachment_id = ANY($1)",
    )
    .bind(vec![original_attachment_id, reused_attachment_id])
    .fetch_one(&pool)
    .await
    .expect("应能统计两个附件绑定的 canonical 资产");
    assert_eq!(
        asset_count, 1,
        "跨房间复用只能新增附件引用，不能新增物理资产"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn source_hash复用附件允许业务content_id不同但分发身份必须完全一致() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("SH{:010}", uniq % 10_000_000_000);
    let (session_id, room_id) =
        启动会话并进房(app.clone(), format!("source-hash-a-{uniq}"), room_code).await;

    let original_attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_id,
        SOURCE_HASH_一号,
        "same-source.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        room_id.clone(),
        session_id.clone(),
        original_attachment_id.clone(),
        format!("source-hash-original-{uniq}"),
    )
    .await;

    let (reuse_status, reuse_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/source-dedupe",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_id": room_id,
            "source_hash": SOURCE_HASH_一号,
            "source_byte_size": 最小webp字节().len() as i64,
            "source_file_name": "same-source.webp",
        })),
        &[],
    )
    .await;
    assert_eq!(
        reuse_status,
        StatusCode::OK,
        "source-dedupe 响应: {reuse_body:?}"
    );
    assert_eq!(reuse_body["status"].as_str(), Some("reused"));
    let reused_attachment_id = reuse_body["attachment"]["attachment_id"]
        .as_str()
        .expect("复用命中必须返回新附件")
        .to_string();
    assert_ne!(
        original_attachment_id, reused_attachment_id,
        "source_hash 命中只能复用媒体资产，不能复用旧附件事实"
    );

    let rows = sqlx::query(
        "SELECT
            a.attachment_id,
            a.status,
            ash.source_hash,
            adm.content_id AS distribution_content_id,
            acar.content_hash AS asset_content_hash,
            adm.content_hash AS distribution_content_hash,
            adm.swarm_id,
            adm.torrent_info_hash
         FROM attachments a
         JOIN attachment_source_hashes ash ON ash.attachment_id = a.attachment_id
         JOIN attachment_canonical_asset_refs acar ON acar.attachment_id = a.attachment_id
         JOIN attachment_distribution_metadata adm ON adm.attachment_id = a.attachment_id
         WHERE a.attachment_id = ANY($1)
         ORDER BY a.attachment_id",
    )
    .bind(vec![
        original_attachment_id.clone(),
        reused_attachment_id.clone(),
    ])
    .fetch_all(&pool)
    .await
    .expect("应能读到 source_hash 复用后的两条附件真相");
    assert_eq!(rows.len(), 2);
    let first_asset_hash: String = rows[0].get("asset_content_hash");
    let first_distribution_hash: String = rows[0].get("distribution_content_hash");
    let first_swarm_id: String = rows[0].get("swarm_id");
    let first_torrent_info_hash: Option<String> = rows[0].get("torrent_info_hash");
    let mut content_ids = Vec::new();
    for row in &rows {
        let status: String = row.get("status");
        let source_hash: String = row.get("source_hash");
        let content_id: String = row.get("distribution_content_id");
        let asset_hash: String = row.get("asset_content_hash");
        let distribution_hash: String = row.get("distribution_content_hash");
        let swarm_id: String = row.get("swarm_id");
        let torrent_info_hash: Option<String> = row.get("torrent_info_hash");
        assert_eq!(status, "ready");
        assert_eq!(source_hash, SOURCE_HASH_一号);
        content_ids.push(content_id);
        assert_eq!(asset_hash, first_asset_hash);
        assert_eq!(distribution_hash, first_distribution_hash);
        assert_eq!(swarm_id, first_swarm_id);
        assert_eq!(torrent_info_hash, first_torrent_info_hash);
    }
    assert_ne!(
        content_ids[0], content_ids[1],
        "content_id 是附件级业务引用，可以随新附件变化；分发身份只能看 content_hash / swarm_id / torrent_info_hash"
    );

    用附件创建房间消息(
        database_url.clone(),
        room_id,
        session_id,
        reused_attachment_id,
        format!("source-hash-reused-{uniq}"),
    )
    .await;
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 不同身份不可见房间source_hash只能miss但相同canonical上传后只保留一份物理资产() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let (session_a, room_a) = 启动会话并进房(
        app.clone(),
        format!("source-hidden-a-{uniq}"),
        format!("HA{:010}", uniq % 10_000_000_000),
    )
    .await;
    let (session_b, room_b) = 启动会话并进房(
        app.clone(),
        format!("source-hidden-b-{uniq}"),
        format!("HB{:010}", uniq % 10_000_000_000),
    )
    .await;

    let attachment_a = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_a,
        SOURCE_HASH_二号,
        "same-canonical-a.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        room_a,
        session_a,
        attachment_a.clone(),
        format!("source-hidden-a-{uniq}"),
    )
    .await;

    let (reuse_status, reuse_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/source-dedupe",
        Some(serde_json::json!({
            "session_id": session_b,
            "room_id": room_b,
            "source_hash": SOURCE_HASH_二号,
            "source_byte_size": 最小webp字节().len() as i64,
            "source_file_name": "same-canonical-b.webp",
        })),
        &[],
    )
    .await;
    assert_eq!(
        reuse_status,
        StatusCode::OK,
        "source-dedupe 响应: {reuse_body:?}"
    );
    assert_eq!(reuse_body["status"].as_str(), Some("miss"));
    assert!(
        reuse_body.get("attachment").is_none(),
        "不可见范围 miss 不能泄漏旧附件或资产线索"
    );

    let attachment_b = 上传带source_hash的最小图片(
        app,
        state.tus_upload_dir.clone(),
        &session_b,
        SOURCE_HASH_二号,
        "same-canonical-b.webp",
        uniq + 1,
    )
    .await;
    let distinct_asset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT content_hash)
           FROM attachment_canonical_asset_refs
          WHERE attachment_id = ANY($1)",
    )
    .bind(vec![attachment_a, attachment_b])
    .fetch_one(&pool)
    .await
    .expect("应能统计两个附件的 canonical 资产");
    assert_eq!(
        distinct_asset_count, 1,
        "互不可见身份只能禁止 source_hash 探测，不能阻止 content_hash 物理去重"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 可见媒体附件转发到目标房间时只新增消息和附件引用不重建物理资产() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let (session_id, source_room) = 启动会话并进房(
        app.clone(),
        format!("forward-owner-{uniq}"),
        format!("FA{:010}", uniq % 10_000_000_000),
    )
    .await;
    let target_room = 既有会话进房(
        app.clone(),
        &session_id,
        format!("FB{:010}", uniq % 10_000_000_000),
    )
    .await;

    let source_attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_id,
        SOURCE_HASH_一号,
        "forward-source.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        source_room,
        session_id.clone(),
        source_attachment_id.clone(),
        format!("forward-source-message-{uniq}"),
    )
    .await;

    let (forward_status, forward_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/forward",
        Some(serde_json::json!({
            "session_id": session_id,
            "target_room_id": target_room,
            "source_attachment_id": source_attachment_id.clone(),
            "client_message_id": format!("forward-target-message-{uniq}"),
            "text": "转发",
        })),
        &[],
    )
    .await;
    assert_eq!(forward_status, StatusCode::OK, "转发响应: {forward_body:?}");
    let forwarded_attachment_id = forward_body["message"]["attachments"][0]["attachment_id"]
        .as_str()
        .expect("转发必须返回目标房间的新附件")
        .to_string();
    assert_ne!(
        source_attachment_id, forwarded_attachment_id,
        "转发只能新增当前房间附件引用，不能复用源附件事实"
    );

    let distinct_asset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT content_hash)
           FROM attachment_canonical_asset_refs
          WHERE attachment_id = ANY($1)",
    )
    .bind(vec![source_attachment_id, forwarded_attachment_id])
    .fetch_one(&pool)
    .await
    .expect("应能统计转发前后的 canonical 资产");
    assert_eq!(
        distinct_asset_count, 1,
        "转发必须复用同一全局 canonical 资产，不能重建物理资产"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 不可见源附件不能被转发也不能泄漏旧附件线索() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let (session_a, room_a) = 启动会话并进房(
        app.clone(),
        format!("forward-hidden-a-{uniq}"),
        format!("GA{:010}", uniq % 10_000_000_000),
    )
    .await;
    let (session_b, room_b) = 启动会话并进房(
        app.clone(),
        format!("forward-hidden-b-{uniq}"),
        format!("GB{:010}", uniq % 10_000_000_000),
    )
    .await;

    let source_attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_a,
        SOURCE_HASH_二号,
        "forward-hidden-source.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url,
        room_a,
        session_a,
        source_attachment_id.clone(),
        format!("forward-hidden-source-message-{uniq}"),
    )
    .await;

    let (forward_status, forward_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/forward",
        Some(serde_json::json!({
            "session_id": session_b,
            "target_room_id": room_b,
            "source_attachment_id": source_attachment_id,
            "client_message_id": format!("forward-hidden-target-message-{uniq}"),
            "text": "转发",
        })),
        &[],
    )
    .await;
    assert_ne!(
        forward_status,
        StatusCode::OK,
        "不可见源附件不能被成功转发: {forward_body:?}"
    );
    let body_text = forward_body.to_string();
    for leaked_key in [
        "content_hash",
        "swarm_id",
        "source_room_id",
        "source_message_id",
        "owner",
    ] {
        assert!(
            !body_text.contains(leaked_key),
            "不可见源附件失败响应不能泄漏 {leaked_key}: {body_text}"
        );
    }
}

#[tokio::test]
#[serial]
async fn 未授权房间不能通过source_hash探测已有媒体() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code_a = format!("SA{:010}", uniq % 10_000_000_000);
    let room_code_b = format!("SB{:010}", uniq % 10_000_000_000);
    let (session_a, room_a) = 启动会话并进房(
        app.clone(),
        format!("source-hash-owner-{uniq}"),
        room_code_a,
    )
    .await;
    let (session_b, room_b) = 启动会话并进房(
        app.clone(),
        format!("source-hash-other-{uniq}"),
        room_code_b,
    )
    .await;

    let attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_a,
        SOURCE_HASH_二号,
        "private-source.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        room_a,
        session_a,
        attachment_id,
        format!("source-hash-private-{uniq}"),
    )
    .await;

    let (reuse_status, reuse_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/source-dedupe",
        Some(serde_json::json!({
            "session_id": session_b,
            "room_id": room_b,
            "source_hash": SOURCE_HASH_二号,
            "source_byte_size": 最小webp字节().len() as i64,
            "source_file_name": "private-source.webp",
        })),
        &[],
    )
    .await;
    assert_eq!(
        reuse_status,
        StatusCode::OK,
        "source-dedupe 响应: {reuse_body:?}"
    );
    assert_eq!(reuse_body["status"].as_str(), Some("miss"));
    assert!(
        reuse_body.get("attachment").is_none(),
        "未授权范围 miss 不能返回旧附件、旧房间或旧上传者线索"
    );
}

#[tokio::test]
#[serial]
async fn canonical资产删除后source_hash不会复活ready附件() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("SD{:010}", uniq % 10_000_000_000);
    let (session_id, room_id) = 启动会话并进房(
        app.clone(),
        format!("source-hash-deleted-{uniq}"),
        room_code,
    )
    .await;

    let attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_id,
        SOURCE_HASH_一号,
        "deleted-source.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        room_id.clone(),
        session_id.clone(),
        attachment_id.clone(),
        format!("source-hash-deleted-original-{uniq}"),
    )
    .await;

    sqlx::query(
        "UPDATE canonical_media_assets
            SET origin_deleted_at = NOW()
          WHERE content_hash = (
              SELECT content_hash
                FROM attachment_canonical_asset_refs
               WHERE attachment_id = $1
          )",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能标记 canonical 资产删除");
    sqlx::query(
        "UPDATE attachments
            SET origin_deleted_at = NOW()
          WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能标记引用附件冷源删除");

    let ready_count_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE status = 'ready'")
            .fetch_one(&pool)
            .await
            .expect("应能统计 ready 附件");
    let (reuse_status, reuse_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/source-dedupe",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_id": room_id,
            "source_hash": SOURCE_HASH_一号,
            "source_byte_size": 最小webp字节().len() as i64,
            "source_file_name": "deleted-source.webp",
        })),
        &[],
    )
    .await;
    assert_eq!(
        reuse_status,
        StatusCode::OK,
        "source-dedupe 响应: {reuse_body:?}"
    );
    assert_eq!(reuse_body["status"].as_str(), Some("miss"));
    let ready_count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE status = 'ready'")
            .fetch_one(&pool)
            .await
            .expect("应能再次统计 ready 附件");
    assert_eq!(
        ready_count_after, ready_count_before,
        "已删除 canonical 资产不能通过 source_hash 重新制造 ready 附件"
    );
    pool.close().await;
}

use super::*;

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

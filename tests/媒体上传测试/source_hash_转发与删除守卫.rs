use super::*;

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

use super::*;

/// TDD RED：sidecar 返回 done: false 时，reconcile 不应写 backend_strong_seed presence。
/// 根因：当前 reconcile 把 HTTP 200 当强种子成立——错了。
/// WebTorrent torrent.done 才是"完整 seed"的唯一事实。
#[tokio::test]
#[serial]
async fn 做种对账sidecar返回notready时不写backend_strong_seed_presence() {
    // 使用返回 done: false 的假 seeder
    let (fake_seeder_base_url, seeder_records, fake_seeder_server) =
        启动假notready_seeder控制面().await;
    let backup = 备份并清空环境变量(&[
        "APP_PORT",
        "SWARM_SEEDER_CONTROL_BASE_URL",
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_SEEDER_TRACKER_URL",
        "SWARM_TICKET_SECRET",
    ]);
    env::set_var("APP_PORT", "18080");
    env::set_var(
        "SWARM_SEEDER_CONTROL_BASE_URL",
        fake_seeder_base_url.as_str(),
    );
    env::set_var(
        "SWARM_TRACKER_PUBLIC_URL",
        "wss://im.example.com/api/swarm/announce",
    );
    env::set_var("SWARM_TICKET_SECRET", "notready-ticket-secret");

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
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({
            "device_anonymous_token": format!("seed-notready-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-seed-notready-{uniq}");
    let (torrent_bytes, info_hash, piece_length) =
        构造有效测试torrent元信息(format!("seed-notready-{uniq}").as_str());

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET torrent_info_hash = $2,
             torrent_bytes = $3,
             piece_length_bytes = $4,
             web_seed_until = NOW() + INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .bind(&info_hash)
    .bind(&torrent_bytes)
    .bind(piece_length)
    .execute(&pool)
    .await
    .expect("应能补齐 torrent_info_hash");

    // 执行对账
    koko::shell::协作分发做种::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    // 验证 sidecar 确实收到了 start 请求
    let records = seeder_records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .clone();
    let start_received = records
        .start_payloads
        .iter()
        .any(|payload| payload["infoHash"].as_str() == Some(info_hash.as_str()));
    assert!(
        start_received,
        "sidecar 应收到 start 请求（即使 done: false，start 本身是幂等触发）"
    );

    // 核心断言：sidecar 返回 done: false 时，不应写 backend_strong_seed presence
    let strong_seed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM swarm_peer_presence \
         WHERE attachment_id = $1 AND peer_kind = 'backend_strong_seed'",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 presence");
    assert_eq!(
        strong_seed_count, 0,
        "sidecar 返回 done: false 时，reconcile 不应写 backend_strong_seed presence——\
         只有 WebTorrent torrent.done === true 才是完整 seed 的事实"
    );

    // 清理
    sqlx::query("DELETE FROM swarm_peer_presence WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .expect("应能清理 presence");
    sqlx::query("DELETE FROM attachment_distribution_metadata WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .expect("应能清理协作分发元数据");
    sqlx::query("DELETE FROM attachments WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .expect("应能清理附件记录");
    pool.close().await;

    fake_seeder_server.abort();
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
async fn 做种对账会按权威附件集合触发start并下发reconcile清单() {
    let (fake_seeder_base_url, seeder_records, fake_seeder_server) = 启动假seeder控制面().await;
    let backup = 备份并清空环境变量(&[
        "APP_PORT",
        "SWARM_SEEDER_CONTROL_BASE_URL",
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_SEEDER_TRACKER_URL",
        "SWARM_TICKET_SECRET",
    ]);
    env::set_var("APP_PORT", "18080");
    env::set_var(
        "SWARM_SEEDER_CONTROL_BASE_URL",
        fake_seeder_base_url.as_str(),
    );
    env::set_var(
        "SWARM_TRACKER_PUBLIC_URL",
        "wss://im.example.com/api/swarm/announce",
    );
    env::set_var(
        "SWARM_SEEDER_TRACKER_URL",
        "ws://127.0.0.1:18080/api/swarm/announce",
    );
    env::set_var("SWARM_TICKET_SECRET", "seed-reconcile-ticket-secret");

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
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({
            "device_anonymous_token": format!("seed-reconcile-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-seed-reconcile-{uniq}");
    // 这里显式补齐真实可解析的 torrent 元信息。做种对账面对的是 sidecar 真接口，
    // 测试也必须使用同等级输入，不能再用假 bencode 污染共享开发库。
    let (torrent_bytes, info_hash, piece_length) =
        构造有效测试torrent元信息(format!("seed-reconcile-{uniq}").as_str());

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    // 对账查询按 `web_seed_until ASC LIMIT 256` 取样。
    // 共享测试库里可能残留旧附件；这里把当前样例显式推到“更早过期但仍未过期”的窗口，
    // 避免被历史脏数据挤出本轮对账集合，确保测试验证的是当前附件的权威 infoHash。
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET torrent_info_hash = $2,
             torrent_bytes = $3,
             piece_length_bytes = $4,
             web_seed_until = NOW() + INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .bind(&info_hash)
    .bind(&torrent_bytes)
    .bind(piece_length)
    .execute(&pool)
    .await
    .expect("应能补齐 torrent_info_hash");
    pool.close().await;

    koko::shell::协作分发做种::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    let records = seeder_records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .clone();
    let matched_start_payload = records
        .start_payloads
        .iter()
        .find(|payload| payload["infoHash"].as_str() == Some(info_hash.as_str()));
    assert!(
        matched_start_payload.is_some(),
        "对账触发的 seeder start 集合里必须包含当前测试附件的权威 infoHash"
    );
    let matched_start_payload = matched_start_payload.expect("上面已断言存在匹配 payload");
    // 零延迟做种新字段断言
    assert!(
        matched_start_payload["torrentBytesBase64"]
            .as_str()
            .map(|v| !v.is_empty())
            .unwrap_or(false),
        "做种对账必须下发非空 torrentBytesBase64，避免 sidecar 再走 HTTP 拉 .torrent"
    );
    assert_eq!(
        matched_start_payload["localSeed"]["strategy"].as_str(),
        Some("hardlink"),
        "本地存储模式下做种对账必须下发 localSeed hardlink 提示"
    );
    assert!(
        matched_start_payload["localSeed"]["canonicalFilePath"]
            .as_str()
            .map(|v| !v.is_empty())
            .unwrap_or(false),
        "localSeed 必须包含 canonicalFilePath"
    );
    assert!(
        matched_start_payload["localSeed"]["torrentFileName"]
            .as_str()
            .map(|v| v.starts_with("content-"))
            .unwrap_or(false),
        "localSeed.torrentFileName 必须以 content- 开头"
    );
    assert_eq!(
        matched_start_payload["announceUrls"]
            .as_array()
            .and_then(|values| values.first())
            .and_then(|value| value.as_str()),
        Some("ws://127.0.0.1:18080/api/swarm/announce"),
        "后台做种对账必须走后端同源认证入口，禁止直连裸 tracker 绕过 join_ticket 门禁"
    );
    assert!(
        matched_start_payload["joinTicket"]
            .as_str()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        "后台做种对账触发 sidecar start 时必须携带非空 joinTicket，避免无票 announce"
    );
    assert!(
        matched_start_payload["torrentUrl"]
            .as_str()
            .map(|value| value.starts_with("http://") || value.starts_with("https://"))
            .unwrap_or(false),
        "对账触发的 torrentUrl 必须是绝对 URL，避免 sidecar 继续报 Invalid torrent identifier"
    );
    assert!(
        matched_start_payload["webSeedUrl"]
            .as_str()
            .map(|value| value.starts_with("http://") || value.starts_with("https://"))
            .unwrap_or(false),
        "对账触发的 webSeedUrl 必须是绝对 URL，避免 sidecar 对相对地址解释不一致"
    );
    assert!(!records.reconcile_payloads.is_empty(), "对账应至少下发一次 reconcile 清单");
    let reconcile_contains_target = records.reconcile_payloads.iter().any(|payload| {
        payload["activeInfoHashes"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .any(|value| value.as_str() == Some(info_hash.as_str()))
            })
            .unwrap_or(false)
    });
    assert!(
        reconcile_contains_target,
        "reconcile 清单必须包含当前仍处于强 seed 窗口的测试附件 infoHash"
    );

    let cleanup_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库清理测试附件");
    sqlx::query("DELETE FROM attachment_distribution_metadata WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&cleanup_pool)
        .await
        .expect("应能清理协作分发元数据");
    sqlx::query("DELETE FROM attachments WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&cleanup_pool)
        .await
        .expect("应能清理附件记录");
    cleanup_pool.close().await;

    fake_seeder_server.abort();
    恢复环境变量(backup);
}
#[tokio::test]
#[serial]
async fn 做种对账会跳过缺失torrent元信息的脏附件记录() {
    let (fake_seeder_base_url, seeder_records, fake_seeder_server) = 启动假seeder控制面().await;
    let backup = 备份并清空环境变量(&["SWARM_SEEDER_CONTROL_BASE_URL"]);
    env::set_var(
        "SWARM_SEEDER_CONTROL_BASE_URL",
        fake_seeder_base_url.as_str(),
    );

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
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({
            "device_anonymous_token": format!("seed-reconcile-missing-torrent-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-seed-reconcile-missing-torrent-{uniq}");
    let info_hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    // 这里只补 info_hash，不补 torrent_bytes/piece_length。
    // 预期：做种对账必须把这条记录视为脏数据并跳过，不得继续触发 sidecar start。
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET torrent_info_hash = $2
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .bind(info_hash)
    .execute(&pool)
    .await
    .expect("应能写入只含 info_hash 的脏记录");
    pool.close().await;

    koko::shell::协作分发做种::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    let records = seeder_records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .clone();
    let contains_dirty_info_hash = records
        .start_payloads
        .iter()
        .any(|payload| payload["infoHash"].as_str() == Some(info_hash));
    assert!(
        !contains_dirty_info_hash,
        "缺失 torrent_bytes/piece_length 的脏记录必须被跳过，不能再触发 sidecar start 重试噪音"
    );

    let cleanup_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库清理测试附件");
    sqlx::query("DELETE FROM attachment_distribution_metadata WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&cleanup_pool)
        .await
        .expect("应能清理协作分发元数据");
    sqlx::query("DELETE FROM attachments WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&cleanup_pool)
        .await
        .expect("应能清理附件记录");
    cleanup_pool.close().await;

    fake_seeder_server.abort();
    恢复环境变量(backup);
}
#[tokio::test]
#[serial]
async fn 做种对账会跳过不可解析torrent元信息的脏附件记录() {
    let (fake_seeder_base_url, seeder_records, fake_seeder_server) = 启动假seeder控制面().await;
    let backup = 备份并清空环境变量(&["SWARM_SEEDER_CONTROL_BASE_URL"]);
    env::set_var(
        "SWARM_SEEDER_CONTROL_BASE_URL",
        fake_seeder_base_url.as_str(),
    );

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
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({
            "device_anonymous_token": format!("seed-reconcile-bad-torrent-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-seed-reconcile-bad-torrent-{uniq}");
    let info_hash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let bad_torrent_bytes = vec![0x64_u8, 0x31, 0x3a, 0x61, 0x30, 0x3a, 0x65];

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET torrent_info_hash = $2,
             torrent_bytes = $3,
             piece_length_bytes = $4,
             web_seed_until = NOW() + INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .bind(info_hash)
    .bind(&bad_torrent_bytes)
    .bind(16_384_i32)
    .execute(&pool)
    .await
    .expect("应能写入不可解析 torrent 字节的脏记录");
    pool.close().await;

    koko::shell::协作分发做种::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    let records = seeder_records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .clone();
    let contains_dirty_info_hash = records
        .start_payloads
        .iter()
        .any(|payload| payload["infoHash"].as_str() == Some(info_hash));
    assert!(
        !contains_dirty_info_hash,
        "不可解析 torrent_bytes 的脏记录必须在对账输入侧被跳过，不能交给 sidecar 反复 400 刷启动器 WARN"
    );

    let cleanup_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库清理测试附件");
    sqlx::query("DELETE FROM attachment_distribution_metadata WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&cleanup_pool)
        .await
        .expect("应能清理协作分发元数据");
    sqlx::query("DELETE FROM attachments WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&cleanup_pool)
        .await
        .expect("应能清理附件记录");
    cleanup_pool.close().await;

    fake_seeder_server.abort();
    恢复环境变量(backup);
}

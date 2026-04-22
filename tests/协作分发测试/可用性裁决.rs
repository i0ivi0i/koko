use super::*;
use axum::{extract::State as AxumState, routing::post, Json as AxumJson, Router};
use std::sync::{Arc, Mutex};
use tokio::{net::TcpListener, task::JoinHandle};

#[derive(Default, Clone)]
struct 假Seeder控制面记录 {
    start_payloads: Vec<serde_json::Value>,
    reconcile_payloads: Vec<serde_json::Value>,
}

type 假Seeder控制面记录句柄 = Arc<Mutex<假Seeder控制面记录>>;

async fn 启动假seeder控制面() -> (String, 假Seeder控制面记录句柄, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能绑定假的 seeder 控制面端口");
    let address = listener
        .local_addr()
        .expect("应能读取假的 seeder 控制面地址");
    let records: 假Seeder控制面记录句柄 = Arc::new(Mutex::new(假Seeder控制面记录::default()));
    let app = Router::new()
        .route("/seed/start", post(记录假seeder_start请求))
        .route("/seed/reconcile", post(记录假seeder_reconcile请求))
        .with_state(records.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("假的 seeder 控制面应能启动");
    });
    (format!("http://{address}"), records, server)
}

async fn 记录假seeder_start请求(
    AxumState(records): AxumState<假Seeder控制面记录句柄>,
    AxumJson(payload): AxumJson<serde_json::Value>,
) -> (StatusCode, AxumJson<serde_json::Value>) {
    records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .start_payloads
        .push(payload);
    (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "created": true
        })),
    )
}

async fn 记录假seeder_reconcile请求(
    AxumState(records): AxumState<假Seeder控制面记录句柄>,
    AxumJson(payload): AxumJson<serde_json::Value>,
) -> (StatusCode, AxumJson<serde_json::Value>) {
    records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .reconcile_payloads
        .push(payload);
    (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "activeCount": 1
        })),
    )
}

/// 可用性裁决测试只守 availability 真相：
/// 1. presence 上报会刷新最近 peer 存活时间；
/// 2. web_seed 过期后，是 available 还是 expired，只由 peer 存活窗口裁决。
#[tokio::test]
#[serial]
async fn presence上报会让web_seed过期但最近peer仍存活的locator保持available() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MP{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-presence-device-{uniq}");
    let attachment_id = format!("att-presence-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let session_id = tokio::task::spawn_blocking(move || {
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

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("应能创建局部运行时");
        let database_url_for_attachment = database_url.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '5 minutes', \
                     last_peer_seen_at = NULL \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 窗口挪到过去");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("presence-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能先创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 presence 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (presence_status, presence_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/presence?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(presence_status, StatusCode::NO_CONTENT, "{presence_body:?}");

    let (status, body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("available"),
        "最近 peer 仍在活跃时，后端不应该仅因 24 小时 WebSeed 窗口结束就直接裁决 expired"
    );
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "当 web_seed 或最近 peer 仍可用时，locator 必须把媒体状态明确投影为 MEDIA_READY"
    );
    assert!(
        body["distribution"]["media_state"]["retry_after_ms"].is_null(),
        "MEDIA_READY 不应携带重试间隔，避免前端误判成等待态"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验 presence");
    let last_peer_seen_epoch: Option<i64> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM last_peer_seen_at)::BIGINT \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 last_peer_seen_at");
    assert!(
        last_peer_seen_epoch.is_some(),
        "presence 上报后必须写入最近 peer 存活时间"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn web_seed过期且最近没有peer存活时locator会裁决expired() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MX{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-expired-device-{uniq}");
    let attachment_id = format!("att-expired-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let session_id = tokio::task::spawn_blocking(move || {
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

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("应能创建局部运行时");
        let database_url_for_attachment = database_url.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '5 minutes', \
                     last_peer_seen_at = NOW() - INTERVAL '10 minutes' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 和 peer 存活窗口一起挪到过去");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("expired-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能先创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 expired 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("expired")
    );
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_NO_ONLINE_SEED"),
        "web_seed 与最近 peer 都不可用时，必须给出明确的无在线种子状态"
    );
    assert_eq!(
        body["distribution"]["media_state"]["retry_after_ms"].as_i64(),
        Some(15_000),
        "无在线种子状态应给出统一重试节奏，避免各端自猜重试频率"
    );
}

#[tokio::test]
#[serial]
async fn web_seed刚过期且最近没有peer存活时locator会先进入连接群友态() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MC{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-connecting-device-{uniq}");
    let attachment_id = format!("att-connecting-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let session_id = tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity =
            koko::usecase::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let room = koko::usecase::按短码进房或建房(&mut repo, &identity.会话标识, &room_code)
            .expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("应能创建局部运行时");
        let database_url_for_attachment = database_url.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '3 seconds', \
                     last_peer_seen_at = NULL, \
                     torrent_info_hash = '1111111111111111111111111111111111111111' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 调整到刚过期窗口");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("connecting-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能先创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 connecting 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("expired"),
        "兼容字段 availability 仍保持旧语义：当前没有可用来源时继续是 expired"
    );
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "web_seed 刚过期且仍在连接预算内时，应先进入连接群友态，而不是直接跳到无在线种子"
    );
    assert_eq!(
        body["distribution"]["media_state"]["retry_after_ms"].as_i64(),
        Some(2_000),
        "连接群友态应给出短周期重试提示，驱动前端快速探测 peer 恢复"
    );
}

#[tokio::test]
#[serial]
async fn web_seed过期且streaming已删除但最近peer仍存活时locator会进入peer_only可用态() {
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
        Some(
            serde_json::json!({"device_anonymous_token": format!("peer-only-after-streaming-delete-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-peer-only-after-streaming-delete-{uniq}");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    插入流媒体清单元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET web_seed_until = NOW() - INTERVAL '5 minutes',
             last_peer_seen_at = NOW()
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把 web_seed 挪出窗口，同时保留最近 peer 存活");
    sqlx::query(
        "UPDATE attachment_streaming_manifests
         SET streaming_expires_at = NOW() - INTERVAL '25 hours',
             streaming_deleted_at = NOW() - INTERVAL '1 minute'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把流媒体清单标成已删除");
    pool.close().await;

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("available"),
        "只要最近 peer 仍在活跃，locator 就必须进入 peer-only 可用态，而不是因为服务器 streaming 已删就直接 expired"
    );
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "peer-only 可用态本质仍是 READY，前端不应被迫做二次状态翻译"
    );
    assert_eq!(
        body["distribution"]["survival_mode"].as_str(),
        Some("peer_only_after_expiry")
    );
    assert!(
        body["distribution"]["web_seed_url"].is_null(),
        "web_seed 已过期时，locator 顶层分发表面必须明确退场"
    );
    assert!(
        body["streaming_asset"]["manifest"]["hls_master_url"].is_null(),
        "streaming_deleted_at 已写入后，locator 不能继续投影 HLS manifest 地址"
    );
    assert!(
        body["streaming_asset"]["manifest"]["dash_mpd_url"].is_null(),
        "streaming_deleted_at 已写入后，locator 不能继续投影 DASH manifest 地址"
    );
    assert!(
        body["streaming_asset"]["lifecycle"]["streaming_deleted_at"]
            .as_str()
            .is_some(),
        "peer-only 存活语义必须和流媒体退场事实同时出现，不能让前端自己猜 manifest 是否已删"
    );
}

#[tokio::test]
#[serial]
async fn 做种对账会按权威附件集合触发start并下发reconcile清单() {
    let (fake_seeder_base_url, seeder_records, fake_seeder_server) = 启动假seeder控制面().await;
    let backup = 备份并清空环境变量(&["SWARM_SEEDER_CONTROL_BASE_URL"]);
    env::set_var("SWARM_SEEDER_CONTROL_BASE_URL", fake_seeder_base_url.as_str());

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state = koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
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
    let info_hash = "0123456789abcdef0123456789abcdef01234567";
    // 这里显式补齐最小 torrent 元信息，确保该附件在“可做种”语义上是完整记录。
    // 注意：本测试只验证对账命令面，不验证 sidecar 解析 torrent 字节的能力，
    // 所以这里的字节只要求“非空且可落库”，不要求可播放。
    let fake_torrent_bytes = vec![0x64_u8, 0x31, 0x3a, 0x61, 0x30, 0x3a, 0x65];
    let fake_piece_length = 16_384_i32;

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
             piece_length_bytes = $4
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .bind(info_hash)
    .bind(&fake_torrent_bytes)
    .bind(fake_piece_length)
    .execute(&pool)
    .await
    .expect("应能补齐 torrent_info_hash");
    pool.close().await;

    koko::shell::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    let records = seeder_records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .clone();
    let matched_start_payload = records
        .start_payloads
        .iter()
        .find(|payload| payload["infoHash"].as_str() == Some(info_hash));
    assert!(
        matched_start_payload.is_some(),
        "对账触发的 seeder start 集合里必须包含当前测试附件的权威 infoHash"
    );
    let matched_start_payload = matched_start_payload.expect("上面已断言存在匹配 payload");
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
    assert!(
        records.reconcile_payloads.len() >= 1,
        "对账应至少下发一次 reconcile 清单"
    );
    let reconcile_contains_target = records.reconcile_payloads.iter().any(|payload| {
        payload["activeInfoHashes"]
            .as_array()
            .map(|values| values.iter().any(|value| value.as_str() == Some(info_hash)))
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
    env::set_var("SWARM_SEEDER_CONTROL_BASE_URL", fake_seeder_base_url.as_str());

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state = koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
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

    koko::shell::执行一次协作分发做种对账(state)
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

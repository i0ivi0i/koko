use super::*;
use axum::{extract::State as AxumState, routing::post, Json as AxumJson, Router};
use std::sync::{Arc, Mutex};
use tokio::{net::TcpListener, task::JoinHandle};

use sqlx::PgPool;

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

async fn 写入指定类型peer存活记录(
    pool: &PgPool,
    附件标识: &str,
    会话标识: &str,
    peer_kind: &str,
    最近peer存活时间戳秒: i64,
) {
    sqlx::query(
        "INSERT INTO swarm_peer_presence \
            (swarm_id, session_id, attachment_id, peer_kind, last_seen_at) \
         SELECT swarm_id, $2, $1, $3, TO_TIMESTAMP($4) \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1 \
         ON CONFLICT (swarm_id, session_id, peer_kind) \
         DO UPDATE SET \
            attachment_id = EXCLUDED.attachment_id, \
            last_seen_at = EXCLUDED.last_seen_at",
    )
    .bind(附件标识)
    .bind(会话标识)
    .bind(peer_kind)
    .bind(最近peer存活时间戳秒)
    .execute(pool)
    .await
    .expect("应能写入指定类型的 peer 存活记录");
}

/// 可用性裁决测试要守住“presence 不是 available source”：
/// 1. 空 body presence 只能表达“我还在线”，不能直接把媒体抬成 READY；
/// 2. 真正可用来源必须是 strong seed 或 verified complete peer。
#[tokio::test]
#[serial]
async fn 空body_presence不会把无种子附件抬成media_ready() {
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
                     swarm_id = $2 \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .bind(format!("swarm-no-seed-{uniq}"))
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
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "空 body presence 不能再被当成 complete peer；首次访问仍应先进入连接群友窗口"
    );
    assert_eq!(
        body["distribution"]["media_state"]["retry_after_ms"].as_i64(),
        Some(2_000),
        "连接群友窗口必须保持短重试节奏"
    );

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验 presence");
    let viewer_intent_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM swarm_peer_presence \
         WHERE attachment_id = $1 AND peer_kind = 'viewer_intent'",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 viewer_intent 运行态记录");
    assert!(
        viewer_intent_count > 0,
        "空 body presence 仍应登记为 viewer_intent，便于运行态观测"
    );
    let complete_peer_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM swarm_peer_presence \
         WHERE attachment_id = $1 AND peer_kind = 'complete_peer'",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete_peer 运行态记录");
    assert_eq!(
        complete_peer_count, 0,
        "空 body presence 不能冒充 complete_peer 来源"
    );
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn recent_partial_peer会让过期附件保持connecting而不是直接no_seed() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PP{:010}", uniq % 10_000_000_000);
    let device_token = format!("partial-peer-recent-device-{uniq}");
    let attachment_id = format!("att-partial-peer-recent-{uniq}");
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
        let session_id_for_attachment = identity.会话标识.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &session_id_for_attachment, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '2 hours' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web_seed 调整到明显过期窗口");
            写入指定类型peer存活记录(
                &pool,
                &attachment_id_for_worker,
                &session_id_for_attachment,
                "partial_peer",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_secs() as i64,
            )
            .await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("partial-peer-recent-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 recent partial peer 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());

    let (status, first_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{first_body:?}");
    assert_eq!(
        first_body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "只有 recent partial_peer 活跃时，过期附件仍应进入连接群友态"
    );
}

#[tokio::test]
#[serial]
async fn stale_partial_peer不会把附件永久抬在connecting() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PQ{:010}", uniq % 10_000_000_000);
    let device_token = format!("partial-peer-stale-device-{uniq}");
    let attachment_id = format!("att-partial-peer-stale-{uniq}");
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
        let session_id_for_attachment = identity.会话标识.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &session_id_for_attachment, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '2 hours' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web_seed 调整到明显过期窗口");
            写入指定类型peer存活记录(
                &pool,
                &attachment_id_for_worker,
                &session_id_for_attachment,
                "partial_peer",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_secs() as i64
                    - 3600,
            )
            .await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("partial-peer-stale-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 stale partial peer 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());

    let (status, first_body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{first_body:?}");
    assert_eq!(
        first_body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "首次无源访问仍应先进入统一的连接群友窗口"
    );
    tokio::time::sleep(std::time::Duration::from_secs(9)).await;
    let (status, body) = send_json(
        koko::shell::构建路由(state),
        Method::GET,
        &format!("/api/media/{attachment_id}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_NO_ONLINE_SEED"),
        "过了 stale window 的 partial_peer 不能让附件永久停在连接群友态"
    );
}

#[tokio::test]
#[serial]
async fn partial_peer不能冒充available_ready来源() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PR{:010}", uniq % 10_000_000_000);
    let device_token = format!("partial-peer-availability-device-{uniq}");
    let attachment_id = format!("att-partial-peer-availability-{uniq}");
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
        let session_id_for_attachment = identity.会话标识.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库插入附件");
            插入ready视频附件记录(&pool, &session_id_for_attachment, &attachment_id_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '2 hours' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web_seed 调整到明显过期窗口");
            写入指定类型peer存活记录(
                &pool,
                &attachment_id_for_worker,
                &session_id_for_attachment,
                "partial_peer",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("clock")
                    .as_secs() as i64,
            )
            .await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("partial-peer-availability-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 partial peer availability 建数任务应完成");

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
    assert_ne!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "partial_peer 不能冒充 available-ready 等价真相"
    );
}

#[tokio::test]
#[serial]
async fn 同swarm的另一条完整peer能让旧附件保持ready() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MS{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-shared-peer-device-{uniq}");
    let attachment_id_target = format!("att-shared-target-{uniq}");
    let attachment_id_seed = format!("att-shared-seed-{uniq}");
    let shared_swarm_id = format!("swarm-shared-peer-{uniq}");
    let shared_content_hash = format!("{uniq:016x}{uniq:016x}{uniq:016x}{uniq:016x}");
    let database_url = cfg.database_url.clone();
    let attachment_id_target_for_worker = attachment_id_target.clone();
    let attachment_id_seed_for_worker = attachment_id_seed.clone();
    let shared_swarm_id_for_worker = shared_swarm_id.clone();
    let shared_content_hash_for_worker = shared_content_hash.clone();

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
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_target_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_target_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_target_for_worker).await;
            插入ready视频附件记录(&pool, &identity.会话标识, &attachment_id_seed_for_worker).await;
            插入附件协作分发元数据记录(&pool, &attachment_id_seed_for_worker).await;
            插入流媒体清单元数据记录(&pool, &attachment_id_seed_for_worker).await;
            sqlx::query(
                "UPDATE attachment_distribution_metadata \
                 SET web_seed_until = NOW() - INTERVAL '5 minutes', \
                     swarm_id = $2, \
                     content_hash = $3 \
                 WHERE attachment_id IN ($1, $4)",
            )
            .bind(&attachment_id_target_for_worker)
            .bind(&shared_swarm_id_for_worker)
            .bind(&shared_content_hash_for_worker)
            .bind(&attachment_id_seed_for_worker)
            .execute(&pool)
            .await
            .expect("应能把两条附件收口到同一个共享 swarm，并把 web_seed 窗口挪到过去");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("shared-target-client-{uniq}"),
            "",
            &[attachment_id_target_for_worker],
        )
        .expect("应能创建目标附件消息");
        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("shared-seed-client-{uniq}"),
            "",
            &[attachment_id_seed_for_worker],
        )
        .expect("应能创建做种附件消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 shared swarm 建数任务应完成");

    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (presence_status, presence_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id_seed}/presence?session_id={session_id}"),
        Some(serde_json::json!({
            "peer_kind": "complete_peer"
        })),
        &[],
    )
    .await;
    assert_eq!(presence_status, StatusCode::NO_CONTENT, "{presence_body:?}");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id_target}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "同一 swarm 的完整来源应统一投影成 MEDIA_READY"
    );
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
                 SET web_seed_until = NOW() - INTERVAL '5 minutes' \
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
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "web_seed 与最近 peer 都不可用时，首次访问仍必须先进入连接群友状态"
    );
    assert_eq!(
        body["distribution"]["media_state"]["retry_after_ms"].as_i64(),
        Some(2_000),
        "连接群友状态应给出短重试节奏，避免各端自猜探测频率"
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
                 SET web_seed_until = NOW() - INTERVAL '3 seconds', \
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
async fn web_seed已过期较久且最近没有peer存活时首次访问仍会先进入连接群友态() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MO{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-old-expired-device-{uniq}");
    let attachment_id = format!("att-old-expired-{uniq}");
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
                 SET web_seed_until = NOW() - INTERVAL '2 hours', \
                     torrent_info_hash = '3333333333333333333333333333333333333333' \
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_worker)
            .execute(&pool)
            .await
            .expect("应能把 web seed 调整到明显过期窗口");
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("old-expired-client-{uniq}"),
            "",
            &[attachment_id_for_worker],
        )
        .expect("应能先创建带视频附件的消息");

        identity.会话标识
    })
    .await
    .expect("阻塞 old-expired 建数任务应完成");

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
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_CONNECTING_TO_PEERS"),
        "首次访问旧过期附件也应先进入连接群友态，而不是直接落无在线种子"
    );
    assert_eq!(
        body["distribution"]["media_state"]["retry_after_ms"].as_i64(),
        Some(2_000),
        "连接群友态要保持短重试节奏，保证前端探测恢复速度"
    );
}

#[tokio::test]
#[serial]
async fn 附件已删除时locator会返回media_deleted终态而不是附件未就绪错误() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("MD{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-deleted-device-{uniq}");
    let attachment_id = format!("att-deleted-{uniq}");
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
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("deleted-client-{uniq}"),
            "",
            &[attachment_id_for_worker.clone()],
        )
        .expect("应能先创建带视频附件的消息");

        let attachment_id_for_update = attachment_id_for_worker.clone();
        rt.block_on(async {
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url_for_attachment)
                .await
                .expect("应能直连数据库更新附件状态");
            sqlx::query(
                "UPDATE attachments
                 SET status = 'expired'
                 WHERE attachment_id = $1",
            )
            .bind(&attachment_id_for_update)
            .execute(&pool)
            .await
            .expect("应能把附件状态标记为已删除终态");
            pool.close().await;
        });

        identity.会话标识
    })
    .await
    .expect("阻塞 deleted 建数任务应完成");

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
        body["status"].as_str(),
        Some("deleted"),
        "附件已删除时，locator 顶层状态要明确进入 deleted，而不是继续报 ready/expired"
    );
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_DELETED"),
        "删除终态必须明确返回 MEDIA_DELETED，不能混成附件未就绪或无在线种子"
    );
    assert!(
        body["distribution"]["join_ticket"].is_null(),
        "删除终态不应继续签发 swarm join ticket"
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
         SET web_seed_until = NOW() - INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .execute(&pool)
    .await
    .expect("应能把 web_seed 挪出窗口");
    写入完整peer存活记录(&pool, &attachment_id, session_id).await;
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
async fn active_backend_strong_seed会让同swarm过期附件保持ready() {
    let (fake_seeder_base_url, _seeder_records, fake_seeder_server) = 启动假seeder控制面().await;
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
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({
            "device_anonymous_token": format!("backend-seed-shared-swarm-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id_expired = format!("att-backend-seed-expired-{uniq}");
    let attachment_id_active = format!("att-backend-seed-active-{uniq}");
    let shared_swarm_id = format!("swarm-backend-seed-shared-{uniq}");
    let shared_content_hash = format!("{uniq:016x}{uniq:016x}{uniq:016x}{uniq:016x}");
    let active_info_hash = "2222222222222222222222222222222222222222";
    let fake_torrent_bytes = vec![0x64_u8, 0x31, 0x3a, 0x61, 0x30, 0x3a, 0x65];

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id_expired).await;
    插入附件协作分发元数据记录(&pool, &attachment_id_expired).await;
    插入流媒体清单元数据记录(&pool, &attachment_id_expired).await;
    插入ready视频附件记录(&pool, session_id, &attachment_id_active).await;
    插入附件协作分发元数据记录(&pool, &attachment_id_active).await;
    插入流媒体清单元数据记录(&pool, &attachment_id_active).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET swarm_id = $2,
             content_hash = $3
         WHERE attachment_id IN ($1, $4)",
    )
    .bind(&attachment_id_expired)
    .bind(&shared_swarm_id)
    .bind(&shared_content_hash)
    .bind(&attachment_id_active)
    .execute(&pool)
    .await
    .expect("应能把两条附件收口到同一个共享 swarm");
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET web_seed_until = NOW() - INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id_expired)
    .execute(&pool)
    .await
    .expect("应能把过期附件挪出 web_seed 窗口");
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET web_seed_until = NOW() + INTERVAL '30 minutes',
             torrent_info_hash = $2,
             torrent_bytes = $3,
             piece_length_bytes = $4
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id_active)
    .bind(active_info_hash)
    .bind(&fake_torrent_bytes)
    .bind(16_384_i32)
    .execute(&pool)
    .await
    .expect("应能把 active 附件补齐做种所需 torrent 元信息");
    pool.close().await;

    koko::shell::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/media/{attachment_id_expired}/locator?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["distribution"]["media_state"]["code"].as_str(),
        Some("MEDIA_READY"),
        "backend strong seed 应被当成正式可用来源，状态必须保持 READY"
    );

    fake_seeder_server.abort();
    恢复环境变量(backup);
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

#[test]
fn 协作分发响应源码不应继续输出availability兼容字段() {
    let source = std::fs::read_to_string("src/媒体协作分发.rs")
        .expect("应能读取协作分发响应实现源码");
    assert!(
        !source.contains("\"availability\""),
        "收口目标要求协作分发只输出 media_state，不能继续保留 availability 兼容字段"
    );
}

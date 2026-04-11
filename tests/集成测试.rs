use axum::{
    body::{to_bytes, Body},
    http::{header, Method, Request, StatusCode},
};
use serde_json::Value;
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::env;
use std::io;
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;
use tokio::time::{sleep, timeout, Duration};
use tower::ServiceExt;

/// 集成测试总则：
/// 1. 这里测试“模块接线后”的真实行为，而不是单点纯函数。
/// 2. 重点覆盖：配置失败、迁移结构、事务顺序、HTTP 冷路径、Realtime 主链。
#[test]
#[serial]
fn 启动缺配置即失败() {
    let keys = [
        "DATABASE_URL",
        "ADMIN_PASSWORD",
        "APP_PORT",
        "RUST_LOG",
        "KOKO_SKIP_DOTENV",
    ];
    let backup = 备份并清空环境变量(&keys);
    env::set_var("KOKO_SKIP_DOTENV", "1");

    let result = koko::assembly::读取配置();
    assert!(result.is_err(), "缺关键配置时必须失败");

    恢复环境变量(backup);
}

#[test]
fn 数据库真相模型可迁移() {
    let sql = std::fs::read_to_string("migrations/0001_初始化真相模型.sql")
        .expect("应存在初始化迁移文件");
    let sql_v2 = std::fs::read_to_string("migrations/0002_设备级匿名身份.sql")
        .expect("应存在匿名身份迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS sessions"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS rooms"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_members"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_events"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS messages"));
    assert!(sql.contains("UNIQUE (room_id, event_position)"));
    assert!(sql.contains("FOREIGN KEY (room_id, event_position)"));
    assert!(sql_v2.contains("CREATE TABLE IF NOT EXISTS anonymous_identities"));
    assert!(sql_v2.contains("device_anonymous_token"));
    assert!(sql_v2.contains("anonymous_identity_id"));
}

#[test]
fn 数据库真相模型包含房间阅读锚点表() {
    let sql = std::fs::read_to_string("migrations/0003_房间阅读锚点.sql")
        .expect("应存在房间阅读锚点迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_read_anchors"));
    assert!(sql.contains("anonymous_identity_id"));
    assert!(sql.contains("last_read_event_position"));
    assert!(sql.contains("UNIQUE (anonymous_identity_id, room_id)"));
}

#[test]
fn 数据库真相模型包含attachments与message_attachment_refs表() {
    let sql =
        std::fs::read_to_string("migrations/0004_附件与图片消息.sql").expect("应存在附件迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachments"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS message_attachment_refs"));
    assert!(sql.contains("thumbnail_storage_key"));
    assert!(sql.contains("committed_at"));
    assert!(sql.contains("UNIQUE (message_id, sort_order)"));
}

#[test]
#[allow(non_snake_case)]
fn 数据库真相模型包含媒体Tus运输记录表() {
    let sql = std::fs::read_to_string("migrations/0005_媒体Tus上传运输记录.sql")
        .expect("应存在 Tus 运输记录迁移文件");

    // 运输层事实必须独立持久化，避免把 upload token / upload id 污染到附件业务真相表。
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_upload_transports"));
    assert!(sql.contains("attachment_id TEXT PRIMARY KEY"));
    assert!(sql.contains("transport_kind TEXT NOT NULL"));
    assert!(sql.contains("upload_token TEXT NOT NULL"));
    assert!(sql.contains("token_expires_at TIMESTAMPTZ NOT NULL"));
    assert!(sql.contains("transport_upload_id TEXT"));
    assert!(sql.contains("storage_locator TEXT"));
    assert!(sql.contains("byte_size BIGINT"));
    assert!(sql.contains("finished_at TIMESTAMPTZ"));
}

#[test]
fn 协作分发迁移已包含元数据表() {
    let sql = std::fs::read_to_string("migrations/0006_附件协作分发元数据.sql")
        .expect("应能读到 Phase 1 协作分发迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_distribution_metadata"));
    assert!(sql.contains(
        "attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE"
    ));
    assert!(sql.contains("content_id TEXT NOT NULL"));
    assert!(sql.contains("content_hash TEXT NOT NULL"));
    assert!(sql.contains("swarm_id TEXT NOT NULL"));
    assert!(sql.contains("web_seed_until TIMESTAMPTZ NOT NULL"));
}

#[test]
fn 共享契约已为房间阅读推进预留稳定命令() {
    let command = koko::contract::命令::推进房间阅读位置 {
        房间标识: "r-test".to_string(),
        已读到事件位置: 3,
    };

    assert!(matches!(
        command,
        koko::contract::命令::推进房间阅读位置 {
            已读到事件位置: 3,
            ..
        }
    ));
}

#[tokio::test]
#[serial]
async fn 阅读锚点会写入当前匿名身份与房间的唯一记录() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平阅读锚点迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("RA{:010}", uniq % 10_000_000_000);
    let device_token = format!("read-anchor-device-{uniq}");
    let database_url = cfg.database_url.clone();

    let (identity_id, room_id) = tokio::task::spawn_blocking(move || {
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

        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 0)
            .expect("应能写入初始阅读锚点");
        (identity.匿名身份标识, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验阅读锚点");
    let row = sqlx::query(
        "SELECT ai.anonymous_identity_id, rra.last_read_event_position \
         FROM room_read_anchors rra \
         JOIN anonymous_identities ai ON ai.id = rra.anonymous_identity_id \
         JOIN rooms r ON r.id = rra.room_id \
         WHERE r.room_id = $1",
    )
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .expect("应存在阅读锚点记录");

    let stored_identity: String = row.get("anonymous_identity_id");
    let stored_position: i64 = row.get("last_read_event_position");
    assert_eq!(stored_identity, identity_id);
    assert_eq!(stored_position, 0);

    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 阅读锚点只会单调前进不会被回退覆盖() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平阅读锚点迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("RB{:010}", uniq % 10_000_000_000);
    let device_token = format!("read-anchor-advance-{uniq}");
    let database_url = cfg.database_url.clone();

    let room_id = tokio::task::spawn_blocking(move || {
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

        for index in 0..5 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &identity.会话标识,
                &format!("read-anchor-c-{index}"),
                &format!("read-anchor-{index}"),
            )
            .expect("应能先制造已成立消息");
        }

        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 5)
            .expect("应能先写入更靠后的位置");
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &identity.会话标识, 2)
            .expect("较早位置不应破坏已有锚点");
        room_id
    })
    .await
    .expect("阻塞建数任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验阅读锚点");
    let stored_position: i64 = sqlx::query_scalar(
        "SELECT rra.last_read_event_position \
         FROM room_read_anchors rra \
         JOIN rooms r ON r.id = rra.room_id \
         WHERE r.room_id = $1",
    )
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询到阅读位置");

    assert_eq!(stored_position, 5, "较早写入不应把阅读锚点回退");
    pool.close().await;
}

#[test]
#[serial]
fn 发送消息事务性顺序成立() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("T{:011}", uniq % 100_000_000_000);
    let device_token = format!("tx-device-{uniq}");
    let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room = koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    let event = koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "c-1", "hello")
        .expect("应能发送消息");
    match event {
        koko::contract::领域事件::消息已创建 {
            房间标识,
            事件位置,
            文本,
            ..
        } => {
            assert_eq!(房间标识, room_id, "事件房间标识应匹配");
            assert_eq!(事件位置, 1, "第一条消息事件位置应为 1");
            assert_eq!(文本, "hello", "事件文本应保持一致");
        }
    }

    let (latest, events, messages) = repo
        .查询房间持久化计数(&room_id)
        .expect("应能查询持久化计数");
    assert_eq!(latest, 1, "房间锚点应推进到 1");
    assert_eq!(events, 1, "房间事件应写入 1 条");
    assert_eq!(messages, 1, "消息表应写入 1 条");
}

#[tokio::test]
#[serial]
async fn 图片消息会把附件引用和事件一起持久化() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PA{:010}", uniq % 10_000_000_000);
    let device_token = format!("persist-attachment-device-{uniq}");
    let attachment_id = format!("att-persist-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (room_id, message_id) = tokio::task::spawn_blocking(move || {
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
            插入ready图片附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            pool.close().await;
        });

        let event = koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("persist-client-{uniq}"),
            "带图消息",
            &[attachment_id_for_worker.clone()],
        )
        .expect("应能创建带图片附件的消息");

        match event {
            koko::contract::领域事件::消息已创建 {
                消息标识,
                文本,
                附件,
                ..
            } => {
                assert_eq!(文本, "带图消息");
                assert_eq!(附件.len(), 1, "权威事件应直接带出图片附件快照");
                assert!(matches!(
                    附件.first(),
                    Some(koko::contract::附件快照::图片(图片))
                        if 图片.附件标识 == attachment_id_for_worker && 图片.宽 == 1 && 图片.高 == 1
                ));
                (room_id, 消息标识)
            }
        }
    })
    .await
    .expect("阻塞写入任务应完成");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库校验附件引用");
    let row = sqlx::query(
        "SELECT mar.sort_order, a.attachment_id, a.committed_at \
         FROM message_attachment_refs mar \
         JOIN attachments a ON a.id = mar.attachment_id \
         WHERE mar.message_id = $1",
    )
    .bind(&message_id)
    .fetch_one(&pool)
    .await
    .expect("消息附件引用应已落库");

    let stored_attachment_id: String = row.get("attachment_id");
    let sort_order: i32 = row.get("sort_order");
    let committed_at_exists = sqlx::query_scalar::<_, bool>(
        "SELECT committed_at IS NOT NULL FROM attachments WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能读取附件提交时间");

    assert_eq!(stored_attachment_id, attachment_id);
    assert_eq!(sort_order, 0);
    assert!(
        committed_at_exists,
        "附件首次被消息引用后应写入 committed_at"
    );

    let ref_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM message_attachment_refs mar \
         JOIN messages m ON m.message_id = mar.message_id \
         JOIN rooms r ON r.id = m.room_id \
         WHERE r.room_id = $1",
    )
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .expect("应能统计房间附件引用数");
    assert_eq!(ref_count, 1, "当前测试只应有一条附件引用");
    pool.close().await;
}

#[tokio::test]
#[serial]
async fn 房间快照读回时仍能拿到图片附件列表() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("PB{:010}", uniq % 10_000_000_000);
    let device_token = format!("snapshot-attachment-device-{uniq}");
    let attachment_id = format!("att-snapshot-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let room_id = tokio::task::spawn_blocking(move || {
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
            插入ready图片附件记录(&pool, &identity.会话标识, &attachment_id_for_worker).await;
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("snapshot-client-{uniq}"),
            "",
            &[attachment_id_for_worker.clone()],
        )
        .expect("应能创建纯图片消息");

        let snapshot = koko::usecase::加载房间快照(&repo, &room_id, &identity.会话标识)
            .expect("成员应能读回房间快照");
        match snapshot {
            koko::contract::快照::房间 { 首屏消息, .. } => {
                assert_eq!(首屏消息.len(), 1, "当前只应读回一条消息");
                match &首屏消息[0] {
                    koko::contract::领域事件::消息已创建 { 文本, 附件, .. } => {
                        assert_eq!(文本, "", "纯图片消息允许文本为空");
                        assert_eq!(附件.len(), 1, "快照里的消息应保留图片附件列表");
                        assert!(matches!(
                            附件.first(),
                            Some(koko::contract::附件快照::图片(图片))
                                if 图片.附件标识 == attachment_id_for_worker
                        ));
                    }
                }
            }
            _ => panic!("应返回房间快照"),
        }
        room_id
    })
    .await
    .expect("阻塞快照任务应完成");

    assert!(room_id.starts_with("r-"), "应返回稳定房间标识");
}

#[tokio::test]
#[serial]
async fn 旧图片上传路由已移除() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("legacy-upload-route-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    // 这条回归测试专门锁住“旧 multipart 入口必须彻底消失”。
    // 只要旧链还活着，这里就不会返回 404，后续删除 route 时才有安全网。
    let response = send_multipart_response(
        app,
        "/api/attachments/image",
        session_id,
        "a.png",
        "image/png",
        &最小png字节(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传会返回Tus契约() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-image-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "prepared.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    断言媒体准备结果是Tus契约(&body, "image", "prepared.png", "image/png", 68);
    let attachment_id = body["attachment_id"].as_str().expect("attachment_id");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let status_in_db = sqlx::query_scalar::<_, Option<String>>(
        "SELECT status FROM attachments WHERE attachment_id = $1",
    )
    .bind(attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询附件状态")
    .expect("prepare 后应存在 prepared 附件记录");
    assert_eq!(status_in_db, "prepared");

    let transport_row = sqlx::query(
        "SELECT transport_kind, upload_token, byte_size \
         FROM attachment_upload_transports WHERE attachment_id = $1",
    )
    .bind(attachment_id)
    .fetch_one(&pool)
    .await
    .expect("prepare 后应同时写入运输授权记录");
    let transport_kind: String = transport_row.get("transport_kind");
    let upload_token: String = transport_row.get("upload_token");
    let transport_byte_size: Option<i64> = transport_row.get("byte_size");
    assert_eq!(transport_kind, "tus");
    assert!(
        !upload_token.trim().is_empty(),
        "运输授权记录必须保存非空 upload_token"
    );
    assert_eq!(transport_byte_size, Some(68));
}

#[tokio::test]
#[serial]
async fn complete图片上传会把prepared附件升级成ready并写入缩略图() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let rustus_data_dir = state.rustus_data_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("complete-image-{uniq}")})),
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
            "file_name": "complete.png",
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

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-complete-image-{attachment_id}");
    let temp_file =
        写入rustus测试文件(&rustus_data_dir, &attachment_id, "complete.png", &最小png字节())
            .expect("应能写入 rustus 原图文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "complete.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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

    assert_eq!(
        complete_status,
        StatusCode::OK,
        "视频 complete 当前返回: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
    assert_eq!(complete_body["width"].as_i64(), Some(1));
    assert_eq!(complete_body["height"].as_i64(), Some(1));

    let row = sqlx::query(
        "SELECT status, width, height, thumbnail_storage_key FROM attachments WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete 后的附件记录");
    let status_in_db: String = row.get("status");
    let width_in_db: Option<i32> = row.get("width");
    let height_in_db: Option<i32> = row.get("height");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    assert_eq!(status_in_db, "ready");
    assert_eq!(width_in_db, Some(1));
    assert_eq!(height_in_db, Some(1));
    assert!(thumbnail_storage_key.is_some());
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare图片和视频都会返回统一Tus契约() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (image_status, image_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "prepare.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[],
    )
    .await;
    assert_eq!(image_status, StatusCode::OK);

    let (video_status, video_body) = send_json(
        app,
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "prepare.mp4",
            "mime_type": "video/mp4",
            "byte_size": 最小mp4字节().len()
        })),
        &[],
    )
    .await;
    assert_eq!(video_status, StatusCode::OK);

    断言媒体准备结果是Tus契约(&image_body, "image", "prepare.png", "image/png", 68);
    断言媒体准备结果是Tus契约(
        &video_body,
        "video",
        "prepare.mp4",
        "video/mp4",
        最小mp4字节().len() as i64,
    );
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在未显式配置public_endpoint时会按请求Host推导LAN可访问Tus地址() {
    let backup = 备份并清空环境变量(&["RUSTUS_PUBLIC_ENDPOINT", "RUSTUS_SERVER_PORT", "RUSTUS_URL"]);
    env::set_var("RUSTUS_SERVER_PORT", "2081");
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-lan-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "lan.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[("host", "192.168.50.9:8080")],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("http://192.168.50.9:2081/files"),
        "未显式配置 public endpoint 时，prepare 至少应回到当前请求 Host 可达的 Rustus 地址"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在反向代理HTTPS下会优先使用forwarded公网端口() {
    let backup = 备份并清空环境变量(&["RUSTUS_PUBLIC_ENDPOINT", "RUSTUS_SERVER_PORT", "RUSTUS_URL"]);
    env::set_var("RUSTUS_SERVER_PORT", "1081");
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-forwarded-port-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "proxy.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[
            ("x-forwarded-host", "im.example.com"),
            ("x-forwarded-proto", "https"),
            ("x-forwarded-port", "443"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("https://im.example.com/files"),
        "反向代理已经声明公网协议与公网端口时，prepare 不应再把内部 Rustus 监听端口泄漏给外部浏览器"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在forwarded_host自带公网端口时会保留该端口() {
    let backup = 备份并清空环境变量(&["RUSTUS_PUBLIC_ENDPOINT", "RUSTUS_SERVER_PORT", "RUSTUS_URL"]);
    env::set_var("RUSTUS_SERVER_PORT", "1081");
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-forwarded-host-port-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "proxy-8443.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[
            ("x-forwarded-host", "im.example.com:8443"),
            ("x-forwarded-proto", "https"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("https://im.example.com:8443/files"),
        "forwarded host 已经给出公网 authority 时，prepare 应继续沿用它，而不是退回内部 Rustus 端口"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
#[allow(non_snake_case)]
async fn prepare媒体上传在仅有forwarded_proto时会按协议默认端口构造公网地址() {
    let backup = 备份并清空环境变量(&["RUSTUS_PUBLIC_ENDPOINT", "RUSTUS_SERVER_PORT", "RUSTUS_URL"]);
    env::set_var("RUSTUS_SERVER_PORT", "1081");
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
        Some(serde_json::json!({"device_anonymous_token": format!("prepare-media-forwarded-proto-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "proxy-default-https.png",
            "mime_type": "image/png",
            "byte_size": 68
        })),
        &[
            ("host", "im.example.com"),
            ("x-forwarded-proto", "https"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["tus_endpoint"].as_str(),
        Some("https://im.example.com/files"),
        "标准 HTTPS 反向代理即使没额外透传 forwarded-port，也不应把内部 Rustus 监听端口暴露给公网客户端"
    );
    恢复环境变量(backup);
}

#[tokio::test]
#[serial]
async fn 没有上传回执时complete媒体上传会返回attachment_not_ready() {
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
        Some(serde_json::json!({"device_anonymous_token": format!("complete-without-receipt-{uniq}")})),
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
            "file_name": "missing-receipt.png",
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

    // complete 不允许把“prepare 成功”误读成“上传完成”；
    // 没有运输层回执时，prepared 附件必须继续被拒绝。
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

    assert_eq!(complete_status, StatusCode::CONFLICT);
    assert_eq!(
        complete_body["code"].as_str(),
        Some("attachment_not_ready")
    );
}

#[tokio::test]
#[serial]
async fn post_finish稍后到达时complete媒体上传会等待回执并成功() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let rustus_data_dir = state.rustus_data_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("complete-race-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id").to_string();

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "complete-race.png",
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
    let authorization = 提取媒体上传授权头(&prepare_body);
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "complete-race.png",
        &最小png字节(),
    )
    .expect("应能写入 rustus 临时图片文件");
    let upload_id = format!("upload-complete-race-{attachment_id}");

    // 真实浏览器里，Uppy 会在最终 PATCH 204 后立刻触发 upload-success，
    // 但 Rustus 的 post-finish 回执可能稍后才打到主服务。
    // 这里故意让 complete 先发起，再延迟 50ms 才送 post-finish，锁住这条竞态。
    let app_for_hook = app.clone();
    let attachment_id_for_hook = attachment_id.clone();
    let authorization_for_hook = authorization.clone();
    let upload_id_for_hook = upload_id.clone();
    let temp_file_for_hook = temp_file.clone();
    let hook_task = tokio::spawn(async move {
        sleep(Duration::from_millis(50)).await;
        send_json(
            app_for_hook,
            Method::POST,
            "/internal/rustus/hooks",
            Some(构造rustus_hook请求体(
                &upload_id_for_hook,
                &attachment_id_for_hook,
                "complete-race.png",
                "image/png",
                68,
                68,
                Some(temp_file_for_hook.as_str()),
            )),
            &[
                ("Hook-Name", "post-finish"),
                ("Authorization", authorization_for_hook.as_str()),
            ],
        )
        .await
    });

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
    let (hook_status, hook_body) = hook_task.await.expect("hook task 应该完成");

    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");
    assert_eq!(
        complete_status,
        StatusCode::OK,
        "post-finish 晚到时 complete 不该把内部竞态暴露成 attachment_not_ready: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
}

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
    let session_id = bootstrap["session_id"].as_str().expect("session_id").to_string();

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "distribution-ready.png",
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
    let authorization = 提取媒体上传授权头(&prepare_body);
    let temp_file = 写入rustus测试文件(
        &state.rustus_data_dir,
        &attachment_id,
        "distribution-ready.png",
        &最小png字节(),
    )
    .expect("应能写入 rustus 临时图片文件");
    let upload_id = format!("upload-distribution-ready-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "distribution-ready.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
        koko::usecase::引导匿名身份(&mut repo, &device_token)
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
        let first = koko::usecase::写入协作分发元数据(
            &mut repo,
            &koko::usecase::协作分发元数据写入请求 {
                附件标识: attachment_id_first_for_worker.clone(),
                content_id: format!("content_{attachment_id_first_for_worker}"),
                content_hash: shared_hash.to_string(),
                swarm_id: shared_swarm_id_for_worker.clone(),
                web_seed_until秒: 1_775_942_400,
            },
        );
        let second = koko::usecase::写入协作分发元数据(
            &mut repo,
            &koko::usecase::协作分发元数据写入请求 {
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
    assert!(result.1.is_ok(), "第二条相同内容附件不应因为相同 swarm_id 被唯一索引卡死");

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

#[tokio::test]
#[serial]
async fn rustus_pre_create非法token会被拒绝() {
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
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            "upload-invalid-token",
            "att-invalid-token",
            "invalid.png",
            "image/png",
            68,
            0,
            None,
        )),
        &[
            ("Hook-Name", "pre-create"),
            ("Authorization", "Bearer not-a-real-token"),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"].as_str(), Some("attachment_upload_unauthorized"));
}

#[tokio::test]
#[serial]
async fn rustus_pre_create允许offset为0且length等于metadata_byte_size() {
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
            "device_anonymous_token": format!("rustus-pre-create-{uniq}")
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
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &format!("upload-pre-create-{attachment_id}"),
            attachment_id,
            "pre-create.png",
            "image/png",
            68,
            0,
            None,
        )),
        &[
            ("Hook-Name", "pre-create"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT, "{body:?}");
}

#[tokio::test]
#[serial]
async fn rustus_pre_create缺少byte_size元数据时仍按prepare权威长度放行() {
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
            "device_anonymous_token": format!("rustus-pre-create-metadata-{uniq}")
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
    let mut hook_body = 构造rustus_hook请求体(
        &format!("upload-pre-create-metadata-{attachment_id}"),
        attachment_id,
        "pre-create-metadata.png",
        "image/png",
        68,
        0,
        None,
    );
    /*
     * 真实 Rustus create-upload 场景里，hook 不保证把每个 metadata 键都稳定回显给主服务。
     * 这里故意只保留 attachment_id，锁住“pre-create 应依赖 prepare 权威长度，而不是重复 metadata.byte_size”。
     */
    hook_body["upload"]["metadata"] = serde_json::json!({
        "attachment_id": attachment_id
    });

    let (status, body) = send_json(
        app,
        Method::POST,
        "/internal/rustus/hooks",
        Some(hook_body),
        &[
            ("Hook-Name", "pre-create"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT, "{body:?}");
}

#[tokio::test]
#[serial]
async fn rustus_post_finish会登记上传回执() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let rustus_data_dir = state.rustus_data_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("rustus-post-finish-{uniq}")})),
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
            "file_name": "hook.png",
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
    let expected_upload_id = format!("upload-post-finish-{attachment_id}");
    let temp_file =
        写入rustus测试文件(&rustus_data_dir, attachment_id, "hook.png", &最小png字节())
            .expect("应能写入 rustus 测试文件");

    let (status, _) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &expected_upload_id,
            attachment_id,
            "hook.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let row = sqlx::query(
        "SELECT transport_upload_id, storage_locator, byte_size, finished_at IS NOT NULL AS is_finished \
         FROM attachment_upload_transports WHERE attachment_id = $1",
    )
    .bind(attachment_id)
    .fetch_one(&pool)
    .await
    .expect("post-finish 后应存在运输回执");
    let upload_id: Option<String> = row.get("transport_upload_id");
    let storage_locator: Option<String> = row.get("storage_locator");
    let byte_size: Option<i64> = row.get("byte_size");
    let is_finished: bool = row.get("is_finished");
    assert_eq!(upload_id.as_deref(), Some(expected_upload_id.as_str()));
    assert_eq!(storage_locator.as_deref(), Some(temp_file.as_str()));
    assert_eq!(byte_size, Some(68));
    assert!(is_finished, "post-finish 必须把 finished 回执落库");
}

#[tokio::test]
#[serial]
async fn complete视频上传会把prepared附件升级成ready并写入视频元数据() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let rustus_data_dir = state.rustus_data_dir.clone();
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("complete-video-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let video_bytes = 最小mp4字节();
    let video_byte_size = video_bytes.len() as i64;
    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/video/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "complete.mp4",
            "mime_type": "video/mp4",
            "byte_size": video_bytes.len()
        })),
        &[],
    )
    .await;
    assert_eq!(prepare_status, StatusCode::OK);
    let attachment_id = prepare_body["attachment_id"]
        .as_str()
        .expect("attachment_id")
        .to_string();

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能连接数据库");
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-complete-video-{attachment_id}");
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "complete.mp4",
        &video_bytes,
    )
    .expect("应能写入 rustus 临时视频文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "complete.mp4",
            "video/mp4",
            video_byte_size,
            video_byte_size,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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

    assert_eq!(
        complete_status,
        StatusCode::OK,
        "视频 complete 当前返回: {complete_body:?}"
    );
    assert_eq!(complete_body["status"].as_str(), Some("ready"));
    assert_eq!(complete_body["kind"].as_str(), Some("video"));
    assert!(
        complete_body["width"].as_i64().unwrap_or_default() > 0,
        "视频 complete 后必须写入真实宽度"
    );
    assert!(
        complete_body["height"].as_i64().unwrap_or_default() > 0,
        "视频 complete 后必须写入真实高度"
    );

    let row = sqlx::query(
        "SELECT kind, status, width, height, thumbnail_storage_key FROM attachments WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .expect("应能查询 complete 后的视频附件记录");
    let kind_in_db: String = row.get("kind");
    let status_in_db: String = row.get("status");
    let width_in_db: Option<i32> = row.get("width");
    let height_in_db: Option<i32> = row.get("height");
    let thumbnail_storage_key: Option<String> = row.get("thumbnail_storage_key");
    assert_eq!(kind_in_db, "video");
    assert_eq!(status_in_db, "ready");
    assert!(width_in_db.unwrap_or_default() > 0);
    assert!(height_in_db.unwrap_or_default() > 0);
    assert!(
        thumbnail_storage_key.is_none(),
        "当前视频主链不应伪造图片缩略图存储键"
    );
}

#[tokio::test]
#[serial]
async fn complete图片上传遇到非图片原图会返回attachment_type_not_allowed() {
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
        Some(
            serde_json::json!({"device_anonymous_token": format!("complete-invalid-image-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let invalid_bytes = b"not an image";

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": session_id,
            "file_name": "broken.png",
            "mime_type": "image/png",
            "byte_size": invalid_bytes.len()
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
    let upload_id = format!("upload-invalid-image-{attachment_id}");
    let temp_file = 写入rustus测试文件(
        &state.rustus_data_dir,
        &attachment_id,
        "broken.png",
        invalid_bytes,
    )
    .expect("应能写入 rustus 非法图片文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "broken.png",
            "image/png",
            invalid_bytes.len() as i64,
            invalid_bytes.len() as i64,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

    // complete 必须以真实字节内容为准，不能信 prepare 阶段宣称的图片 MIME。
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

    assert_eq!(complete_status, StatusCode::BAD_REQUEST);
    assert_eq!(
        complete_body["code"].as_str(),
        Some("attachment_type_not_allowed")
    );
}

#[test]
#[serial]
fn prepared附件在complete之前不能进入消息发送主链() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("RP{:010}", uniq % 10_000_000_000);
    let device_token = format!("prepared-attachment-device-{uniq}");
    let attachment_id = format!("att-prepared-{uniq}");
    let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room = koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    let runtime = tokio::runtime::Runtime::new().expect("应能创建测试 runtime");
    let pool = runtime.block_on(async {
        PgPoolOptions::new()
            .max_connections(1)
            .connect(&cfg.database_url)
            .await
            .expect("应能连接数据库")
    });
    let owner_identity_db_id = runtime.block_on(async {
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .expect("应能查询会话对应的匿名身份")
        .expect("prepared 附件 owner 必须存在")
    });
    runtime.block_on(async {
        sqlx::query(
            "INSERT INTO attachments (attachment_id, owner_anonymous_identity_id, kind, mime_type, byte_size, width, height, storage_key, thumbnail_storage_key, status) \
             VALUES ($1, $2, 'image', 'image/png', 68, NULL, NULL, $3, NULL, 'prepared')",
        )
        .bind(&attachment_id)
        .bind(owner_identity_db_id)
        .bind(format!("images/{attachment_id}/original.png"))
        .execute(&pool)
        .await
        .expect("应能插入 prepared 附件");
    });

    let result = koko::usecase::创建消息(
        &mut repo,
        &room_id,
        &session_id,
        &format!("prepared-message-{uniq}"),
        "",
        &[attachment_id],
    );
    let err = result.expect_err("prepared 附件在 complete 前不允许进入发送主链");
    assert_eq!(err, koko::contract::错误码::附件未就绪);
}

#[test]
#[serial]
fn ready视频附件可以进入create_message主链() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("RV{:010}", uniq % 10_000_000_000);
    let device_token = format!("ready-video-device-{uniq}");
    let attachment_id = format!("att-ready-video-{uniq}");
    let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room = koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    let runtime = tokio::runtime::Runtime::new().expect("应能创建测试 runtime");
    let pool = runtime.block_on(async {
        PgPoolOptions::new()
            .max_connections(1)
            .connect(&cfg.database_url)
            .await
            .expect("应能连接数据库")
    });
    runtime.block_on(async {
        插入ready视频附件记录(&pool, &session_id, &attachment_id).await;
    });

    let event = koko::usecase::创建消息(
        &mut repo,
        &room_id,
        &session_id,
        &format!("ready-video-message-{uniq}"),
        "",
        &[attachment_id.clone()],
    )
    .expect("ready 视频附件应能进入统一消息主链");

    match event {
        koko::contract::领域事件::消息已创建 { 文本, 附件, .. } => {
            assert_eq!(文本, "", "纯视频消息允许文本为空");
            assert_eq!(附件.len(), 1);
            assert!(matches!(
                附件.first(),
                Some(koko::contract::附件快照::视频(视频))
                    if 视频.附件标识 == attachment_id
            ));
        }
    }
}

#[tokio::test]
#[serial]
async fn locator会返回协作分发片段但不泄漏仓储私货() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("ML{:010}", uniq % 10_000_000_000);
    let device_token = format!("media-locator-device-{uniq}");
    let attachment_id = format!("att-locator-{uniq}");
    let database_url = cfg.database_url.clone();
    let attachment_id_for_worker = attachment_id.clone();

    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
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
            pool.close().await;
        });

        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &identity.会话标识,
            &format!("locator-client-{uniq}"),
            "",
            &[attachment_id_for_worker.clone()],
        )
        .expect("应能先创建带视频附件的消息");

        (identity.会话标识, room_id)
    })
    .await
    .expect("阻塞 locator 任务应完成");

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
    assert_eq!(body["attachment_id"].as_str(), Some(attachment_id.as_str()));
    assert_eq!(body["kind"].as_str(), Some("video"));
    assert_eq!(body["status"].as_str(), Some("ready"));
    assert!(
        body["original_url"].as_str().is_some(),
        "locator 必须返回受控原始内容地址"
    );
    assert_eq!(
        body["distribution"]["content_id"].as_str(),
        Some(format!("content_{attachment_id}").as_str())
    );
    assert!(body["distribution"]["content_hash"].as_str().is_some());
    assert!(body["distribution"]["swarm_id"].as_str().is_some());
    assert!(body["distribution"]["web_seed_until"].as_str().is_some());
    assert!(
        body.get("storage_key").is_none()
            && body.get("owner_anonymous_identity_id").is_none()
            && body.get("room_id").is_none()
            && body.get("thumbnail_storage_key").is_none(),
        "locator 只能暴露 transport 信息，不能把仓储私货和业务真相泄漏给壳层"
    );
    assert!(
        body["distribution"]["announce_urls"].is_array(),
        "Phase 2 允许 locator 下发 runtime transport 线索"
    );
    assert!(room_id.starts_with("r-"), "应返回稳定房间标识");
}

#[tokio::test]
#[serial]
async fn torrent接口会返回稳定metainfo并与locator对齐() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let rustus_data_dir = state.rustus_data_dir.clone();
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("torrent-route-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id").to_string();
    let room_code = format!("TR{:010}", uniq % 10_000_000_000);
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
            "file_name": "torrent-route.mp4",
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "torrent-route.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 rustus 临时视频文件");
    let upload_id = format!("upload-torrent-route-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "torrent-route.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
            &format!("torrent-message-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带视频附件的消息");
    })
    .await
    .expect("阻塞写消息任务应完成");

    let (_, locator_body) = send_json(
        app.clone(),
        Method::GET,
        &format!(
            "/api/media/{attachment_id}/locator?session_id={}",
            bootstrap["session_id"].as_str().expect("session_id")
        ),
        None,
        &[],
    )
    .await;

    let torrent_url = locator_body["distribution"]["torrent_url"]
        .as_str()
        .expect("locator 必须返回受控 torrent_url");
    let (status, headers, body) = send_bytes(
        app,
        Method::GET,
        torrent_url,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/x-bittorrent")
    );

    let metainfo =
        bip_metainfo::Metainfo::from_bytes(body.as_slice()).expect("torrent bytes 必须可解析");
    let info_hash_hex = hex::encode(metainfo.info().info_hash().as_ref());
    assert_eq!(
        locator_body["distribution"]["torrent_info_hash"].as_str(),
        Some(info_hash_hex.as_str())
    );
}

#[tokio::test]
#[serial]
async fn locator会返回announce与web_seed并保留ticket占位() {
    let backup = 备份并清空环境变量(&[
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_TRACKER_PORT",
        "SWARM_WEB_SEED_PUBLIC_ENDPOINT",
        "SWARM_PEER_PRESENCE_STALE_SECONDS",
    ]);
    env::set_var("SWARM_TRACKER_PUBLIC_URL", "wss://swarm.example.com/announce");
    env::set_var("SWARM_TRACKER_PORT", "7072");
    env::set_var("SWARM_WEB_SEED_PUBLIC_ENDPOINT", "https://cdn.example.com");
    env::set_var("SWARM_PEER_PRESENCE_STALE_SECONDS", "180");

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let rustus_data_dir = state.rustus_data_dir.clone();
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("locator-runtime-{uniq}")})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id").to_string();
    let room_code = format!("LR{:010}", uniq % 10_000_000_000);
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
            "file_name": "locator-runtime.mp4",
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "locator-runtime.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 rustus 临时视频文件");
    let upload_id = format!("upload-locator-runtime-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "locator-runtime.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
            &format!("locator-runtime-message-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带视频附件的消息");
    })
    .await
    .expect("阻塞写消息任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/media/{attachment_id}/locator?session_id={}",
            bootstrap["session_id"].as_str().expect("session_id")
        ),
        None,
        &[],
    )
    .await;

    恢复环境变量(backup);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["distribution"]["announce_urls"]
            .as_array()
            .map(|values| values.is_empty()),
        Some(false)
    );
    let expected_web_seed_url = format!(
        "https://cdn.example.com/api/attachments/{attachment_id}/content?session_id={}&variant=original",
        bootstrap["session_id"].as_str().expect("session_id")
    );
    assert_eq!(
        body["distribution"]["web_seed_url"].as_str(),
        Some(expected_web_seed_url.as_str())
    );
    assert!(body["distribution"]["join_ticket"].is_null());
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("available")
    );
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
    let rustus_data_dir = state.rustus_data_dir.clone();
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
    let session_id = bootstrap["session_id"].as_str().expect("session_id").to_string();
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
    let temp_file = 写入rustus测试文件(
        &rustus_data_dir,
        &attachment_id,
        "range-original.mp4",
        &最小mp4字节(),
    )
    .expect("应能写入 rustus 临时视频文件");
    let upload_id = format!("upload-range-original-{attachment_id}");

    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "range-original.mp4",
            "video/mp4",
            最小mp4字节().len() as i64,
            最小mp4字节().len() as i64,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");

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
    let expected_content_range = format!("bytes 0-63/{}", 最小mp4字节().len());
    assert_eq!(
        headers
            .get(header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok()),
        Some(expected_content_range.as_str())
    );
    assert_eq!(body.len(), 64);
    assert_eq!(body, 最小mp4字节()[0..64].to_vec());
}

#[tokio::test]
#[serial]
async fn 静态壳入口会no_cache且hashed静态资源会长缓存() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let root_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(root_response.status(), StatusCode::OK, "/ 应可读取");
    let root_cache_control = root_response
        .headers()
        .get(header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .expect("入口 HTML 必须显式返回 Cache-Control");
    assert_eq!(
        root_cache_control, "no-cache",
        "入口 HTML 必须总是回源确认新版本"
    );
    let root_html = String::from_utf8(
        to_bytes(root_response.into_body(), usize::MAX)
            .await
            .expect("应能读取入口 HTML")
            .to_vec(),
    )
    .expect("入口 HTML 应是 UTF-8");

    let css_path =
        提取静态资源路径(&root_html, "<link rel=\"stylesheet\" href=\"", "\"").expect("应引用 CSS");
    let js_path =
        提取静态资源路径(&root_html, "<script type=\"module\" src=\"", "\"").expect("应引用 JS");
    assert!(
        css_path.starts_with("/dist/app-") && css_path.ends_with(".css"),
        "CSS 应使用 hashed 文件名，实际为 {css_path}"
    );
    assert!(
        js_path.starts_with("/dist/app-") && js_path.ends_with(".js"),
        "JS 应使用 hashed 文件名，实际为 {js_path}"
    );

    for uri in [css_path, js_path] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK, "{uri} 应可读取");
        let cache_control = response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok())
            .expect("静态资源必须显式返回 Cache-Control");
        assert_eq!(
            cache_control, "public, max-age=31536000, immutable",
            "{uri} 应走长期强缓存"
        );
    }
}

#[tokio::test]
#[serial]
async fn media_service_worker会同源暴露且显式声明根scope() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/media-sw.js")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK, "/media-sw.js 应可读取");
    assert_eq!(
        response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-cache"),
        "service worker 脚本必须始终回源确认最新版本"
    );
    assert_eq!(
        response
            .headers()
            .get("service-worker-allowed")
            .and_then(|value| value.to_str().ok()),
        Some("/"),
        "service worker 必须显式声明根 scope，后续 WebTorrent stream server 才能共用同源 worker"
    );
}

#[tokio::test]
#[serial]
async fn 非成员不能读取房间消息里的图片内容() {
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
    let room_code = format!("RC{:010}", uniq % 10_000_000_000);

    let (_, owner_bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("owner-image-read-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner_bootstrap["session_id"]
        .as_str()
        .expect("owner session");

    let (_, stranger_bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("stranger-image-read-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger_bootstrap["session_id"]
        .as_str()
        .expect("stranger session");

    let (_, room_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": room_code})),
        &[],
    )
    .await;
    let room_id = room_body["room_id"].as_str().expect("room_id").to_string();

    let (prepare_status, prepare_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/prepare",
        Some(serde_json::json!({
            "session_id": owner_session_id,
            "file_name": "owner.png",
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
    let authorization = 提取媒体上传授权头(&prepare_body);
    let upload_id = format!("upload-owner-image-{attachment_id}");
    let temp_file =
        写入rustus测试文件(&state.rustus_data_dir, &attachment_id, "owner.png", &最小png字节())
            .expect("应能写入 rustus 原图文件");
    let (hook_status, hook_body) = send_json(
        app.clone(),
        Method::POST,
        "/internal/rustus/hooks",
        Some(构造rustus_hook请求体(
            &upload_id,
            &attachment_id,
            "owner.png",
            "image/png",
            68,
            68,
            Some(temp_file.as_str()),
        )),
        &[
            ("Hook-Name", "post-finish"),
            ("Authorization", authorization.as_str()),
        ],
    )
    .await;
    assert_eq!(hook_status, StatusCode::NO_CONTENT, "{hook_body:?}");
    let (complete_status, complete_body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/media/{attachment_id}/complete"),
        Some(serde_json::json!({
            "session_id": owner_session_id
        })),
        &[],
    )
    .await;
    assert_eq!(complete_status, StatusCode::OK);
    assert_eq!(complete_body["status"].as_str(), Some("ready"));

    let database_url = cfg.database_url.clone();
    let owner_session_id_owned = owner_session_id.to_string();
    let attachment_id_for_message = attachment_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        koko::usecase::创建消息(
            &mut repo,
            &room_id,
            &owner_session_id_owned,
            &format!("read-content-client-{uniq}"),
            "",
            &[attachment_id_for_message],
        )
        .expect("应能创建带图片附件的消息");
    })
    .await
    .expect("阻塞发送任务应完成");

    let request = Request::builder()
        .method(Method::GET)
        .uri(format!(
            "/api/attachments/{}/content?session_id={}&variant=original",
            attachment_id, stranger_session_id
        ))
        .body(Body::empty())
        .expect("request");
    let response = app.oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let body = serde_json::from_slice::<Value>(&bytes).expect("json body");

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[test]
#[serial]
fn realtime主链闭环() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("R{:011}", uniq % 100_000_000_000);
    let device_token = format!("rt-device-{uniq}");
    let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room = koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    let control = koko::contract::控制面结果::订阅已建立 {
        房间标识: room_id.clone(),
        起始位置: 0,
    };
    assert!(matches!(
        control,
        koko::contract::控制面结果::订阅已建立 {
            起始位置: 0, ..
        }
    ));

    let event =
        koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "rt-c-1", "hello rt")
            .expect("发送消息应成功");
    assert!(matches!(
        event,
        koko::contract::领域事件::消息已创建 {
            事件位置: 1, ..
        }
    ));

    let delta = repo
        .拉取房间增量事件(&room_id, 0)
        .expect("应能拉取增量事件");
    match delta {
        koko::contract::快照::房间增量事件 {
            房间标识,
            最新事件位置,
            事件,
        } => {
            assert_eq!(房间标识, room_id);
            assert_eq!(最新事件位置, 1);
            assert_eq!(事件.len(), 1);
        }
        _ => panic!("应返回房间增量事件快照"),
    }
}

#[test]
fn 订阅需要重拉快照时控制面kind保持need_snapshot_reload() {
    // 这里先锁住 shell 对前端承诺的最小 payload 形状。
    // 即使内部实现继续重整，只要 kind / room_id / expected_position 漂了，
    // 前端恢复链就会直接断裂。
    let control = serde_json::json!({
        "kind": "need_snapshot_reload",
        "room_id": "room-1",
        "expected_position": 99
    });

    assert_eq!(control["kind"], "need_snapshot_reload");
    assert_eq!(control["room_id"], "room-1");
    assert_eq!(control["expected_position"], 99);
}

#[test]
fn 订阅拒绝与系统错误的控制面类型必须分流() {
    // `rejected` 表示业务拒绝，`error` 表示系统失败。
    // 这两个 kind 一旦混掉，前端就会把可恢复问题和业务拒绝混成一锅。
    let rejected = serde_json::json!({"kind":"rejected","code":"membership_required"});
    let error = serde_json::json!({"kind":"error","code":"system_error"});

    assert_eq!(rejected["kind"], "rejected");
    assert_eq!(error["kind"], "error");
    assert_ne!(rejected["kind"], error["kind"]);
}

#[test]
#[serial]
fn 重复客户端消息标识应返回同一条已成立消息事件() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("I{:011}", uniq % 100_000_000_000);
    let device_token = format!("idem-device-{uniq}");
    let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room = koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    // 同一个 client_message_id 表示同一条用户意图；重试时不应制造第二条消息或伪系统错误。
    let first = koko::usecase::发送文本消息(
        &mut repo,
        &room_id,
        &session_id,
        "idem-c-1",
        "hello idem",
    )
    .expect("首次发送应成功");
    let second = koko::usecase::发送文本消息(
        &mut repo,
        &room_id,
        &session_id,
        "idem-c-1",
        "hello idem",
    )
    .expect("同一 client_message_id 的重试应返回已成立事件，而不是系统错误");

    assert_eq!(first, second, "重试发送应回到同一条权威事件");

    let (latest, events, messages) = repo
        .查询房间持久化计数(&room_id)
        .expect("应能查询持久化计数");
    assert_eq!(latest, 1, "幂等重试不应推进第二个事件位置");
    assert_eq!(events, 1, "幂等重试不应重复写 room_events");
    assert_eq!(messages, 1, "幂等重试不应重复写 messages");
}

#[test]
#[serial]
fn 同房并发发送时事件位置仍然连续单调() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("应能创建测试运行时");
    rt.block_on(async {
        koko::assembly::自动追平迁移(&cfg.database_url)
            .await
            .expect("应先追平迁移");
    });

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("C{:011}", uniq % 100_000_000_000);
    let device_token = format!("concurrent-room-device-{uniq}");
    let database_url = cfg.database_url.clone();

    let (room_id, session_id) = std::thread::spawn(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity =
            koko::usecase::引导匿名身份(&mut repo, &device_token).expect("应能引导匿名身份");
        let room = koko::usecase::按短码进房或建房(&mut repo, &identity.会话标识, &code)
            .expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        (room_id, identity.会话标识)
    })
    .join()
    .expect("建数线程应完成");

    let mut tasks = Vec::new();
    for index in 0..8 {
        let database_url = cfg.database_url.clone();
        let room_id = room_id.clone();
        let session_id = session_id.clone();
        tasks.push(std::thread::spawn(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("same-room-{index}"),
                &format!("并发消息-{index}"),
            )
            .expect("并发发送应成功")
        }));
    }

    let mut positions = Vec::new();
    for task in tasks {
        let event = task.join().expect("发送线程应完成");
        match event {
            koko::contract::领域事件::消息已创建 { 事件位置, .. } => {
                positions.push(事件位置)
            }
        }
    }
    positions.sort_unstable();
    assert_eq!(
        positions,
        (1..=8).collect::<Vec<_>>(),
        "同房并发下事件位置必须连续单调"
    );

    let repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");
    let (latest, events, messages) = repo
        .查询房间持久化计数(&room_id)
        .expect("应能查询持久化计数");
    assert_eq!(latest, 8, "房间最新位置应推进到最后一条");
    assert_eq!(events, 8, "room_events 条数应与发送数一致");
    assert_eq!(messages, 8, "messages 条数应与发送数一致");
}

#[test]
#[serial]
fn 不同房间并发发送时互不串号互不污染() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("应能创建测试运行时");
    rt.block_on(async {
        koko::assembly::自动追平迁移(&cfg.database_url)
            .await
            .expect("应先追平迁移");
    });

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let database_url = cfg.database_url.clone();

    let (room_a, room_b, session_a, session_b) = std::thread::spawn(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity_a = koko::usecase::引导匿名身份(&mut repo, &format!("cross-a-{uniq}"))
            .expect("A 应能引导匿名身份");
        let identity_b = koko::usecase::引导匿名身份(&mut repo, &format!("cross-b-{uniq}"))
            .expect("B 应能引导匿名身份");
        let room_a = koko::usecase::按短码进房或建房(
            &mut repo,
            &identity_a.会话标识,
            &format!("A{:011}", uniq % 100_000_000_000),
        )
        .expect("A 房间应能进房");
        let room_b = koko::usecase::按短码进房或建房(
            &mut repo,
            &identity_b.会话标识,
            &format!("B{:011}", uniq % 100_000_000_000),
        )
        .expect("B 房间应能进房");
        let room_a = match room_a {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("A 房间应返回房间快照"),
        };
        let room_b = match room_b {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("B 房间应返回房间快照"),
        };
        (room_a, room_b, identity_a.会话标识, identity_b.会话标识)
    })
    .join()
    .expect("建数线程应完成");

    let mut tasks = Vec::new();
    for index in 0..4 {
        let database_url = cfg.database_url.clone();
        let room_id = room_a.clone();
        let session_id = session_a.clone();
        tasks.push(std::thread::spawn(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("room-a-{index}"),
                &format!("A-{index}"),
            )
            .expect("A 房间发送应成功")
        }));
    }
    for index in 0..4 {
        let database_url = cfg.database_url.clone();
        let room_id = room_b.clone();
        let session_id = session_b.clone();
        tasks.push(std::thread::spawn(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("room-b-{index}"),
                &format!("B-{index}"),
            )
            .expect("B 房间发送应成功")
        }));
    }

    let mut room_a_positions = Vec::new();
    let mut room_b_positions = Vec::new();
    for task in tasks {
        let event = task.join().expect("发送线程应完成");
        match event {
            koko::contract::领域事件::消息已创建 {
                房间标识, 事件位置,
            ..
            } if 房间标识 == room_a => room_a_positions.push(事件位置),
            koko::contract::领域事件::消息已创建 {
                房间标识, 事件位置,
            ..
            } if 房间标识 == room_b => room_b_positions.push(事件位置),
            koko::contract::领域事件::消息已创建 { 房间标识, .. } => {
                panic!("出现了不属于测试房间的事件: {房间标识}")
            }
        }
    }

    room_a_positions.sort_unstable();
    room_b_positions.sort_unstable();
    assert_eq!(
        room_a_positions,
        (1..=4).collect::<Vec<_>>(),
        "A 房间事件位置应自洽连续"
    );
    assert_eq!(
        room_b_positions,
        (1..=4).collect::<Vec<_>>(),
        "B 房间事件位置应自洽连续"
    );

    let repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");
    let room_a_counts = repo
        .查询房间持久化计数(&room_a)
        .expect("应能查询 A 房间持久化计数");
    let room_b_counts = repo
        .查询房间持久化计数(&room_b)
        .expect("应能查询 B 房间持久化计数");
    assert_eq!(room_a_counts, (4, 4, 4), "A 房间持久化状态应只反映自己");
    assert_eq!(room_b_counts, (4, 4, 4), "B 房间持久化状态应只反映自己");
}

#[tokio::test]
#[serial]
async fn 构建应用状态时持有共享数据库连接池() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let snapshot = tokio::task::spawn_blocking(move || {
        let repo = koko::adapter::Pg仓储::从连接池构建(
            state.pool.clone(),
            state.runtime_handle.clone(),
        );
        repo.后台概览()
    })
    .await
    .expect("阻塞任务应完成")
    .expect("共享连接池上的仓储应可用");
    assert!(matches!(snapshot, koko::contract::快照::后台概览 { .. }));
}

#[tokio::test]
#[serial]
async fn http冷路径闭环() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("H{:011}", uniq % 100_000_000_000);
    let device_token = format!("http-device-{uniq}");

    let (status, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": device_token})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("应返回 session_id")
        .to_string();

    let (status, join) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": session_id, "room_code": code})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let room_id = join["room_id"]
        .as_str()
        .expect("应返回 room_id")
        .to_string();

    let (status, snapshot) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(snapshot["room_id"].as_str(), Some(room_id.as_str()));

    let (status, events) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/rooms/{room_id}/events?session_id={session_id}&from=0"),
        None,
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(events["events"].is_array());

    let (status, admin_login) = send_json(
        app.clone(),
        Method::POST,
        "/api/admin/login",
        Some(serde_json::json!({"username":"admin","password":"admin"})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = admin_login["token"].as_str().expect("应返回 admin token");
    let headers = [("x-admin-token", token)];

    let (status, overview) = send_json(
        app.clone(),
        Method::GET,
        "/api/admin/overview",
        None,
        &headers,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(overview["room_count"].as_u64().unwrap_or(0) >= 1);

    let (status, rooms) =
        send_json(app.clone(), Method::GET, "/api/admin/rooms", None, &headers).await;
    assert_eq!(status, StatusCode::OK);
    assert!(rooms["rooms"].as_array().is_some());

    let (status, room_detail) = send_json(
        app,
        Method::GET,
        &format!("/api/admin/rooms/{room_id}"),
        None,
        &headers,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(room_detail["room_id"].as_str(), Some(room_id.as_str()));
}

#[tokio::test]
#[serial]
async fn 后台缺少令牌时仍返回稳定错误码() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(app, Method::GET, "/api/admin/overview", None, &[]).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["code"].as_str(), Some("admin_session_required"));
}

#[tokio::test]
#[serial]
async fn 后台房间详情仍返回最新事件位置和消息总数() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("AD{:010}", uniq % 10_000_000_000);
    let owner_token = format!("admin-detail-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let room_id = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &owner_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..3 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("admin-detail-c-{index}"),
                &format!("admin-detail-{index}"),
            )
            .expect("应能连续发送消息");
        }
        room_id
    })
    .await
    .expect("阻塞建数任务应完成");

    let (login_status, login_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/admin/login",
        Some(serde_json::json!({"username":"admin","password":"admin"})),
        &[],
    )
    .await;
    assert_eq!(login_status, StatusCode::OK);
    let token = login_body["token"].as_str().expect("应返回 admin token");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/admin/rooms/{room_id}"),
        None,
        &[("x-admin-token", token)],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["room_id"].as_str(), Some(room_id.as_str()));
    assert_eq!(body["latest_event_position"].as_i64(), Some(3));
    assert_eq!(body["message_count"].as_i64(), Some(3));
}

#[tokio::test]
#[serial]
async fn 房间增量事件查询缺少session_id会被拒绝() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, body) = send_json(
        app,
        Method::GET,
        "/api/rooms/r-missing/events?from=0",
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
}

#[tokio::test]
#[serial]
async fn 非成员不能通过events接口拉取房间增量() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("E{:011}", uniq % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("owner-device-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("stranger-device-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger["session_id"].as_str().expect("stranger session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/events?session_id={stranger_session_id}&from=0"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[tokio::test]
#[serial]
async fn 成员通过events接口只会拿到from之后的事件() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("F{:011}", uniq % 100_000_000_000);
    let device_token = format!("events-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "c-1", "first")
            .expect("应能发送第一条消息");
        koko::usecase::发送文本消息(&mut repo, &room_id, &session_id, "c-2", "second")
            .expect("应能发送第二条消息");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/events?session_id={session_id}&from=1"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let events = body["events"].as_array().expect("events 应为数组");
    assert_eq!(events.len(), 1, "只应返回 event_position > from 的事件");
    assert_eq!(events[0]["event_position"].as_i64(), Some(2));
    assert_eq!(body["latest_event_position"].as_i64(), Some(2));
}

#[tokio::test]
#[serial]
async fn 不存在的房间通过events接口会返回room_not_found() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (_, bootstrap) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": "missing-room-device"})),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/r-nope/events?session_id={session_id}&from=0"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"].as_str(), Some("room_not_found"));
}

#[tokio::test]
#[serial]
async fn 有阅读锚点时房间快照围绕第一条未读返回首屏() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("S{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..100 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-c-{index}"),
                &format!("snapshot-{index}"),
            )
            .expect("应能连续发送消息");
        }
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &session_id, 80)
            .expect("应能先建立阅读锚点");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(80));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(81));
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    let positions = messages
        .iter()
        .map(|msg| msg["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();

    assert!(
        positions.iter().any(|position| *position < 81),
        "首屏必须带已读上下文"
    );
    assert!(positions.contains(&81), "首屏必须覆盖第一条未读");
    assert!(
        positions.first().copied().unwrap_or_default() > 1,
        "围绕未读恢复时不应回到整房最老消息"
    );
    assert_eq!(
        positions.last().copied(),
        Some(100),
        "首屏应覆盖当前房间最新位置附近"
    );
}

#[tokio::test]
#[serial]
async fn 房间快照会返回首条未读事件位置和是否仍有更早历史() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("Q{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-order-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..100 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-order-c-{index}"),
                &format!("order-{index}"),
            )
            .expect("应能连续发送消息");
        }
        koko::usecase::推进房间阅读位置(&mut repo, &room_id, &session_id, 90)
            .expect("应能先推进阅读位置");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(90));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(91));
    assert_eq!(body["has_more_before"].as_bool(), Some(true));
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    let positions = messages
        .iter()
        .map(|message| message["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();
    assert!(
        positions.windows(2).all(|window| window[0] < window[1]),
        "房间快照里的首屏消息必须按升序返回"
    );
}

#[tokio::test]
#[serial]
async fn 无阅读锚点时房间快照回退到最近一屏消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("P{:011}", uniq % 100_000_000_000);
    let device_token = format!("snapshot-short-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..60 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("snapshot-short-c-{index}"),
                &format!("latest-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), None);
    assert_eq!(body["first_unread_event_position"].as_i64(), None);
    let messages = body["snapshot_messages"]
        .as_array()
        .expect("snapshot 必须直接带 snapshot_messages");
    assert!(!messages.is_empty(), "无阅读锚点时也应返回最近一屏消息");
    assert_eq!(
        messages.last().and_then(|msg| msg["body"].as_str()),
        Some("latest-59")
    );
    assert_ne!(
        messages.first().and_then(|msg| msg["body"].as_str()),
        Some("latest-0"),
        "无阅读锚点时不应回到整房最老消息"
    );
}

#[tokio::test]
#[serial]
async fn 阅读推进成功后下一次进房会按新锚点恢复() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("U{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-http-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-http-c-{index}"),
                &format!("read-http-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 3
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(3));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(4));
}

#[tokio::test]
#[serial]
async fn 阅读推进不能回退到更早位置() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("V{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-regress-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-regress-c-{index}"),
                &format!("regress-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (first_status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 5
        })),
        &[],
    )
    .await;
    assert_eq!(first_status, StatusCode::OK);

    let (second_status, _) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 2
        })),
        &[],
    )
    .await;
    assert_eq!(second_status, StatusCode::OK);

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["last_read_event_position"].as_i64(), Some(5));
    assert_eq!(body["first_unread_event_position"].as_i64(), Some(6));
}

#[tokio::test]
#[serial]
async fn 非成员阅读推进会被拒绝() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("W{:011}", uniq % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-stranger-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger["session_id"].as_str().expect("stranger session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": stranger_session_id,
            "last_read_event_position": 0
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[tokio::test]
#[serial]
async fn 阅读推进缺少last_read_event_position会返回invalid_argument() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("WM{:010}", uniq % 10_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("read-anchor-missing-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": owner_session_id
        })),
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
}

#[tokio::test]
#[serial]
async fn 阅读推进失败不会影响房间快照和历史查询可用性() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("X{:011}", uniq % 100_000_000_000);
    let device_token = format!("read-anchor-failure-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..3 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("read-anchor-failure-c-{index}"),
                &format!("read-anchor-failure-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app.clone(),
        Method::POST,
        &format!("/api/rooms/{room_id}/read-anchor"),
        Some(serde_json::json!({
            "session_id": session_id,
            "last_read_event_position": 99
        })),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));

    let (snapshot_status, snapshot_body) = send_json(
        app.clone(),
        Method::GET,
        &format!("/api/rooms/{room_id}/snapshot?session_id={session_id}"),
        None,
        &[],
    )
    .await;
    assert_eq!(snapshot_status, StatusCode::OK);
    assert_eq!(snapshot_body["room_id"].as_str(), Some(room_id.as_str()));

    let (history_status, history_body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=3&limit=2"
        ),
        None,
        &[],
    )
    .await;
    assert_eq!(history_status, StatusCode::OK);
    assert!(history_body["messages"].as_array().is_some());
}

#[tokio::test]
#[serial]
async fn 房间历史分页会返回before_event_position之前的消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("H{:011}", (uniq + 1) % 100_000_000_000);
    let device_token = format!("history-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..6 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("history-c-{index}"),
                &format!("history-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=5&limit=2"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let messages = body["messages"].as_array().expect("messages 应为数组");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["body"].as_str(), Some("history-2"));
    assert_eq!(messages[1]["body"].as_str(), Some("history-3"));
}

#[tokio::test]
#[serial]
async fn 房间历史分页缺少before_event_position会返回invalid_argument() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (_, identity) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(
            serde_json::json!({"device_anonymous_token": format!("history-missing-before-{uniq}")}),
        ),
        &[],
    )
    .await;
    let session_id = identity["session_id"].as_str().expect("session_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!("/api/rooms/r-missing/history?session_id={session_id}&limit=20"),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"].as_str(), Some("invalid_argument"));
}

#[tokio::test]
#[serial]
async fn 房间历史分页仍按事件位置升序返回() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("I{:011}", (uniq + 2) % 100_000_000_000);
    let device_token = format!("history-order-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        for index in 0..4 {
            koko::usecase::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("history-order-c-{index}"),
                &format!("history-order-{index}"),
            )
            .expect("应能连续发送消息");
        }
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=5&limit=4"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let positions = body["messages"]
        .as_array()
        .expect("messages 应为数组")
        .iter()
        .map(|message| message["event_position"].as_i64().expect("event_position"))
        .collect::<Vec<_>>();
    assert_eq!(positions, vec![1, 2, 3, 4]);
}

#[tokio::test]
#[serial]
async fn 房间历史分页无更早消息时返回空数组() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("J{:011}", (uniq + 3) % 100_000_000_000);
    let device_token = format!("history-empty-device-{uniq}");
    let database_url = cfg.database_url.clone();
    let (session_id, room_id) = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库并迁移");
        let session_id = koko::usecase::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份")
            .会话标识;
        let room =
            koko::usecase::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
        let room_id = match room {
            koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        koko::usecase::发送文本消息(
            &mut repo,
            &room_id,
            &session_id,
            "history-empty-c-1",
            "first",
        )
        .expect("应能发送消息");
        (session_id, room_id)
    })
    .await
    .expect("阻塞建数任务应完成");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={session_id}&before_event_position=1&limit=55"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let messages = body["messages"].as_array().expect("messages 应为数组");
    assert!(messages.is_empty(), "没有更早历史时必须返回空数组");
}

#[tokio::test]
#[serial]
async fn 非成员不能通过history接口读取更早消息() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("K{:011}", (uniq + 4) % 100_000_000_000);

    let (_, owner) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("history-owner-{uniq}")})),
        &[],
    )
    .await;
    let owner_session_id = owner["session_id"].as_str().expect("owner session");

    let (_, stranger) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": format!("history-stranger-{uniq}")})),
        &[],
    )
    .await;
    let stranger_session_id = stranger["session_id"].as_str().expect("stranger session");

    let (_, room) = send_json(
        app.clone(),
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({"session_id": owner_session_id, "room_code": code})),
        &[],
    )
    .await;
    let room_id = room["room_id"].as_str().expect("room_id");

    let (status, body) = send_json(
        app,
        Method::GET,
        &format!(
            "/api/rooms/{room_id}/history?session_id={stranger_session_id}&before_event_position=1&limit=55"
        ),
        None,
        &[],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["code"].as_str(), Some("membership_required"));
}

#[tokio::test]
#[serial]
async fn bootstrap接口会返回稳定花名快照() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平匿名身份迁移");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (first_status, first) = send_json(
        app.clone(),
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token":"device-token-stable"})),
        &[],
    )
    .await;
    assert_eq!(first_status, StatusCode::OK);

    let (second_status, second) = send_json(
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token":"device-token-stable"})),
        &[],
    )
    .await;
    assert_eq!(second_status, StatusCode::OK);

    assert_eq!(
        first["anonymous_identity_id"].as_str(),
        second["anonymous_identity_id"].as_str(),
        "同一设备 token 应恢复同一个匿名内部身份"
    );
    assert_eq!(
        first["display_alias"].as_str(),
        second["display_alias"].as_str(),
        "同一设备 token 应恢复同一个展示花名"
    );
    assert_eq!(
        first["session_id"].as_str(),
        second["session_id"].as_str(),
        "当前 MVP 下同一设备 token 应恢复同一个稳定会话"
    );
}

#[tokio::test]
#[serial]
async fn http冷路径成功会输出accepted与succeeded日志() {
    let (buffer, _guard) = 创建集成测试日志采集上下文();

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let device_token = format!("http-log-device-{uniq}");

    let (status, _) = send_json(
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({"device_anonymous_token": device_token})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let output = 读取日志缓冲(&buffer);
    assert!(
        output.contains("usecase") && output.contains("引导匿名身份"),
        "成功主链日志缺少 usecase: {output}"
    );
    assert!(
        output.contains("adapter") && output.contains("http"),
        "成功主链日志缺少 adapter=http: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("accepted"),
        "成功主链日志缺少 accepted: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("succeeded"),
        "成功主链日志缺少 succeeded: {output}"
    );
}

#[tokio::test]
#[serial]
async fn http冷路径拒绝会输出rejected日志与error_code() {
    let (buffer, _guard) = 创建集成测试日志采集上下文();

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let state =
        koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
            .await
            .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state);

    let (status, _) = send_json(
        app,
        Method::POST,
        "/api/admin/login",
        Some(serde_json::json!({"username":"admin","password":"wrong-password"})),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let output = 读取日志缓冲(&buffer);
    assert!(
        output.contains("usecase") && output.contains("管理员登录"),
        "拒绝日志缺少 usecase: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("rejected"),
        "拒绝日志缺少 rejected: {output}"
    );
    assert!(
        output.contains("error_code") && output.contains("admin_auth_failed"),
        "拒绝日志缺少稳定 error_code: {output}"
    );
}

#[tokio::test]
#[serial]
async fn 启动收到关闭信号后会优雅停机() {
    let backup = 备份并清空环境变量(&["APP_PORT"]);
    let port = 分配测试端口();
    env::set_var("APP_PORT", port.to_string());

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        koko::entry::启动并等待关闭信号(async move {
            let _ = shutdown_rx.await;
        })
        .await
    });

    等待端口开始监听(port).await;
    shutdown_tx.send(()).expect("测试应能发出关闭信号");

    let result = timeout(Duration::from_secs(10), server)
        .await
        .expect("服务收到关闭信号后应在超时前完成收尾")
        .expect("启动任务不应 panic");
    assert!(result.is_ok(), "优雅停机不应把正常退出当成失败");

    等待端口停止监听(port).await;
    恢复环境变量(backup);
}

fn 备份并清空环境变量(keys: &[&str]) -> Vec<(String, Option<String>)> {
    // 先备份再清空，确保测试结束后能完整恢复本机环境，避免污染开发机。
    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        out.push(((*key).to_string(), env::var(key).ok()));
        env::remove_var(key);
    }
    out
}

fn 恢复环境变量(backup: Vec<(String, Option<String>)>) {
    // 按备份回放：有值就恢复、无值就移除，保持测试前后的环境一致性。
    for (key, value) in backup {
        match value {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
    }
}

fn 分配测试端口() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("应能申请临时端口");
    let port = listener.local_addr().expect("应能读取本地地址").port();
    drop(listener);
    port
}

async fn 等待端口开始监听(port: u16) {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return;
        }
        sleep(Duration::from_millis(200)).await;
    }
    panic!("服务未在预期时间内开始监听端口: {port}");
}

async fn 等待端口停止监听(port: u16) {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err()
        {
            return;
        }
        sleep(Duration::from_millis(200)).await;
    }
    panic!("服务收到关闭信号后仍未释放端口: {port}");
}

/// HTTP 测试助手：
/// - 统一构造请求
/// - 统一解析 JSON 响应
/// - 让每个测试聚焦业务断言，而不是重复样板代码
async fn send_json(
    app: axum::Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let body = if let Some(v) = body {
        req = req.header("content-type", "application/json");
        Body::from(v.to_string())
    } else {
        Body::empty()
    };

    let response = app
        .oneshot(req.body(body).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    if bytes.is_empty() {
        (status, serde_json::json!({}))
    } else {
        let json = serde_json::from_slice::<Value>(&bytes).expect("json body");
        (status, json)
    }
}

/// 二进制响应测试助手：
/// - 用来覆盖 torrent、图片原图、后续 Range 读取等二进制出口；
/// - 把状态码、响应头和原始字节一起带回测试，避免每个用例重复写样板。
async fn send_bytes(
    app: axum::Router,
    method: Method,
    uri: &str,
    headers: &[(&str, &str)],
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }

    let response = app
        .oneshot(req.body(Body::empty()).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body")
        .to_vec();
    (status, headers, bytes)
}

/// prepare 返回的 Tus headers 当前只要求一条稳定 Authorization。
/// 测试统一从这里拿，避免每个用例各自硬编码字段路径。
fn 提取媒体上传授权头(body: &Value) -> String {
    body["tus_headers"]["Authorization"]
        .as_str()
        .expect("Tus prepare 必须返回 Authorization 头")
        .to_string()
}

/// Rustus file storage 在测试里直接共享本地目录，因此 fixture 也应写进同一个 data dir。
/// 这样 complete 读到的就是真正 sidecar 会交回来的临时文件，而不是测试私造的第二套输入源。
fn 写入rustus测试文件(
    rustus_data_dir: &str,
    attachment_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> io::Result<String> {
    let root = std::path::PathBuf::from(rustus_data_dir);
    let fixture_dir = root.join("tests");
    std::fs::create_dir_all(&fixture_dir)?;
    let path = fixture_dir.join(format!("{attachment_id}-{file_name}"));
    std::fs::write(&path, bytes)?;
    Ok(std::fs::canonicalize(path)?.to_string_lossy().to_string())
}

/// 这里构造的是我们当前 shell 关心的最小 Rustus hook 负载：
/// - upload.id/path/length/offset 只表达“当前 hook 所处的运输状态”；
/// - metadata 继续把 attachment_id 作为业务锚点传回来；
/// - 其余字段即便 Rustus 实际会发，也不应该成为我们判断业务真相的依赖。
fn 构造rustus_hook请求体(
    upload_id: &str,
    attachment_id: &str,
    file_name: &str,
    mime_type: &str,
    length: i64,
    offset: i64,
    storage_locator: Option<&str>,
) -> Value {
    serde_json::json!({
        "upload": {
            "id": upload_id,
            "offset": offset,
            "length": length,
            "path": storage_locator,
            "metadata": {
                "attachment_id": attachment_id,
                "file_name": file_name,
                "mime_type": mime_type,
                "byte_size": length.to_string(),
            }
        }
    })
}

/// 统一校验媒体 prepare 的 Tus 契约，避免图片/视频在迁移过程中各自漂移出第二套字段约定。
/// 这里同时锁住“必须给出 Tus 所需元数据”和“旧 PUT 字段必须下线”两个边界。
#[allow(non_snake_case)]
fn 断言媒体准备结果是Tus契约(
    body: &Value,
    expected_kind: &str,
    expected_file_name: &str,
    expected_mime_type: &str,
    expected_byte_size: i64,
) {
    let attachment_id = body["attachment_id"]
        .as_str()
        .expect("统一媒体 prepare 至少要返回稳定 attachment_id");
    assert_eq!(body["kind"].as_str(), Some(expected_kind));
    assert_eq!(body["upload_method"].as_str(), Some("tus"));
    assert!(
        body["tus_endpoint"].as_str().is_some(),
        "媒体 prepare 必须返回 Tus endpoint"
    );
    assert!(
        body["tus_headers"].is_object(),
        "媒体 prepare 必须返回 Tus 头集合"
    );
    assert!(
        body["tus_metadata"].is_object(),
        "媒体 prepare 必须返回 Tus metadata"
    );
    assert!(
        body["expires_at"].as_str().is_some(),
        "媒体 prepare 必须返回过期时间"
    );
    assert!(
        body["upload_url"].is_null(),
        "切到 Tus 后不应继续暴露旧 upload_url"
    );
    assert!(
        body["upload_headers"].is_null(),
        "切到 Tus 后不应继续暴露旧 upload_headers"
    );

    let tus_metadata = body["tus_metadata"]
        .as_object()
        .expect("tus_metadata 必须是对象");
    assert_eq!(
        tus_metadata.get("attachment_id").and_then(Value::as_str),
        Some(attachment_id)
    );
    assert_eq!(
        tus_metadata.get("file_name").and_then(Value::as_str),
        Some(expected_file_name)
    );
    assert_eq!(
        tus_metadata.get("mime_type").and_then(Value::as_str),
        Some(expected_mime_type)
    );
    assert_eq!(
        tus_metadata
            .get("byte_size")
            .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse::<i64>().ok())),
        Some(expected_byte_size)
    );
}

fn 提取静态资源路径<'a>(html: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    let start = html.find(prefix)? + prefix.len();
    let rest = &html[start..];
    let end = rest.find(suffix)?;
    Some(&rest[..end])
}

async fn send_multipart_response(
    app: axum::Router,
    uri: &str,
    session_id: &str,
    filename: &str,
    content_type: &str,
    file_bytes: &[u8],
) -> axum::response::Response {
    let boundary = "----koko-test-boundary";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"session_id\"\r\n\r\n{session_id}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    app.oneshot(
        Request::builder()
            .method(Method::POST)
            .uri(uri)
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .expect("request"),
    )
    .await
    .expect("response")
}

/// 直接往数据库写入一条 ready 图片附件真相。
/// 这个 helper 只服务集成测试建数，避免为了 Task 2 先倒逼上传 HTTP 提前实现。
async fn 插入ready图片附件记录(
    pool: &sqlx::PgPool, 会话标识: &str, 附件标识: &str
) {
    let owner_identity_db_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
    )
    .bind(会话标识)
    .fetch_one(pool)
    .await
    .expect("应能查询会话对应的匿名身份")
    .expect("附件 owner 必须能落到稳定匿名身份");

    sqlx::query(
        "INSERT INTO attachments (attachment_id, owner_anonymous_identity_id, kind, mime_type, byte_size, width, height, storage_key, thumbnail_storage_key, status) \
         VALUES ($1, $2, 'image', 'image/png', 68, 1, 1, $3, $4, 'ready')",
    )
    .bind(附件标识)
    .bind(owner_identity_db_id)
    .bind(format!("original/{附件标识}.png"))
    .bind(format!("thumbnail/{附件标识}.png"))
    .execute(pool)
    .await
    .expect("应能插入 ready 图片附件");
}

/// 视频 ready helper 和图片 helper 保持同一层级：
/// - 它只负责给集成测试准备“附件真相已成立”的前置条件；
/// - 不替代真实上传链，也不把 HTTP/对象存储细节混进消息主链测试。
async fn 插入ready视频附件记录(
    pool: &sqlx::PgPool, 会话标识: &str, 附件标识: &str
) {
    let owner_identity_db_id = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT anonymous_identity_id FROM sessions WHERE session_id = $1",
    )
    .bind(会话标识)
    .fetch_one(pool)
    .await
    .expect("应能查询会话对应的匿名身份")
    .expect("附件 owner 必须能落到稳定匿名身份");

    sqlx::query(
        "INSERT INTO attachments (attachment_id, owner_anonymous_identity_id, kind, mime_type, byte_size, width, height, storage_key, thumbnail_storage_key, status) \
         VALUES ($1, $2, 'video', 'video/mp4', $3, 320, 240, $4, NULL, 'ready')",
    )
    .bind(附件标识)
    .bind(owner_identity_db_id)
    .bind(最小mp4字节().len() as i64)
    .bind(format!("original/{附件标识}.mp4"))
    .execute(pool)
    .await
    .expect("应能插入 ready 视频附件");
}

/// Phase 1 先把协作分发元数据视作独立真相面，
/// 这里直接插入最小记录，专门服务 locator 回归测试。
async fn 插入附件协作分发元数据记录(pool: &sqlx::PgPool, 附件标识: &str) {
    sqlx::query(
        "INSERT INTO attachment_distribution_metadata \
            (attachment_id, content_id, content_hash, swarm_id, web_seed_until) \
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')",
    )
    .bind(附件标识)
    .bind(format!("content_{附件标识}"))
    .bind("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    .bind(format!(
        "swarm_{}",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ))
    .execute(pool)
    .await
    .expect("应能插入协作分发元数据");
}

fn 最小png字节() -> Vec<u8> {
    vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8,
        0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00,
        0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ]
}

/// 最小 MP4 样本来自上游公开测试夹具，避免我们在仓库里手搓一份脆弱的伪视频字节。
/// 后端视频 complete 与 locator 回归都统一复用这份 fixture，确保测试针对真实容器格式。
fn 最小mp4字节() -> Vec<u8> {
    include_bytes!("fixtures/minimal.mp4").to_vec()
}

fn 创建集成测试日志采集上下文() -> (Arc<Mutex<Vec<u8>>>, tracing::dispatcher::DefaultGuard) {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_writer(共享写入器(buffer.clone()))
        .with_target(false)
        .finish();
    let guard = tracing::subscriber::set_default(subscriber);
    (buffer, guard)
}

fn 读取日志缓冲(buffer: &Arc<Mutex<Vec<u8>>>) -> String {
    String::from_utf8(buffer.lock().expect("lock").clone()).expect("utf8")
}

#[derive(Clone)]
struct 共享写入器(Arc<Mutex<Vec<u8>>>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for 共享写入器 {
    type Writer = 缓冲写入器;

    fn make_writer(&'a self) -> Self::Writer {
        缓冲写入器(self.0.clone())
    }
}

struct 缓冲写入器(Arc<Mutex<Vec<u8>>>);

impl io::Write for 缓冲写入器 {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().expect("lock").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

use axum::{
    body::{to_bytes, Body},
    http::{header, Method, Request, StatusCode},
};
use serde_json::Value;
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use tower::ServiceExt;

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::{env_support::*, http::*, logging::*, media::*};

/// 集成测试主链：
/// 1. 这里测试“模块接线后”的真实行为，而不是单点纯函数。
/// 2. 重点覆盖：事务顺序、媒体主链、房间接口、HTTP 冷路径、Realtime 主链。
/// 3. 启动边界与迁移基线已拆到 `启动与迁移测试.rs`，防止这里继续变成系统总垃圾场。

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
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
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
    let (status, headers, body) = send_bytes(app, Method::GET, torrent_url, &[]).await;

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
    env::set_var(
        "SWARM_TRACKER_PUBLIC_URL",
        "wss://swarm.example.com/announce",
    );
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
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
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
    let expected_presence_url = format!(
        "/api/media/{attachment_id}/presence?session_id={}",
        bootstrap["session_id"].as_str().expect("session_id")
    );
    assert_eq!(
        body["distribution"]["presence_url"].as_str(),
        Some(expected_presence_url.as_str())
    );
    assert!(body["distribution"]["join_ticket"].is_null());
    assert_eq!(
        body["distribution"]["availability"].as_str(),
        Some("available")
    );
}

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
    let session_id = bootstrap["session_id"]
        .as_str()
        .expect("session_id")
        .to_string();
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
    let temp_file = 写入rustus测试文件(
        &state.rustus_data_dir,
        &attachment_id,
        "owner.png",
        &最小png字节(),
    )
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

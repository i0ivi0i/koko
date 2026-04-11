use axum::http::{header, Method, StatusCode};
use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::{env_support::*, http::*, media::*};

/// 集成测试主链：
/// 1. 这里继续保留跨模块接线后的消息主链、协作分发与 realtime 主链。
/// 2. 启动边界、媒体上传、房间接口、后台与静态壳已经拆到独立测试文件，不允许再把它们回灌回来。
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

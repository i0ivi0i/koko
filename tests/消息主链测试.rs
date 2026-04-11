use serial_test::serial;
use sqlx::{postgres::PgPoolOptions, Row};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::media::*;

/// 消息主链测试：
/// 1. 这里只守消息成立顺序、附件引用落库、以及 ready/prepared 附件进入消息主链的边界。
/// 2. 这些测试直接锁住“消息什么时候成立、附件什么时候可被引用”这条业务真相，避免上传运输态和分发运行态倒灌进来。
/// 3. 不负责上传运输过程、协作分发运行态、房间阅读恢复或 realtime 控制面。
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

use serial_test::serial;
use sqlx::{
    ConnectOptions, PgPool, Row,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;
use tokio::time::{Duration, timeout};

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::env_support::*;

fn 生成迁移测试数据库名(prefix: &str) -> String {
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    format!("{prefix}_{uniq}")
}

async fn 创建迁移测试数据库(base_database_url: &str, db_name: &str) -> (PgPool, String) {
    let admin_options = base_database_url
        .parse::<PgConnectOptions>()
        .expect("DATABASE_URL 应能解析成 PgConnectOptions")
        .database("postgres")
        .disable_statement_logging();
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(admin_options.clone())
        .await
        .expect("应能连到 postgres 管理库");
    sqlx::query(&format!("CREATE DATABASE \"{db_name}\""))
        .execute(&admin_pool)
        .await
        .expect("应能创建迁移测试数据库");
    admin_pool.close().await;

    let test_database_url = admin_options.database(db_name).to_url_lossy().to_string();
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url)
        .await
        .expect("应能连到迁移测试数据库");
    (pool, test_database_url)
}

async fn 删除迁移测试数据库(base_database_url: &str, db_name: &str) {
    let admin_options = base_database_url
        .parse::<PgConnectOptions>()
        .expect("DATABASE_URL 应能解析成 PgConnectOptions")
        .database("postgres")
        .disable_statement_logging();
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(admin_options)
        .await
        .expect("应能重新连到 postgres 管理库");
    sqlx::query(
        "SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()",
    )
    .bind(db_name)
    .execute(&admin_pool)
    .await
    .expect("应能清理迁移测试数据库连接");
    sqlx::query(&format!("DROP DATABASE IF EXISTS \"{db_name}\""))
        .execute(&admin_pool)
        .await
        .expect("应能删除迁移测试数据库");
    admin_pool.close().await;
}

async fn 执行迁移直到(pool: &PgPool, last_file: &str) {
    let mut migration_files = std::fs::read_dir("migrations")
        .expect("应能读取 migrations 目录")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sql"))
        .collect::<Vec<_>>();
    migration_files.sort();

    for path in migration_files {
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("迁移文件名应是 utf-8");
        if file_name > last_file {
            break;
        }
        let sql = std::fs::read_to_string(&path).expect("应能读到迁移 SQL");
        sqlx::raw_sql(&sql)
            .execute(pool)
            .await
            .unwrap_or_else(|err| panic!("执行迁移 {file_name} 失败: {err}"));
    }
}

async fn 插入0018前脏匿名身份与视频附件(
    pool: &PgPool,
    device_token: &str,
    attachment_id: &str,
) -> (i64, i64, i64) {
    let anonymous_identity_id = format!("legacy-identity-{device_token}");
    let identity_row = sqlx::query(
        "INSERT INTO anonymous_identities (anonymous_identity_id, display_alias, identity_uuid, theme_key)
         VALUES ($1, $2, NULL, NULL)
         RETURNING id",
    )
    .bind(&anonymous_identity_id)
    .bind("迁移前旧身份")
    .fetch_one(pool)
    .await
    .expect("应能插入旧匿名身份");
    let identity_db_id: i64 = identity_row.get("id");

    sqlx::query(
        "INSERT INTO sessions (session_id, display_name, anonymous_identity_id, device_anonymous_token)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(format!("s-{device_token}"))
    .bind("迁移前旧会话")
    .bind(identity_db_id)
    .bind(device_token)
    .execute(pool)
    .await
    .expect("应能插入旧会话");

    let mezzanine_expires_at_epoch = 1_775_942_400_i64;
    let mezzanine_deleted_at_epoch = 1_775_946_000_i64;
    sqlx::query(
        "INSERT INTO attachments (
             attachment_id,
             owner_anonymous_identity_id,
             kind,
             mime_type,
             byte_size,
             width,
             height,
             storage_key,
             thumbnail_storage_key,
             status,
             committed_at,
             asset_original_storage_key,
             full_storage_key,
             origin_expires_at,
             origin_deleted_at,
             abandoned_at,
             mezzanine_storage_key,
             mezzanine_expires_at,
             mezzanine_deleted_at
         ) VALUES (
             $1, $2, 'video', 'video/mp4', 1024, 1280, 720,
             'videos/storage/original.mp4', NULL, 'ready', NOW(),
             NULL, NULL, NULL, NULL, NULL,
             'videos/storage/mezzanine.mp4', TO_TIMESTAMP($3), TO_TIMESTAMP($4)
         )",
    )
    .bind(attachment_id)
    .bind(identity_db_id)
    .bind(mezzanine_expires_at_epoch)
    .bind(mezzanine_deleted_at_epoch)
    .execute(pool)
    .await
    .expect("应能插入 0018 前脏视频附件");

    (
        identity_db_id,
        mezzanine_expires_at_epoch,
        mezzanine_deleted_at_epoch,
    )
}

/// 启动与迁移测试：
/// 1. 这里只守“系统是否能以正确边界启动起来”的底线。
/// 2. 这里只守迁移脚本和共享契约是否仍然表达权威真相。
/// 3. 不负责消息发送、媒体上传、房间历史、静态壳、Realtime 主链等业务流程。
/// 4. 断言应尽量稳定，避免把频繁演进的业务细节重新堆回系统基线测试。
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
fn 协作分发迁移已包含swarm级peer_presence表() {
    let sql = std::fs::read_to_string("migrations/0015_协作分发swarm_peer_presence.sql")
        .expect("应能读到 swarm peer presence 迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS swarm_peer_presence"));
    assert!(sql.contains("swarm_id TEXT NOT NULL"));
    assert!(sql.contains("session_id TEXT NOT NULL"));
    assert!(sql.contains(
        "attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE"
    ));
    assert!(sql.contains("peer_kind TEXT NOT NULL"));
    assert!(sql.contains("PRIMARY KEY (swarm_id, session_id, peer_kind)"));
}

#[test]
fn 协作分发迁移已移除附件级过时peer字段() {
    let sql = std::fs::read_to_string("migrations/0016_移除附件协作分发过时peer字段.sql")
        .expect("应能读到移除过时 peer 字段迁移文件");

    assert!(sql.contains("ALTER TABLE attachment_distribution_metadata"));
    assert!(sql.contains("DROP COLUMN IF EXISTS last_peer_seen_at"));
}

#[test]
fn 协作分发partial_peer迁移已扩展peer_kind约束() {
    let sql = std::fs::read_to_string("migrations/0017_协作分发partial_peer与来源裁决.sql")
        .expect("应能读到 partial_peer 迁移文件");

    assert!(sql.contains("partial_peer"));
}

#[test]
fn 万人群聊生产化索引迁移必须覆盖当前热查询() {
    let sql = std::fs::read_to_string("migrations/0019_万人实时群聊生产化索引.sql")
        .expect("应能读到万人实时群聊生产化索引迁移");

    assert!(sql.contains("idx_swarm_peer_presence_swarm_kind_seen"));
    assert!(sql.contains("ON swarm_peer_presence (swarm_id, peer_kind, last_seen_at DESC)"));

    let base_sql = std::fs::read_to_string("migrations/0001_初始化真相模型.sql")
        .expect("应能读到初始化真相模型迁移");
    assert!(
        base_sql.contains("UNIQUE (room_id, event_position)"),
        "room_events/messages 已由事件位置唯一约束承担 cursor 查询索引，不应为了计划文本重复新增等价索引"
    );
}

#[test]
fn source_hash精确去重迁移会建立内容资产和受权限索引() {
    let sql = std::fs::read_to_string("migrations/0020_媒体source_hash精确去重资产索引.sql")
        .expect("应能读到 source_hash 精确去重资产索引迁移");
    let boundary_comment_sql =
        std::fs::read_to_string("migrations/0021_媒体source_hash权限边界注释.sql")
            .expect("应能读到 source_hash 权限边界注释迁移");

    // source_hash 只用于当前可见范围内的精确原文件命中，不能做成全局唯一资产身份。
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_source_hashes"));
    assert!(sql.contains("source_hash TEXT NOT NULL"));
    assert!(sql.contains("CHECK (source_hash ~ '^[0-9a-f]{64}$')"));
    assert!(sql.contains("source_byte_size BIGINT NOT NULL"));
    assert!(sql.contains("idx_attachment_source_hashes_lookup"));
    assert!(boundary_comment_sql.contains("禁止跨权限存在性探测"));
    assert!(boundary_comment_sql.contains("COMMENT ON TABLE attachment_source_hashes"));
    assert!(!sql.contains("UNIQUE (source_hash"));

    // canonical 资产才拥有 WebTorrent / WebSeed 分发事实，多个业务附件只引用同一内容资产。
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS canonical_media_assets"));
    assert!(sql.contains("content_hash TEXT PRIMARY KEY"));
    assert!(sql.contains("storage_key TEXT NOT NULL UNIQUE"));
    assert!(sql.contains("torrent_bytes BYTEA NOT NULL"));
    assert!(sql.contains("torrent_info_hash TEXT NOT NULL"));
    assert!(sql.contains("web_seed_until TIMESTAMPTZ NOT NULL"));
    assert!(sql.contains("origin_expires_at TIMESTAMPTZ NOT NULL"));
    assert!(sql.contains("origin_deleted_at TIMESTAMPTZ NULL"));

    // 附件到 canonical 资产的引用必须独立于消息事实，避免把“资产复用”偷换成“消息复用”。
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_canonical_asset_refs"));
    assert!(sql.contains(
        "attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE"
    ));
    assert!(sql.contains(
        "content_hash TEXT NOT NULL REFERENCES canonical_media_assets(content_hash) ON DELETE RESTRICT"
    ));
}

#[test]
fn 流媒体清单迁移已包含清单元数据表() {
    let sql = std::fs::read_to_string("migrations/0009_附件流媒体清单元数据.sql")
        .expect("应能读到流媒体清单迁移文件");

    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_streaming_manifests"));
    assert!(sql.contains(
        "attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE"
    ));
    assert!(sql.contains("hls_master_storage_key TEXT NOT NULL"));
    assert!(sql.contains("dash_mpd_storage_key TEXT NOT NULL"));
}

#[test]
fn 图片资产生命周期迁移已包含真实资产与冷源字段() {
    let sql = std::fs::read_to_string("migrations/0010_图片资产与原始冷源生命周期.sql")
        .expect("应能读到图片资产生命周期迁移文件");

    // 图片 blob 资产要想真正和原始冷源拆层，数据库里必须先有真实资产键和冷源生命周期字段。
    assert!(sql.contains("ALTER TABLE attachments"));
    assert!(sql.contains("asset_original_storage_key"));
    assert!(sql.contains("full_storage_key"));
    assert!(sql.contains("origin_expires_at"));
    assert!(sql.contains("origin_deleted_at"));
}

#[test]
fn 匿名内部身份迁移已包含uuid与主题投影字段() {
    let sql = std::fs::read_to_string("migrations/0011_匿名内部身份uuid与主题投影.sql")
        .expect("应能读到匿名内部身份迁移文件");

    // 这条迁移要同时锁住三件事：
    // 1. 内部真实身份升级为 UUID；
    // 2. 当前资料投影有 theme_key 可承载项目级主题；
    // 3. 旧 anonymous_identity_id 仍保留为兼容缝，避免粗暴断链。
    assert!(sql.contains("identity_uuid UUID"));
    assert!(sql.contains("theme_key TEXT"));
    assert!(sql.contains("CREATE UNIQUE INDEX"));
    assert!(sql.contains("anonymous_identity_id TEXT"));
}

#[test]
fn 视频上传生命周期迁移已包含abandoned与mezzanine字段() {
    let sql = std::fs::read_to_string("migrations/0012_视频上传重试回收与mezzanine生命周期.sql")
        .expect("应能读到视频上传生命周期迁移文件");

    // 这条迁移必须同时锁住三件事：
    // 1. 旧 upload 可以被明确标成 abandoned；
    // 2. 视频有独立 mezzanine 回退层；
    // 3. 过期 mezzanine 可以被后台按 TTL 清理。
    assert!(sql.contains("ALTER TABLE attachments"));
    assert!(sql.contains("abandoned_at"));
    assert!(sql.contains("mezzanine_storage_key"));
    assert!(sql.contains("mezzanine_expires_at"));
    assert!(sql.contains("mezzanine_deleted_at"));
    assert!(sql.contains("ALTER TABLE attachment_upload_transports"));
}

#[test]
fn 流媒体清单生命周期迁移已包含streaming过期与删除字段() {
    let sql = std::fs::read_to_string("migrations/0014_流媒体清单24小时生命周期.sql")
        .expect("应能读到流媒体生命周期迁移");

    // 这条迁移必须把“标准流媒体只活 24 小时”写成独立真相：
    // 1. manifest/segment 何时该退场，由 streaming_expires_at 表达；
    // 2. 真正删完后要留下 streaming_deleted_at；
    // 3. 删除 streaming 不能顺手抹掉 distribution swarm 线索。
    assert!(sql.contains("ALTER TABLE attachment_streaming_manifests"));
    assert!(sql.contains("streaming_expires_at"));
    assert!(sql.contains("streaming_deleted_at"));
    assert!(sql.contains("idx_attachment_streaming_manifest_cleanup"));
}

#[test]
fn 共享契约已为房间阅读推进预留稳定命令() {
    let command = koko::shared::contract::命令::推进房间阅读位置 {
        房间标识: "r-test".to_string(),
        已读到事件位置: 3,
    };

    assert!(matches!(
        command,
        koko::shared::contract::命令::推进房间阅读位置 {
            已读到事件位置: 3,
            ..
        }
    ));
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

#[test]
fn 数据库连接池配置默认适合单机生产起步() {
    let cfg =
        koko::assembly::数据库连接池配置::from_env_with(|_| None).expect("缺省连接池配置应可解析");

    assert_eq!(cfg.app_max_connections, 20);
    assert_eq!(cfg.app_min_connections, 0);
    assert_eq!(cfg.migration_max_connections, 1);
    assert!(
        cfg.acquire_timeout_ms <= 5_000,
        "应用连接池等待时间要短，不能把数据库压力伪装成无限排队"
    );
}

#[test]
fn 数据库连接池配置允许生产环境覆盖但拒绝无效值() {
    let cfg = koko::assembly::数据库连接池配置::from_env_with(|key| match key {
        "KOKO_DATABASE_MAX_CONNECTIONS" => Some("60".to_string()),
        "KOKO_DATABASE_MIN_CONNECTIONS" => Some("6".to_string()),
        "KOKO_DATABASE_ACQUIRE_TIMEOUT_MS" => Some("3000".to_string()),
        "KOKO_DATABASE_CONNECT_TIMEOUT_MS" => Some("2000".to_string()),
        "KOKO_DATABASE_IDLE_TIMEOUT_SECONDS" => Some("120".to_string()),
        _ => None,
    })
    .expect("显式生产连接池配置应可解析");
    assert_eq!(cfg.app_max_connections, 60);
    assert_eq!(cfg.app_min_connections, 6);
    assert_eq!(cfg.acquire_timeout_ms, 3000);
    assert_eq!(cfg.connect_timeout_ms, 2000);
    assert_eq!(cfg.idle_timeout_seconds, 120);

    let err = koko::assembly::数据库连接池配置::from_env_with(|key| match key {
        "KOKO_DATABASE_MAX_CONNECTIONS" => Some("4".to_string()),
        "KOKO_DATABASE_MIN_CONNECTIONS" => Some("8".to_string()),
        _ => None,
    })
    .expect_err("min_connections 超过 max_connections 必须拒绝");
    assert!(
        err.to_string().contains("KOKO_DATABASE_MIN_CONNECTIONS"),
        "错误必须指向配置源，便于无人值守排查"
    );
}

#[tokio::test]
#[serial]
async fn 读取旧匿名身份不应再偷偷写库回填影子字段() {
    let base_database_url = koko::assembly::读取配置()
        .expect("需要本地 DATABASE_URL")
        .database_url;
    let db_name = 生成迁移测试数据库名("koko_migration_read_guard");
    let (pool, test_database_url) = 创建迁移测试数据库(&base_database_url, &db_name).await;
    执行迁移直到(&pool, "0017_协作分发partial_peer与来源裁决.sql").await;
    let (identity_db_id, _, _) = 插入0018前脏匿名身份与视频附件(
        &pool,
        "migration-read-guard-device",
        "att-read-guard",
    )
    .await;

    let pool_for_bootstrap = pool.clone();
    let runtime_handle = tokio::runtime::Handle::current();
    let bootstrap = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::从连接池构建(pool_for_bootstrap, runtime_handle);
        koko::usecase::引导匿名身份(&mut repo, "migration-read-guard-device")
    })
    .await
    .expect("阻塞引导任务应完成")
    .expect("旧匿名身份仍应能被现有 device token 读出");
    assert_eq!(bootstrap.展示花名, "迁移前旧身份");

    let row = sqlx::query(
        "SELECT identity_uuid::text AS identity_uuid_text, theme_key
           FROM anonymous_identities
          WHERE id = $1",
    )
    .bind(identity_db_id)
    .fetch_one(&pool)
    .await
    .expect("应能读到旧匿名身份行");
    let identity_uuid_text: Option<String> = row.get("identity_uuid_text");
    let theme_key: Option<String> = row.get("theme_key");
    assert!(
        identity_uuid_text.is_none() && theme_key.is_none(),
        "读取旧匿名身份不应再偷偷把 identity_uuid/theme_key 写回数据库；这件事只能由 0018 迁移负责"
    );

    pool.close().await;
    删除迁移测试数据库(&base_database_url, &db_name).await;
    drop(test_database_url);
}

#[tokio::test]
#[serial]
async fn 最终收口迁移会把旧匿名身份与媒体冷源补齐到最终契约() {
    let base_database_url = koko::assembly::读取配置()
        .expect("需要本地 DATABASE_URL")
        .database_url;
    let db_name = 生成迁移测试数据库名("koko_migration_0018");
    let (pool, _) = 创建迁移测试数据库(&base_database_url, &db_name).await;
    执行迁移直到(&pool, "0017_协作分发partial_peer与来源裁决.sql").await;
    let (identity_db_id, mezzanine_expires_at_epoch, mezzanine_deleted_at_epoch) =
        插入0018前脏匿名身份与视频附件(
            &pool,
            "migration-0018-device",
            "att-migration-0018",
        )
        .await;

    let migration_sql = std::fs::read_to_string("migrations/0018_最终收口清零.sql")
        .expect("应存在 0018 最终收口迁移文件");
    sqlx::raw_sql(&migration_sql)
        .execute(&pool)
        .await
        .expect("应能执行 0018 最终收口迁移");

    let identity_row = sqlx::query(
        "SELECT identity_uuid::text AS identity_uuid_text, theme_key
           FROM anonymous_identities
          WHERE id = $1",
    )
    .bind(identity_db_id)
    .fetch_one(&pool)
    .await
    .expect("应能读到回填后的匿名身份");
    let identity_uuid_text: Option<String> = identity_row.get("identity_uuid_text");
    let theme_key: String = identity_row.get("theme_key");
    assert!(
        identity_uuid_text.is_some(),
        "0018 迁移必须把旧匿名身份补齐成内部 identity_uuid"
    );
    assert_eq!(
        theme_key, "legacy",
        "0018 迁移必须把旧匿名身份补齐成统一 theme_key"
    );

    let attachment_row = sqlx::query(
        "SELECT
            EXTRACT(EPOCH FROM origin_expires_at)::BIGINT AS origin_expires_at_epoch,
            EXTRACT(EPOCH FROM origin_deleted_at)::BIGINT AS origin_deleted_at_epoch,
            EXTRACT(EPOCH FROM mezzanine_expires_at)::BIGINT AS mezzanine_expires_at_epoch,
            EXTRACT(EPOCH FROM mezzanine_deleted_at)::BIGINT AS mezzanine_deleted_at_epoch
         FROM attachments
         WHERE attachment_id = $1",
    )
    .bind("att-migration-0018")
    .fetch_one(&pool)
    .await
    .expect("应能读到回填后的附件");
    let origin_expires_at_epoch: Option<i64> = attachment_row.get("origin_expires_at_epoch");
    let origin_deleted_at_epoch: Option<i64> = attachment_row.get("origin_deleted_at_epoch");
    let mezzanine_expires_at_epoch_db: Option<i64> =
        attachment_row.get("mezzanine_expires_at_epoch");
    let mezzanine_deleted_at_epoch_db: Option<i64> =
        attachment_row.get("mezzanine_deleted_at_epoch");
    assert_eq!(
        origin_expires_at_epoch,
        Some(mezzanine_expires_at_epoch),
        "0018 迁移必须把 mezzanine_expires_at 真正回填到 origin_expires_at"
    );
    assert_eq!(
        origin_deleted_at_epoch,
        Some(mezzanine_deleted_at_epoch),
        "0018 迁移必须把 mezzanine_deleted_at 真正回填到 origin_deleted_at"
    );
    assert_eq!(
        mezzanine_expires_at_epoch_db,
        Some(mezzanine_expires_at_epoch),
        "测试前提失败：旧 mezzanine_expires_at 不应被迁移顺手改掉"
    );
    assert_eq!(
        mezzanine_deleted_at_epoch_db,
        Some(mezzanine_deleted_at_epoch),
        "测试前提失败：旧 mezzanine_deleted_at 不应被迁移顺手改掉"
    );

    let pool_for_bootstrap = pool.clone();
    let runtime_handle = tokio::runtime::Handle::current();
    let bootstrap = tokio::task::spawn_blocking(move || {
        let mut repo =
            koko::adapter::Pg仓储::从连接池构建(pool_for_bootstrap, runtime_handle);
        koko::usecase::引导匿名身份(&mut repo, "migration-0018-device")
    })
    .await
    .expect("阻塞引导任务应完成")
    .expect("0018 补齐后，旧 device token 应仍能顺利引导匿名身份");
    assert_eq!(bootstrap.展示花名, "迁移前旧身份");

    pool.close().await;
    删除迁移测试数据库(&base_database_url, &db_name).await;
}

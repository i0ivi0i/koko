use serial_test::serial;
use sqlx::{
    ConnectOptions, PgPool,
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

fn 当前迁移_sql文件名列表() -> Vec<String> {
    let mut files = std::fs::read_dir("migrations")
        .expect("应能读取 migrations 目录")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sql"))
        .map(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .expect("迁移文件名应是 utf-8")
                .to_string()
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn 读取当前数据库基线_sql() -> String {
    std::fs::read_to_string("migrations/0001_当前数据库基线.sql").expect("应存在当前数据库基线")
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
fn 数据库迁移不会无意识膨胀() {
    // 这是迁移目录的硬门禁：新增 SQL 不是禁止事项，但必须显式改这个测试。
    // 这样未来 schema 变化会变成可审查的数据库契约变化，而不是探索期文件继续堆积。
    assert_eq!(
        当前迁移_sql文件名列表(),
        vec!["0001_当前数据库基线.sql".to_string()],
        "当前阶段 migrations 只允许单一基线；新增迁移必须显式改这个门禁并说明数据库契约变化"
    );
}

#[tokio::test]
#[serial]
async fn 当前数据库基线可在空库一次性迁移() {
    let base_database_url = koko::assembly::读取配置()
        .expect("需要本地 DATABASE_URL")
        .database_url;
    let db_name = 生成迁移测试数据库名("koko_current_baseline");
    let (pool, _) = 创建迁移测试数据库(&base_database_url, &db_name).await;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("单一当前基线应能在空 PostgreSQL 库一次性建成");

    let applied_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("应能读取 sqlx 迁移记录");
    assert_eq!(applied_count, 1, "新库只应应用一条当前基线迁移");

    pool.close().await;
    删除迁移测试数据库(&base_database_url, &db_name).await;
}

#[test]
fn 当前数据库基线表达最终schema而不是历史补丁链() {
    let sql = 读取当前数据库基线_sql();

    for table in [
        "sessions",
        "anonymous_identities",
        "rooms",
        "room_members",
        "room_events",
        "messages",
        "room_read_anchors",
        "attachments",
        "message_attachment_refs",
        "attachment_upload_sessions",
        "attachment_upload_transports",
        "attachment_distribution_metadata",
        "attachment_streaming_manifests",
        "swarm_peer_presence",
        "canonical_media_assets",
        "attachment_canonical_asset_refs",
        "attachment_source_hashes",
    ] {
        assert!(
            sql.contains(&format!("CREATE TABLE IF NOT EXISTS {table}")),
            "baseline 必须直接创建 {table}"
        );
    }

    assert!(sql.contains("GENERATED ALWAYS AS IDENTITY"));
    assert!(sql.contains("COMMENT ON TABLE attachment_source_hashes"));
    assert!(sql.contains("禁止跨权限存在性探测"));
    assert!(!sql.contains("BIGSERIAL"));
    assert!(!sql.contains("attachment_upload_transports_legacy"));
    assert!(!sql.contains("last_peer_seen_at"));
    assert!(!sql.contains("DROP COLUMN IF EXISTS"));
    assert!(!sql.contains("UPDATE anonymous_identities"));
    assert!(!sql.contains("UNIQUE (source_hash"));
}

#[test]
fn 当前数据库基线保留聊天主链和阅读真相约束() {
    let sql = 读取当前数据库基线_sql();

    // 群聊消息主链的顺序真相仍由 room_id + event_position 守住；
    // 这对万人房间的游标读取比另造一份影子顺序字段更直接。
    assert!(sql.contains("UNIQUE (room_id, event_position)"));
    assert!(sql.contains("FOREIGN KEY (room_id, event_position) REFERENCES room_events"));
    assert!(sql.contains("CREATE UNIQUE INDEX IF NOT EXISTS uq_room_members_active"));
    assert!(sql.contains("WHERE left_at IS NULL"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS room_read_anchors"));
    assert!(sql.contains("UNIQUE (anonymous_identity_id, room_id)"));
}

#[test]
fn 当前数据库基线保留媒体上传和协作分发热路径索引() {
    let sql = 读取当前数据库基线_sql();

    // TUS/Concatenation 上传状态属于外层适配持久化，不回塞 attachments 业务真相。
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_upload_sessions"));
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_upload_transports"));
    assert!(sql.contains("idx_attachment_upload_transports_session_role_v2"));
    assert!(sql.contains(
        "ON attachment_upload_transports (upload_session_id, transport_role, finished_at DESC)"
    ));
    assert!(sql.contains("idx_attachment_upload_transports_attachment_active"));

    // 协作分发按 swarm + peer_kind 找最近可用来源；新基线不再带旧的宽泛 swarm-only 索引。
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS swarm_peer_presence"));
    assert!(sql.contains("partial_peer"));
    assert!(sql.contains("idx_swarm_peer_presence_swarm_kind_seen"));
    assert!(sql.contains("ON swarm_peer_presence (swarm_id, peer_kind, last_seen_at DESC)"));
    assert!(!sql.contains("idx_swarm_peer_presence_swarm_last_seen"));

    assert!(sql.contains("idx_attachment_distribution_metadata_swarm_id"));
    assert!(sql.contains("idx_attachment_distribution_metadata_content_hash"));
    assert!(sql.contains("idx_attachment_streaming_manifest_cleanup"));
    assert!(sql.contains("idx_attachments_origin_cleanup"));
    assert!(sql.contains("idx_attachments_mezzanine_cleanup"));
}

#[test]
fn 当前数据库基线保留source_hash权限边界和canonical资产真相() {
    let sql = 读取当前数据库基线_sql();

    // source_hash 只用于当前可见范围内的精确原文件命中，不能做成全局唯一资产身份。
    assert!(sql.contains("CREATE TABLE IF NOT EXISTS attachment_source_hashes"));
    assert!(sql.contains("source_hash TEXT NOT NULL"));
    assert!(sql.contains("CHECK (source_hash ~ '^[0-9a-f]{64}$')"));
    assert!(sql.contains("source_byte_size BIGINT NOT NULL"));
    assert!(sql.contains("idx_attachment_source_hashes_lookup"));
    assert!(sql.contains("COMMENT ON TABLE attachment_source_hashes"));
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
    let base_database_url = koko::assembly::读取配置()
        .expect("需要本地 DATABASE_URL")
        .database_url;
    let db_name = 生成迁移测试数据库名("koko_startup_baseline");
    let (pool, test_database_url) = 创建迁移测试数据库(&base_database_url, &db_name).await;
    pool.close().await;

    // 启动烟测必须使用干净空库，不能复用开发库里的旧 _sqlx_migrations 账本。
    // 单一基线的兼容前提是“旧库可丢弃重建”，测试也应显式验证这个前提下的真实启动链。
    let backup = 备份并清空环境变量(&["APP_PORT", "DATABASE_URL"]);
    let port = 分配测试端口();
    env::set_var("APP_PORT", port.to_string());
    env::set_var("DATABASE_URL", &test_database_url);

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
    删除迁移测试数据库(&base_database_url, &db_name).await;
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

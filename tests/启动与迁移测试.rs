use serial_test::serial;
use std::env;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

#[path = "测试支撑/mod.rs"]
mod test_support;

use test_support::env_support::*;

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

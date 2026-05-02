use super::*;
use serial_test::serial;

// 这些测试仍然贴着总装模块编译，是因为它们要验证启动配置私有函数。
// 测试正文单独落在本文件，避免 src/总装.rs 被测试样板撑胖成“装配 + 测试大桶”。
fn 读并清空环境变量(key: &str) -> Option<String> {
    let old = env::var(key).ok();
    env::remove_var(key);
    old
}

fn 恢复环境变量(key: &str, old: Option<String>) {
    if let Some(value) = old {
        env::set_var(key, value);
    } else {
        env::remove_var(key);
    }
}

#[test]
#[serial]
fn 读取媒体_tus侧车配置会给出本地默认值() {
    let old_public_endpoint = 读并清空环境变量("MEDIA_TUS_PUBLIC_ENDPOINT");
    let old_server_port = 读并清空环境变量("MEDIA_TUS_SERVER_PORT");
    let old_base_path = 读并清空环境变量("MEDIA_TUS_BASE_PATH");
    let old_upload_dir = 读并清空环境变量("MEDIA_TUS_UPLOAD_DIR");
    let old_internal_base_url = 读并清空环境变量("MEDIA_TUS_INTERNAL_BASE_URL");
    let old_internal_token = 读并清空环境变量("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN");

    let config = 读取媒体_tus侧车配置().expect("默认媒体 Tus 侧车配置应可读");

    assert_eq!(config.public_endpoint, Some("/files".to_string()));
    assert_eq!(config.server_port, 1081);
    assert_eq!(config.base_path, "/files");
    assert_eq!(config.upload_dir, "data/tus");
    assert_eq!(config.internal_base_url, None);
    assert_eq!(config.internal_termination_token, None);

    恢复环境变量("MEDIA_TUS_PUBLIC_ENDPOINT", old_public_endpoint);
    恢复环境变量("MEDIA_TUS_SERVER_PORT", old_server_port);
    恢复环境变量("MEDIA_TUS_BASE_PATH", old_base_path);
    恢复环境变量("MEDIA_TUS_UPLOAD_DIR", old_upload_dir);
    恢复环境变量("MEDIA_TUS_INTERNAL_BASE_URL", old_internal_base_url);
    恢复环境变量("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN", old_internal_token);
}

#[test]
#[serial]
fn 读取媒体_tus侧车配置会尊重显式环境变量() {
    let old_public_endpoint = env::var("MEDIA_TUS_PUBLIC_ENDPOINT").ok();
    let old_server_port = env::var("MEDIA_TUS_SERVER_PORT").ok();
    let old_base_path = env::var("MEDIA_TUS_BASE_PATH").ok();
    let old_upload_dir = env::var("MEDIA_TUS_UPLOAD_DIR").ok();
    let old_internal_base_url = env::var("MEDIA_TUS_INTERNAL_BASE_URL").ok();
    let old_internal_token = env::var("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN").ok();

    env::set_var("MEDIA_TUS_PUBLIC_ENDPOINT", "https://im.example.com/files");
    env::set_var("MEDIA_TUS_SERVER_PORT", "2081");
    env::set_var("MEDIA_TUS_BASE_PATH", "uploads");
    env::set_var("MEDIA_TUS_UPLOAD_DIR", "E:/tmp/tus-data");
    env::set_var(
        "MEDIA_TUS_INTERNAL_BASE_URL",
        "http://127.0.0.1:2081/uploads/",
    );
    env::set_var("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN", "internal-guard");

    let config = 读取媒体_tus侧车配置().expect("显式媒体 Tus 侧车配置应可读");

    assert_eq!(
        config.public_endpoint,
        Some("https://im.example.com/files".to_string())
    );
    assert_eq!(config.server_port, 2081);
    assert_eq!(config.base_path, "/uploads");
    assert_eq!(config.upload_dir, "E:/tmp/tus-data");
    assert_eq!(
        config.internal_base_url,
        Some("http://127.0.0.1:2081/uploads".to_string())
    );
    assert_eq!(
        config.internal_termination_token,
        Some("internal-guard".to_string())
    );

    恢复环境变量("MEDIA_TUS_PUBLIC_ENDPOINT", old_public_endpoint);
    恢复环境变量("MEDIA_TUS_SERVER_PORT", old_server_port);
    恢复环境变量("MEDIA_TUS_BASE_PATH", old_base_path);
    恢复环境变量("MEDIA_TUS_UPLOAD_DIR", old_upload_dir);
    恢复环境变量("MEDIA_TUS_INTERNAL_BASE_URL", old_internal_base_url);
    恢复环境变量("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN", old_internal_token);
}

#[test]
#[serial]
fn 读取媒体上传完成并发上限会给出默认值并尊重显式环境变量() {
    let old = env::var("MEDIA_COMPLETE_MAX_CONCURRENCY").ok();
    env::remove_var("MEDIA_COMPLETE_MAX_CONCURRENCY");
    assert_eq!(读取媒体上传完成并发上限().expect("默认值应可读"), 4);

    env::set_var("MEDIA_COMPLETE_MAX_CONCURRENCY", "6");
    assert_eq!(读取媒体上传完成并发上限().expect("显式值应可读"), 6);

    恢复环境变量("MEDIA_COMPLETE_MAX_CONCURRENCY", old);
}

#[test]
fn 构建迁移数据库连接选项会关闭_statement_日志() {
    let options =
        构建迁移数据库连接选项("postgres://postgres:postgres@127.0.0.1:5432/koko")
            .expect("迁移连接选项应可构建");
    let debug = format!("{options:?}");

    assert!(debug.contains("statements_level: Off"));
    assert!(debug.contains("slow_statements_level: Off"));
}

#[test]
#[serial]
fn 协作分发配置会为sidecar生成私有tracker地址() {
    let old_app_port = 读并清空环境变量("APP_PORT");
    let old_tracker_port = 读并清空环境变量("SWARM_TRACKER_PORT");
    let old_public_url = 读并清空环境变量("SWARM_TRACKER_PUBLIC_URL");
    let old_tracker_upstream_url = 读并清空环境变量("SWARM_TRACKER_UPSTREAM_URL");
    let old_seeder_tracker_url = 读并清空环境变量("SWARM_SEEDER_TRACKER_URL");

    env::set_var("APP_PORT", "18080");
    env::set_var("SWARM_TRACKER_PORT", "17072");
    env::set_var(
        "SWARM_TRACKER_PUBLIC_URL",
        "wss://im.example.com/api/swarm/announce",
    );

    let config = 读取协作分发配置().expect("应能读取协作分发配置");

    assert_eq!(
        config.tracker_public_url, "wss://im.example.com/api/swarm/announce",
        "public announce 继续服务浏览器 contract"
    );
    assert_eq!(
        config.tracker_upstream_url, "ws://127.0.0.1:17072",
        "裸 tracker upstream 只给后端同源代理使用"
    );
    assert_eq!(
        config.seeder_tracker_url, "ws://127.0.0.1:18080/api/swarm/announce",
        "sidecar 默认必须走后端同源认证入口，禁止绕过 join_ticket 门禁"
    );

    恢复环境变量("APP_PORT", old_app_port);
    恢复环境变量("SWARM_TRACKER_PORT", old_tracker_port);
    恢复环境变量("SWARM_TRACKER_PUBLIC_URL", old_public_url);
    恢复环境变量("SWARM_TRACKER_UPSTREAM_URL", old_tracker_upstream_url);
    恢复环境变量("SWARM_SEEDER_TRACKER_URL", old_seeder_tracker_url);
}

#[test]
#[serial]
fn 协作分发配置允许显式覆盖sidecar私有tracker地址() {
    let old_seeder_tracker_url = 读并清空环境变量("SWARM_SEEDER_TRACKER_URL");

    env::set_var("SWARM_SEEDER_TRACKER_URL", "ws://tracker.internal:7072");

    let config = 读取协作分发配置().expect("应能读取协作分发配置");

    assert_eq!(
        config.seeder_tracker_url, "ws://tracker.internal:7072",
        "部署环境可以把 sidecar 指向内网 tracker，但这个值不能污染浏览器 locator"
    );

    恢复环境变量("SWARM_SEEDER_TRACKER_URL", old_seeder_tracker_url);
}

#[test]
#[serial]
fn 读取协作分发配置会给出冷源清理默认值并尊重显式环境变量() {
    let old_cleanup_interval = env::var("MEDIA_ORIGIN_CLEANUP_INTERVAL_SECONDS").ok();
    let old_public_url = env::var("SWARM_TRACKER_PUBLIC_URL").ok();
    let old_seeder_port = env::var("SWARM_SEEDER_PORT").ok();
    let old_seeder_control_base_url = env::var("SWARM_SEEDER_CONTROL_BASE_URL").ok();
    env::remove_var("MEDIA_ORIGIN_CLEANUP_INTERVAL_SECONDS");
    env::remove_var("SWARM_TRACKER_PUBLIC_URL");
    env::set_var("SWARM_SEEDER_PORT", "17073");
    env::remove_var("SWARM_SEEDER_CONTROL_BASE_URL");

    let default_config = 读取协作分发配置().expect("默认协作分发配置应可读");
    assert_eq!(default_config.media_origin_cleanup_interval_seconds, 60);
    assert_eq!(default_config.tracker_public_url, "/api/swarm/announce");
    assert_eq!(
        default_config.seeder_control_base_url,
        "http://127.0.0.1:17073"
    );

    env::set_var("MEDIA_ORIGIN_CLEANUP_INTERVAL_SECONDS", "15");
    env::set_var("SWARM_SEEDER_CONTROL_BASE_URL", "http://127.0.0.1:27073/");
    let explicit_config = 读取协作分发配置().expect("显式冷源清理间隔应可读");
    assert_eq!(explicit_config.media_origin_cleanup_interval_seconds, 15);
    assert_eq!(
        explicit_config.seeder_control_base_url,
        "http://127.0.0.1:27073"
    );

    恢复环境变量(
        "MEDIA_ORIGIN_CLEANUP_INTERVAL_SECONDS",
        old_cleanup_interval,
    );
    恢复环境变量("SWARM_TRACKER_PUBLIC_URL", old_public_url);
    恢复环境变量("SWARM_SEEDER_PORT", old_seeder_port);
    恢复环境变量("SWARM_SEEDER_CONTROL_BASE_URL", old_seeder_control_base_url);
}

#[test]
#[serial]
fn 做种对账间隔默认小于join_ticket_ttl() {
    let old_ticket_ttl = env::var("SWARM_TICKET_TTL_SECONDS").ok();
    let old_seed_reconcile = env::var("SWARM_SEED_RECONCILE_INTERVAL_SECONDS").ok();
    env::set_var("SWARM_TICKET_TTL_SECONDS", "120");
    env::remove_var("SWARM_SEED_RECONCILE_INTERVAL_SECONDS");

    let config = 读取协作分发配置().expect("默认做种对账间隔应可读");

    assert!(config.swarm_seed_reconcile_interval_seconds > 0);
    assert!(config.swarm_seed_reconcile_interval_seconds < config.ticket_ttl_seconds);

    恢复环境变量("SWARM_TICKET_TTL_SECONDS", old_ticket_ttl);
    恢复环境变量("SWARM_SEED_RECONCILE_INTERVAL_SECONDS", old_seed_reconcile);
}

#[test]
#[serial]
fn 做种对账间隔不能大于等于join_ticket_ttl() {
    let old_ticket_ttl = env::var("SWARM_TICKET_TTL_SECONDS").ok();
    let old_seed_reconcile = env::var("SWARM_SEED_RECONCILE_INTERVAL_SECONDS").ok();
    env::set_var("SWARM_TICKET_TTL_SECONDS", "30");
    env::set_var("SWARM_SEED_RECONCILE_INTERVAL_SECONDS", "30");

    let err = 读取协作分发配置().expect_err("做种对账间隔不能覆盖 ticket 全生命周期");

    assert!(err
        .to_string()
        .contains("SWARM_SEED_RECONCILE_INTERVAL_SECONDS"));

    恢复环境变量("SWARM_TICKET_TTL_SECONDS", old_ticket_ttl);
    恢复环境变量("SWARM_SEED_RECONCILE_INTERVAL_SECONDS", old_seed_reconcile);
}

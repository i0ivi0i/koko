use super::*;

#[test]
fn startup_banner_renders_home_admin_token_and_notice() {
    let banner = koko::support::StartupBanner {
        home_urls: vec!["http://127.0.0.1:8080/".to_string()],
        lan_urls: vec![],
        admin_url: "http://127.0.0.1:8080/admin".to_string(),
        admin_token: "admin-token".to_string(),
        admin_token_notice: Some("首次启动已写入 config/koko.toml".to_string()),
    };

    let lines = banner.render_lines();

    assert_eq!(lines[0], "==> 首页地址: http://127.0.0.1:8080/");
    assert_eq!(lines[1], "==> 管理入口: http://127.0.0.1:8080/admin");
    assert_eq!(lines[2], "==> 当前管理员口令: admin-token");
    assert_eq!(lines[3], "==> 首次启动已写入 config/koko.toml");
}

#[test]
fn startup_banner_renders_lan_urls_when_present() {
    let banner = koko::support::StartupBanner {
        home_urls: vec!["http://127.0.0.1:8080/".to_string()],
        lan_urls: vec!["http://192.168.1.10:8080/".to_string()],
        admin_url: "http://127.0.0.1:8080/admin".to_string(),
        admin_token: "admin-token".to_string(),
        admin_token_notice: None,
    };

    let lines = banner.render_lines();

    assert_eq!(lines[0], "==> 首页地址: http://127.0.0.1:8080/");
    assert_eq!(lines[1], "==> 管理入口: http://127.0.0.1:8080/admin");
    assert_eq!(lines[2], "==> 当前管理员口令: admin-token");
    assert_eq!(lines[3], "==> 局域网设备请访问:");
    assert_eq!(lines[4], "   http://192.168.1.10:8080/");
    assert_eq!(lines[5], "==> 局域网管理入口:");
    assert_eq!(lines[6], "   http://192.168.1.10:8080/admin");
}

#[test]
fn startup_banner_transcript_policy_hides_admin_token_from_default_log_sink() {
    let banner = koko::support::StartupBanner {
        home_urls: vec!["http://127.0.0.1:8080/".to_string()],
        lan_urls: vec![],
        admin_url: "http://127.0.0.1:8080/admin".to_string(),
        admin_token: "admin-test-token".to_string(),
        admin_token_notice: None,
    };

    let transcript = banner.render_lines();
    let persistent = banner.render_persistent_log_lines();

    assert!(
        transcript
            .iter()
            .any(|line| line.contains("admin-test-token"))
    );
    assert!(
        !persistent
            .iter()
            .any(|line| line.contains("admin-test-token"))
    );
}

#[test]
fn startup_banner_keeps_admin_token_notice_from_app_config() {
    let config_path = temp_config_file_path("startup-banner-notice");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        None,
        None,
    )
    .unwrap();

    let banner = koko::support::build_startup_banner_from_bind_addr(config.bind_addr, &config);
    assert!(banner.admin_token_notice.is_some());
}

#[test]
fn startup_banner_uses_actual_bound_port_after_listener_bind() {
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:0"),
        temp_config_file_path("startup-banner-bound-port"),
        Some("local-admin-token"),
        None,
    )
    .unwrap();

    let listener = std::net::TcpListener::bind(config.bind_addr).unwrap();
    let bound = listener.local_addr().unwrap();
    drop(listener);

    let banner = koko::support::build_startup_banner_from_bind_addr(bound, &config);
    assert!(banner.home_urls[0].ends_with(&format!(":{}/", bound.port())));
}

#[test]
fn startup_banner_sink_writes_nothing_for_startup_failures() {
    let mut sink = Vec::new();
    let config = sample_startup_config();

    koko::support::write_startup_banner_if_ready(&mut sink, Err("db failed"), &config).unwrap();

    assert!(sink.is_empty());
}

#[test]
fn startup_banner_sink_writes_once_for_ready_state() {
    let mut sink = Vec::new();
    let config = sample_startup_config();

    koko::support::write_startup_banner_if_ready(
        &mut sink,
        Ok("127.0.0.1:8080".parse().unwrap()),
        &config,
    )
    .unwrap();

    let output = String::from_utf8(sink).unwrap();
    assert_eq!(output.matches("==> 首页地址:").count(), 1);
}

#[test]
fn startup_banner_normalizes_unspecified_ipv4_to_loopback_home_url() {
    let config_path = temp_config_file_path("startup-banner-unspecified-ipv4");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        None,
        config_path.clone(),
        None,
        None,
    )
    .unwrap();

    let banner = koko::support::build_startup_banner_from_bind_addr(config.bind_addr, &config);

    assert_eq!(banner.home_urls[0], "http://127.0.0.1:8080/");
    assert_eq!(banner.admin_url, "http://127.0.0.1:8080/admin");
    assert!(banner.admin_token_notice.is_some());
    assert!(
        banner
            .lan_urls
            .iter()
            .all(|url| url.starts_with("http://") && url.ends_with(":8080/"))
    );
}

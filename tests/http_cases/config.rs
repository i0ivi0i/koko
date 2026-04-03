use super::*;

#[test]
fn app_config_requires_database_url() {
    let config_path = temp_config_file_path("requires-db-url");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let result = koko::support::AppConfig::load_for_test(
        None,
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        None,
    );

    assert!(result.is_err());
}

#[test]
fn app_config_rejects_empty_database_url() {
    let config_path = temp_config_file_path("rejects-empty-db-url");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let result = koko::support::AppConfig::load_for_test(
        Some("   "),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        None,
    );

    assert!(result.is_err());
}

#[test]
fn app_error_code_exposes_stable_membership_required_code() {
    let code = koko::support::app_error_code(&AppError::NotRoomMember {
        room_id: Uuid::from_u128(120),
        session_id: Uuid::from_u128(121),
    });

    assert_eq!(code, "membership_required");
}

#[test]
fn app_error_code_exposes_admin_session_codes() {
    assert_eq!(
        koko::support::app_error_code(&AppError::AdminSessionRequired),
        "admin_session_required"
    );
    assert_eq!(
        koko::support::app_error_code(&AppError::AdminSessionExpired),
        "admin_session_expired"
    );
    assert_eq!(
        koko::support::app_error_code(&AppError::AdminSessionReplaced),
        "admin_session_replaced"
    );
}

#[test]
fn app_config_defaults_bind_addr_to_0_0_0_0_8080() {
    let config_path = temp_config_file_path("default-bind-addr");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        None,
        config_path.clone(),
        Some("local-admin-token"),
        None,
    )
    .unwrap();

    assert_eq!(config.bind_addr.to_string(), "0.0.0.0:8080");
}

#[test]
fn app_config_respects_explicit_bind_addr_override() {
    let config_path = temp_config_file_path("explicit-bind-addr");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        None,
    )
    .unwrap();

    assert_eq!(config.bind_addr.to_string(), "127.0.0.1:8080");
}

#[test]
fn app_config_bootstraps_admin_token_into_config_file() {
    let config_path = temp_config_file_path("bootstrap-admin-token");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let config = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        None,
        None,
    )
    .unwrap();

    assert!(!config.admin_token.is_empty());
    assert!(config.admin_token_notice.is_some());
    let content = fs::read_to_string(&config_path).unwrap();
    assert_eq!(
        content,
        format!("admin_token = \"{}\"\n", config.admin_token)
    );
}

#[test]
fn app_config_imports_admin_token_from_env_once_when_file_missing() {
    let config_path = temp_config_file_path("import-admin-token-once");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let first = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("migrated-admin-token"),
        None,
    )
    .unwrap();
    assert_eq!(first.admin_token, "migrated-admin-token");
    assert!(
        first
            .admin_token_notice
            .as_deref()
            .unwrap_or_default()
            .contains("KOKO_ADMIN_TOKEN")
    );

    let second = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("ignored-token"),
        None,
    )
    .unwrap();
    assert_eq!(second.admin_token, "migrated-admin-token");
    assert!(second.admin_token_notice.is_none());
}

#[test]
fn app_config_respects_admin_cookie_secure_override() {
    let config_path = temp_config_file_path("admin-cookie-secure");
    let _cleanup = TempConfigRootGuard::new(config_path.clone());
    let secure = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        Some("local-admin-token"),
        Some(true),
    )
    .unwrap();
    assert!(secure.admin_cookie_secure);

    let insecure = koko::support::AppConfig::load_for_test(
        Some("postgres://koko:koko_local@127.0.0.1:5432/koko_test"),
        Some("127.0.0.1:8080"),
        config_path.clone(),
        None,
        Some(false),
    )
    .unwrap();
    assert!(!insecure.admin_cookie_secure);
}

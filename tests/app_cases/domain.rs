#[test]
fn crate_exposes_expected_root_modules() {
    use koko::{admin, app, chat, contract, domain, http, rt, store, support, view, web};

    let _ = std::any::type_name::<domain::Room>();
    let _ = std::any::type_name::<app::AppError>();
    let _ = std::any::type_name::<contract::SendTextMessageCommand>();
    let _ = std::any::type_name::<store::PgStore>();
    let _ = std::any::type_name::<rt::Module>();
    let _ = std::any::type_name::<http::Module>();
    let _ = std::any::type_name::<web::Module>();
    let _ = std::any::type_name::<chat::Module>();
    let _ = std::any::type_name::<view::Module>();
    let _ = std::any::type_name::<admin::Module>();
    assert_eq!(support::app_name(), "koko");
}

#[test]
fn crate_source_gates_server_modules_away_from_wasm_builds() {
    let lib_source = include_str!("../../src/lib.rs");
    let main_source = include_str!("../../src/main.rs");
    let cargo_manifest = include_str!("../../Cargo.toml");

    assert!(lib_source.contains("#[cfg(not(target_arch = \"wasm32\"))]\npub mod http;"));
    assert!(lib_source.contains("#[cfg(not(target_arch = \"wasm32\"))]\npub mod rt;"));
    assert!(lib_source.contains("#[cfg(not(target_arch = \"wasm32\"))]\npub mod store;"));
    assert!(main_source.contains("#[cfg(not(target_arch = \"wasm32\"))]"));
    assert!(main_source.contains("#[cfg(target_arch = \"wasm32\")]"));
    assert!(cargo_manifest.contains("[target.'cfg(not(target_arch = \"wasm32\"))'.dependencies]"));
    assert!(cargo_manifest.contains("[target.'cfg(target_arch = \"wasm32\")'.dependencies]"));
}

#[test]
fn crate_root_does_not_keep_placeholder_modules() {
    let lib_source = include_str!("../../src/lib.rs");

    assert!(!lib_source.contains("placeholder_module!"));
    assert!(!lib_source.contains("pub mod panel"));
}

#[test]
fn room_code_is_case_insensitive_and_normalized() {
    let code = koko::domain::RoomCode::new("a1234").unwrap();
    assert_eq!(code.normalized(), "A1234");
}

#[test]
fn room_code_rejects_invalid_shape() {
    assert!(koko::domain::RoomCode::new("ABCDE").is_err());
    assert!(koko::domain::RoomCode::new("1234").is_err());
}

#[test]
fn message_requires_non_empty_body() {
    assert!(koko::domain::MessageBody::new("").is_err());
    assert!(koko::domain::MessageBody::new("   ").is_err());
}


#[test]
fn crate_exposes_expected_root_modules() {
    use koko::{admin, app, chat, contract, domain, http, panel, rt, store, support, view, web};

    let _ = std::any::type_name::<domain::Room>();
    let _ = std::any::type_name::<app::AppError>();
    let _ = std::any::type_name::<contract::SendTextMessageCommand>();
    let _ = std::any::type_name::<store::Module>();
    let _ = std::any::type_name::<rt::Module>();
    let _ = std::any::type_name::<http::Module>();
    let _ = std::any::type_name::<web::Module>();
    let _ = std::any::type_name::<chat::Module>();
    let _ = std::any::type_name::<view::Module>();
    let _ = std::any::type_name::<admin::Module>();
    let _ = std::any::type_name::<panel::Module>();
    assert_eq!(support::app_name(), "koko");
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

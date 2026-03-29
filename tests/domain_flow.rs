#[path = "../src/lib.rs"]
mod koko;

#[test]
fn crate_exposes_expected_root_modules() {
    use koko::{admin, app, chat, contract, domain, http, panel, rt, store, support, view, web};

    let _: Option<domain::Module> = None;
    let _: Option<app::Module> = None;
    let _: Option<contract::Module> = None;
    let _: Option<store::Module> = None;
    let _: Option<rt::Module> = None;
    let _: Option<http::Module> = None;
    let _: Option<web::Module> = None;
    let _: Option<chat::Module> = None;
    let _: Option<view::Module> = None;
    let _: Option<admin::Module> = None;
    let _: Option<panel::Module> = None;
    assert_eq!(support::app_name(), "koko");
}

#[test]
fn crate_exposes_expected_root_modules() {
    let modules = [
        "domain", "app", "contract", "store", "rt",
        "http", "web", "chat", "view", "admin", "panel", "support",
    ];
    assert_eq!(modules.len(), 12);
}

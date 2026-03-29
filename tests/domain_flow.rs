#[test]
fn crate_exposes_expected_root_modules() {
    let expected = [
        "domain", "app", "contract", "store", "rt",
        "http", "web", "chat", "view", "admin", "panel", "support",
    ];

    assert_eq!(koko::root_modules(), expected);
}

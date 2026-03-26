use koko_core::session::bootstrap_anonymous_profile;

#[test]
fn 会话引导应生成稳定客户端身份() {
    let profile = bootstrap_anonymous_profile("device-1").unwrap();
    assert_eq!(profile.device_key(), "device-1");
}

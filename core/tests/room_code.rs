use koko_core::model::RoomCode;

#[test]
fn 合法短码应解析成功() {
    let code = RoomCode::parse("1A234").unwrap();
    assert_eq!(code.as_str(), "1A234");
}

#[test]
fn 非四数字一字母应解析失败() {
    assert!(RoomCode::parse("12345").is_err());
    assert!(RoomCode::parse("AB123").is_err());
}

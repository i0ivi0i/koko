/// 领域层不变量测试：
/// 只测纯业务规则，不依赖数据库、HTTP 或实时协议。
#[test]
fn 非成员不能发消息() {
    let result = koko::domain::message::创建文本消息(false, "你好");
    assert_eq!(result, Err(koko::domain::领域错误::成员资格不足));
}

#[test]
fn 空消息不成立() {
    let result = koko::domain::message::创建文本消息(true, "   ");
    assert_eq!(result, Err(koko::domain::领域错误::消息文本为空));
}

#[test]
fn 非法房间短码不成立() {
    let result = koko::domain::room::校验房间短码("##");
    assert_eq!(result, Err(koko::domain::领域错误::房间短码非法));
}

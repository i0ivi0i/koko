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
fn 纯空文本且无附件时统一消息不成立() {
    let result = koko::domain::message::创建消息(
        true,
        "",
        &[],
    );
    assert_eq!(result, Err(koko::domain::领域错误::消息内容为空));
}

#[test]
fn 纯图片附件消息允许文本为空() {
    let result = koko::domain::message::创建消息(
        true,
        "   ",
        &[koko::domain::message::待发送附件 {
            附件标识: "att-1".to_string(),
            种类: koko::domain::message::附件种类::图片,
            宽: 320,
            高: 240,
        }],
    );
    assert!(result.is_ok());
}

#[test]
fn 第一阶段非图片附件不允许进入消息() {
    let result = koko::domain::message::创建消息(
        true,
        "",
        &[koko::domain::message::待发送附件 {
            附件标识: "att-2".to_string(),
            种类: koko::domain::message::附件种类::视频,
            宽: 0,
            高: 0,
        }],
    );
    assert_eq!(result, Err(koko::domain::领域错误::附件类型不支持));
}

#[test]
fn 非法房间短码不成立() {
    let result = koko::domain::room::校验房间短码("##");
    assert_eq!(result, Err(koko::domain::领域错误::房间短码非法));
}

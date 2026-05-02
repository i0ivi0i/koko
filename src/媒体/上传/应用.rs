use crate::{shared::contract, application};

/// 先在业务真相里申请一个媒体附件占位，再把字节上传交给运输层。
/// 上传业务模块只承认“占位申请”和“prepared -> ready”两段真相，
/// 不顺手创建消息，也不把运输层状态抬成消息事实。
pub fn 准备媒体附件上传(
    仓储: &mut dyn application::仓储端口,
    会话标识: &str,
    附件: &application::媒体附件准备请求,
) -> Result<application::媒体附件准备快照, contract::错误码> {
    if 附件.附件标识.trim().is_empty()
        || 附件.mime_type.trim().is_empty()
        || 附件.原始内容存储键.trim().is_empty()
        || 附件.字节大小 <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    application::校验实时连接会话(仓储, 会话标识)?;
    if let Some(source_hash) = 附件.source_hash.as_deref() {
        if !application::是64位小写hex(source_hash)
            || 附件.source_byte_size.is_none_or(|byte_size| byte_size <= 0)
        {
            return Err(contract::错误码::参数非法);
        }
    } else if 附件.source_byte_size.is_some() || 附件.source_file_name.is_some() {
        return Err(contract::错误码::参数非法);
    }
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(会话标识)?
        .ok_or(contract::错误码::会话无效)?;
    let snapshot = 仓储.创建预备媒体附件记录(&所属匿名身份标识, 附件)?;
    if let Some(source_hash) = 附件.source_hash.as_deref() {
        let source_byte_size = 附件.source_byte_size.ok_or(contract::错误码::参数非法)?;
        // source_hash 跟随附件占位记录落库；后续查询必须经过当前身份、
        // 当前会话可见性和目标房间发送裁决，避免把原文件哈希做成全站探针。
        仓储.记录附件source_hash(
            &snapshot.附件标识,
            source_hash,
            source_byte_size,
            附件.source_file_name.as_deref(),
        )?;
    }
    Ok(snapshot)
}

/// complete 前必须先验证：
/// 1. 当前会话仍然有效；
/// 2. 附件仍归当前发送者所有；
/// 3. 附件现在确实还处于 prepared。
pub fn 读取待完成媒体附件(
    仓储: &dyn application::仓储端口,
    会话标识: &str,
    附件标识: &str,
) -> Result<application::待完成媒体附件读取结果, contract::错误码> {
    if 附件标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    application::校验实时连接会话(仓储, 会话标识)?;
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(会话标识)?
        .ok_or(contract::错误码::会话无效)?;
    let prepared = 仓储
        .查询待完成媒体附件(附件标识)?
        .ok_or(contract::错误码::附件不存在)?;
    // complete 链路不能再吃兼容旧串，否则一旦会话解析切到 identity_uuid，owner 判定就会撕裂。
    if prepared.所属匿名身份标识 != 所属匿名身份标识 {
        return Err(contract::错误码::附件不属于当前发送者);
    }
    if prepared.状态 != application::附件状态读取结果::已准备 {
        return Err(contract::错误码::附件未就绪);
    }
    Ok(prepared)
}

/// 完成上传只负责把 prepared 升级成 ready。
/// 它不创建消息，也不改变消息发送主链。
pub fn 完成媒体附件上传(
    仓储: &mut dyn application::仓储端口,
    会话标识: &str,
    附件: &application::媒体附件写入请求,
) -> Result<application::媒体附件快照, contract::错误码> {
    let prepared = 读取待完成媒体附件(仓储, 会话标识, &附件.附件标识)?;
    if prepared.种类 != 附件.种类 {
        return Err(contract::错误码::附件类型不支持);
    }
    仓储.创建媒体附件记录(&prepared.所属匿名身份标识, 附件)
}

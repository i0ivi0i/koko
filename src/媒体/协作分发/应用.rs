use crate::{shared::contract, usecase};

/// Phase 1 先把“ready 后立刻补齐分发元数据”也收口在媒体分发语义里。
/// handler 只负责调度，不直接越层操纵仓储。
pub fn 写入协作分发元数据(
    仓储: &mut dyn usecase::仓储端口,
    请求: &usecase::协作分发元数据写入请求,
) -> Result<usecase::协作分发元数据快照, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.content_id.trim().is_empty()
        || 请求.content_hash.trim().is_empty()
        || 请求.swarm_id.trim().is_empty()
    {
        return Err(contract::错误码::参数非法);
    }
    仓储.写入协作分发元数据(请求)
}

/// 这条入口给后端 owner（如 seeder 对账）写 swarm 运行态事实：
/// 1. 不再要求“会话必须是房间成员”，因为 backend strong seed 不是前端会话；
/// 2. 仍然强校验 peer_kind 与基础参数，避免 adapter 被脏数据污染；
/// 3. 只写运行态表，不改 attachment 稳定分发表面。
pub fn 写入协作分发swarm存活(
    仓储: &mut dyn usecase::仓储端口,
    请求: &usecase::协作分发swarm存活写入请求,
) -> Result<(), contract::错误码> {
    if 请求.swarm_id.trim().is_empty()
        || 请求.附件标识.trim().is_empty()
        || 请求.会话标识.trim().is_empty()
        || 请求.存活类型.trim().is_empty()
        || 请求.最近peer存活时间戳秒 <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    if !usecase::是有效协作分发存活类型(请求.存活类型.as_str()) {
        return Err(contract::错误码::参数非法);
    }
    仓储.写入协作分发swarm存活(请求)
}

pub fn 写入协作分发torrent元信息(
    仓储: &mut dyn usecase::仓储端口,
    请求: &usecase::协作分发torrent元信息写入请求,
) -> Result<usecase::协作分发torrent元信息快照, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.torrent_info_hash.trim().is_empty()
        || 请求.torrent_bytes.is_empty()
        || 请求.piece_length字节 <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    仓储.写入协作分发torrent元信息(请求)
}

/// 读取附件内容：
/// 1. 会话必须有效；
/// 2. 附件必须存在且 ready；
/// 3. 实际可见性仍按“当前会话是否能看到引用该附件的消息”裁决。
pub fn 读取附件内容(
    仓储: &dyn usecase::仓储端口,
    附件标识: &str,
    会话标识: &str,
    变体: usecase::附件内容变体,
) -> Result<usecase::附件内容读取结果, contract::错误码> {
    if 附件标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    usecase::校验实时连接会话(仓储, 会话标识)?;
    let snapshot = 仓储
        .查询附件快照(附件标识)?
        .ok_or(contract::错误码::附件不存在)?;
    if snapshot.状态 != usecase::附件状态读取结果::就绪 {
        return Err(contract::错误码::附件未就绪);
    }
    if matches!(变体, usecase::附件内容变体::原图) {
        let 当前时间戳秒 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or_default();
        if !usecase::冷源生命周期当前可用(
            snapshot.原始冷源到期时间戳秒,
            snapshot.原始冷源删除时间戳秒,
            当前时间戳秒,
        ) {
            return Err(contract::错误码::附件不存在);
        }
    }
    仓储
        .查询附件可读内容(附件标识, 会话标识, 变体)?
        .ok_or(contract::错误码::成员资格不足)
}

/// locator 是受控 transport 入口：
/// - 业务层只回答“当前附件是什么、是否 ready、当前会话是否允许拿到 transport 线索”；
/// - 不把存储键、房间 id、owner 等实现细节交给壳层。
pub fn 查询媒体定位(
    仓储: &dyn usecase::仓储端口,
    附件标识: &str,
    会话标识: &str,
) -> Result<usecase::媒体定位结果, contract::错误码> {
    if 附件标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    usecase::校验实时连接会话(仓储, 会话标识)?;
    let snapshot = 仓储
        .查询附件快照(附件标识)?
        .ok_or(contract::错误码::附件不存在)?;
    // locator 允许“已删除附件”继续走同一条受控查询链，
    // 这样后端才能给前端返回稳定的 MEDIA_DELETED，而不是模糊的 not_ready 错误。
    if !matches!(
        snapshot.状态,
        usecase::附件状态读取结果::就绪 | usecase::附件状态读取结果::已过期
    ) {
        return Err(contract::错误码::附件未就绪);
    }
    仓储
        .查询附件可读内容(附件标识, 会话标识, usecase::附件内容变体::原图)?
        .ok_or(contract::错误码::成员资格不足)?;
    let kind = match snapshot.种类 {
        usecase::附件种类读取结果::图片 => usecase::媒体附件类型::图片,
        usecase::附件种类读取结果::视频 => usecase::媒体附件类型::视频,
        _ => return Err(contract::错误码::附件类型不支持),
    };
    let distribution = 仓储.查询协作分发元数据(附件标识)?;
    let streaming_manifest = match kind {
        usecase::媒体附件类型::视频 => 仓储.查询流媒体清单元数据(附件标识)?,
        usecase::媒体附件类型::图片 => None,
    };
    Ok(usecase::媒体定位结果 {
        附件标识: snapshot.附件标识,
        种类: kind.clone(),
        mime_type: snapshot.mime_type,
        状态: snapshot.状态,
        宽: snapshot.宽,
        高: snapshot.高,
        允许缩略图: snapshot.允许缩略图,
        原始冷源到期时间戳秒: snapshot.原始冷源到期时间戳秒,
        原始冷源删除时间戳秒: snapshot.原始冷源删除时间戳秒,
        协作分发: distribution,
        流媒体清单: streaming_manifest,
    })
}

/// 0-24h 强 seed 的候选集合是后台对账输入，不面向壳层展示。
/// 约束：
/// 1. 时间与限制参数必须合法；
/// 2. 具体筛选条件由仓储实现保持与权威表一致。
pub fn 列出待做种协作分发项(
    仓储: &dyn usecase::仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<usecase::待做种协作分发项>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待做种协作分发项(当前时间戳秒, 限制条数)
}

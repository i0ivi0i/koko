use crate::{message, room, shared::contract};

use super::模型::*;

/// 媒体 owner 专属仓储边界。
///
/// 约束：
/// 1. 这里只放附件上传、资产复用、协作分发与后台清理的持久化能力；
/// 2. 媒体如果需要会话/成员/消息主链能力，显式复用消息 owner 的最小端口，而不是回灌共享应用总口；
/// 3. 任何媒体子域函数需要额外能力时，优先判断是不是媒体真需要，而不是顺手加回共享中心。
pub trait 媒体仓储端口: message::application::消息仓储端口 {
    fn 查询待完成媒体附件(
        &self,
        附件标识: &str,
    ) -> Result<Option<待完成媒体附件读取结果>, contract::错误码>;

    fn 创建预备媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &媒体附件准备请求,
    ) -> Result<媒体附件准备快照, contract::错误码>;

    fn 回滚预备媒体附件记录(
        &mut self,
        附件标识: &str,
    ) -> Result<(), contract::错误码>;

    fn 创建媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &媒体附件写入请求,
    ) -> Result<媒体附件快照, contract::错误码>;

    fn 记录附件source_hash(
        &mut self,
        附件标识: &str,
        source_hash: &str,
        source_byte_size: i64,
        source_file_name: Option<&str>,
    ) -> Result<(), contract::错误码>;

    fn 查询可复用source_hash媒体资产(
        &self,
        会话标识: &str,
        目标房间标识: &str,
        当前匿名身份标识: &str,
        source_hash: &str,
        source_byte_size: i64,
        种类: 媒体附件类型,
    ) -> Result<Option<可复用媒体资产>, contract::错误码>;

    fn 查询可转发媒体资产(
        &self,
        会话标识: &str,
        源附件标识: &str,
        种类: 媒体附件类型,
    ) -> Result<Option<可复用媒体资产>, contract::错误码>;

    fn 写入canonical媒体资产(
        &mut self,
        请求: &Canonical媒体资产写入请求,
    ) -> Result<(), contract::错误码>;

    fn 绑定附件canonical媒体资产(
        &mut self,
        附件标识: &str,
        content_hash: &str,
    ) -> Result<(), contract::错误码>;

    fn 写入协作分发元数据(
        &mut self,
        请求: &协作分发元数据写入请求,
    ) -> Result<协作分发元数据快照, contract::错误码>;

    fn 查询协作分发元数据(
        &self,
        附件标识: &str,
    ) -> Result<Option<协作分发元数据快照>, contract::错误码>;

    fn 列出待做种协作分发项(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待做种协作分发项>, contract::错误码>;

    fn 写入协作分发swarm存活(
        &mut self,
        请求: &协作分发swarm存活写入请求,
    ) -> Result<(), contract::错误码>;

    fn 查询协作分发torrent元信息(
        &self,
        附件标识: &str,
    ) -> Result<Option<协作分发torrent元信息快照>, contract::错误码>;

    fn 写入协作分发torrent元信息(
        &mut self,
        请求: &协作分发torrent元信息写入请求,
    ) -> Result<协作分发torrent元信息快照, contract::错误码>;

    fn 写入流媒体清单元数据(
        &mut self,
        请求: &流媒体清单写入请求,
    ) -> Result<流媒体清单快照, contract::错误码>;

    fn 查询流媒体清单元数据(
        &self,
        附件标识: &str,
    ) -> Result<Option<流媒体清单快照>, contract::错误码>;

    fn 查询附件可读内容(
        &self,
        附件标识: &str,
        会话标识: &str,
        变体: 附件内容变体,
    ) -> Result<Option<附件内容读取结果>, contract::错误码>;

    fn 列出待清理媒体冷源(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理媒体冷源>, contract::错误码>;

    fn 标记媒体冷源已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码>;

    fn 列出待清理canonical媒体资产(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理Canonical媒体资产>, contract::错误码>;

    fn 标记canonical媒体资产已删除(
        &mut self,
        content_hash: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码>;

    fn 列出待清理媒体回退母本(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理媒体回退母本>, contract::错误码>;

    fn 标记媒体回退母本已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码>;

    fn 列出待清理流媒体清单(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理流媒体清单>, contract::错误码>;

    fn 标记流媒体清单已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码>;

    fn 列出待清理上传残留(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理上传残留>, contract::错误码>;

    fn 标记上传残留已清理(
        &mut self,
        上传会话标识: &str,
        清理原因: 上传残留清理原因,
        清理时间戳秒: i64,
    ) -> Result<(), contract::错误码>;

    fn 标记媒体上传已放弃(
        &mut self,
        附件标识: &str,
        放弃时间戳秒: i64,
    ) -> Result<(), contract::错误码>;
}

/// 只在媒体业务内部流转的 source_hash 记录。
/// 它不对外暴露，目的是把“复用现有 canonical 资产时仍要补回原文件强哈希”
/// 这件事明确留在媒体 owner 内部，而不是散落到壳层或共享入口。
struct SourceHash附件记录<'a> {
    source_hash: &'a str,
    source_byte_size: i64,
    source_file_name: Option<&'a str>,
}

/// 从已有 canonical 资产派生当前业务附件引用。
///
/// 这条内部主链同时服务 source_hash 秒传和转发：
/// 1. 只新增当前发送者拥有的 ready 附件事实；
/// 2. 只绑定同一份 canonical 物理资产；
/// 3. 只复用同一份 swarm/torrent 线索；
/// 4. 绝不复制旧消息、旧房间或旧上传者事实。
fn 用可复用资产创建ready附件引用(
    仓储: &mut impl 媒体仓储端口,
    所属匿名身份标识: &str,
    新附件标识: &str,
    asset: &可复用媒体资产,
    source_hash记录: Option<SourceHash附件记录<'_>>,
) -> Result<(媒体附件快照, 协作分发元数据快照, 协作分发torrent元信息快照), contract::错误码> {
    let ready_request = 媒体附件写入请求 {
        附件标识: 新附件标识.to_string(),
        种类: asset.种类.clone(),
        mime_type: asset.mime_type.clone(),
        字节大小: asset.字节大小,
        宽: asset.宽,
        高: asset.高,
        原始内容存储键: asset.存储键.clone(),
        缩略图存储键: None,
        资产原图存储键: None,
        完整图存储键: None,
        原始冷源到期时间戳秒: Some(asset.origin_expires_at秒),
        回退母本存储键: None,
        回退母本到期时间戳秒: None,
    };
    let snapshot = 仓储.创建媒体附件记录(所属匿名身份标识, &ready_request)?;
    if let Some(记录) = source_hash记录 {
        仓储.记录附件source_hash(
            &snapshot.附件标识,
            记录.source_hash,
            记录.source_byte_size,
            记录.source_file_name,
        )?;
    }
    仓储.绑定附件canonical媒体资产(&snapshot.附件标识, &asset.content_hash)?;

    let distribution_request = 协作分发元数据写入请求 {
        附件标识: snapshot.附件标识.clone(),
        content_id: format!("content_{}", snapshot.附件标识),
        content_hash: asset.content_hash.clone(),
        swarm_id: format!("swarm_{}", asset.content_hash),
        web_seed_until秒: asset.web_seed_until秒,
    };
    let mut distribution = 仓储.写入协作分发元数据(&distribution_request)?;
    let torrent_request = 协作分发torrent元信息写入请求 {
        附件标识: snapshot.附件标识.clone(),
        torrent_bytes: asset.torrent_bytes.clone(),
        torrent_info_hash: asset.torrent_info_hash.clone(),
        piece_length字节: asset.piece_length字节,
    };
    let torrent = 仓储.写入协作分发torrent元信息(&torrent_request)?;
    distribution.torrent_info_hash = Some(torrent.torrent_info_hash.clone());

    Ok((snapshot, distribution, torrent))
}

/// source_hash 命中已有 ready 资产时，直接在媒体 owner 内生成新的 ready 附件引用。
/// 这条链不创建消息，也不发明第二套房间真相，只负责附件资产复用。
pub fn 复用source_hash媒体附件(
    仓储: &mut impl 媒体仓储端口,
    请求: &SourceHash媒体复用请求,
) -> Result<SourceHash媒体复用结果, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || !是64位小写hex(请求.source_hash.as_str())
        || 请求.source_byte_size <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    room::application::校验房间订阅资格(仓储, &请求.房间标识, &请求.会话标识)?;
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(&请求.会话标识)?
        .ok_or(contract::错误码::会话无效)?;

    let Some(asset) = 仓储.查询可复用source_hash媒体资产(
        &请求.会话标识,
        &请求.房间标识,
        &所属匿名身份标识,
        &请求.source_hash,
        请求.source_byte_size,
        请求.种类.clone(),
    )?
    else {
        return Ok(SourceHash媒体复用结果::Miss);
    };

    let (snapshot, distribution, torrent) = 用可复用资产创建ready附件引用(
        仓储,
        &所属匿名身份标识,
        &请求.附件标识,
        &asset,
        Some(SourceHash附件记录 {
            source_hash: &请求.source_hash,
            source_byte_size: 请求.source_byte_size,
            source_file_name: 请求.source_file_name.as_deref(),
        }),
    )?;

    Ok(SourceHash媒体复用结果::Reused(Box::new(SourceHash媒体复用命中 {
        附件: snapshot,
        协作分发: distribution,
        torrent,
    })))
}

/// 转发只复用现有媒体资产，再把新附件继续送回统一消息主链。
/// 这样房间成员资格、消息成立性和事件顺序仍由消息 owner 统一裁决。
pub fn 转发媒体附件到房间(
    仓储: &mut impl 媒体仓储端口,
    请求: &媒体附件转发请求,
) -> Result<媒体附件转发结果, contract::错误码> {
    if 请求.会话标识.trim().is_empty()
        || 请求.目标房间标识.trim().is_empty()
        || 请求.源附件标识.trim().is_empty()
        || 请求.新附件标识.trim().is_empty()
        || 请求.客户端消息标识.trim().is_empty()
    {
        return Err(contract::错误码::参数非法);
    }
    room::application::校验房间订阅资格(仓储, &请求.目标房间标识, &请求.会话标识)?;
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(&请求.会话标识)?
        .ok_or(contract::错误码::会话无效)?;
    let asset = 仓储
        .查询可转发媒体资产(&请求.会话标识, &请求.源附件标识, 请求.种类.clone())?
        .ok_or(contract::错误码::附件不存在)?;

    let (snapshot, distribution, torrent) = 用可复用资产创建ready附件引用(
        仓储,
        &所属匿名身份标识,
        &请求.新附件标识,
        &asset,
        None,
    )?;

    let message_event = message::application::创建消息(
        仓储,
        &请求.目标房间标识,
        &请求.会话标识,
        &请求.客户端消息标识,
        &请求.文本,
        std::slice::from_ref(&snapshot.附件标识),
    )?;

    Ok(媒体附件转发结果 {
        消息事件: message_event,
        附件: snapshot,
        协作分发: distribution,
        torrent,
    })
}

/// 协作分发运行态存活要先确认附件当前确实还有受控定位与分发真相。
/// 这样 backend seeder 和前端 peer 都落在同一条媒体权威链上。
pub fn 写入协作分发存活(
    仓储: &mut impl 媒体仓储端口,
    请求: &协作分发存活写入请求,
) -> Result<(), contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.会话标识.trim().is_empty()
        || 请求.存活类型.trim().is_empty()
        || 请求.最近peer存活时间戳秒 <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    if !是有效协作分发存活类型(请求.存活类型.as_str()) {
        return Err(contract::错误码::参数非法);
    }
    let locator =
        super::distribution::application::查询媒体定位(仓储, &请求.附件标识, &请求.会话标识)?;
    let distribution = locator.协作分发.ok_or(contract::错误码::附件未就绪)?;
    super::distribution::application::写入协作分发swarm存活(
        仓储,
        &协作分发swarm存活写入请求 {
            swarm_id: distribution.swarm_id,
            附件标识: 请求.附件标识.clone(),
            会话标识: 请求.会话标识.clone(),
            存活类型: 请求.存活类型.clone(),
            最近peer存活时间戳秒: 请求.最近peer存活时间戳秒,
        },
    )
}

/// 流媒体清单是媒体资产的一部分稳定真相，参数校验也必须留在媒体 owner。
pub fn 写入流媒体清单元数据(
    仓储: &mut impl 媒体仓储端口,
    请求: &流媒体清单写入请求,
) -> Result<流媒体清单快照, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.hls主清单存储键.trim().is_empty()
        || 请求.dash主清单存储键.trim().is_empty()
        || 请求.streaming到期时间戳秒 < 0
        || 请求.streaming删除时间戳秒.is_some_and(|value| value < 0)
    {
        return Err(contract::错误码::参数非法);
    }
    仓储.写入流媒体清单元数据(请求)
}

/// 后端强 seed / 诊断壳只读 metainfo 时，也必须通过媒体 owner 的参数校验。
pub fn 读取协作分发torrent元信息(
    仓储: &impl 媒体仓储端口,
    附件标识: &str,
) -> Result<Option<协作分发torrent元信息快照>, contract::错误码> {
    if 附件标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    仓储.查询协作分发torrent元信息(附件标识)
}

/// 背景清理循环只做“把该删除的冷源挑出来”这一层过滤。
/// 真正的对象删除仍由 shell/adapter 执行，避免应用层直接依赖对象存储实现。
pub fn 列出待清理媒体冷源(
    仓储: &impl 媒体仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<待清理媒体冷源>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待清理媒体冷源(当前时间戳秒, 限制条数)
}

/// 原始对象一旦删掉，就必须把删除时间回写到附件真相。
/// 这样 locator、旧 original 路由和分发 runtime 才能共享同一条冷源退场事实。
pub fn 标记媒体冷源已删除(
    仓储: &mut impl 媒体仓储端口,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if 附件标识.trim().is_empty() || 删除时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.标记媒体冷源已删除(附件标识, 删除时间戳秒)
}

pub fn 列出待清理canonical媒体资产(
    仓储: &impl 媒体仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<待清理Canonical媒体资产>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待清理canonical媒体资产(当前时间戳秒, 限制条数)
}

pub fn 标记canonical媒体资产已删除(
    仓储: &mut impl 媒体仓储端口,
    content_hash: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if !是64位小写hex(content_hash) || 删除时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.标记canonical媒体资产已删除(content_hash, 删除时间戳秒)
}

/// 视频 mezzanine TTL 到期后，只能回收短期回退层本身，不能误删流媒体主资产。
pub fn 列出待清理媒体回退母本(
    仓储: &impl 媒体仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<待清理媒体回退母本>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待清理媒体回退母本(当前时间戳秒, 限制条数)
}

/// 标准流媒体冷备窗口结束后，只允许回收 manifest/segment 本身。
/// distribution/swarm 线索必须继续活在另一条权威面，不能被这条 cleanup 顺手抹掉。
pub fn 列出待清理流媒体清单(
    仓储: &impl 媒体仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<待清理流媒体清单>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待清理流媒体清单(当前时间戳秒, 限制条数)
}

/// 服务端 manifest/segment 删除成功后，应用层要留下 streaming_deleted_at。
/// 这样后续 locator、受控读取和 cleanup 重试才能共用同一条退场事实。
pub fn 标记流媒体清单已删除(
    仓储: &mut impl 媒体仓储端口,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if 附件标识.trim().is_empty() || 删除时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.标记流媒体清单已删除(附件标识, 删除时间戳秒)
}

/// 上传残留清理是上传生命周期的尾处理：
/// 1. abandoned session 的残留必须退场；
/// 2. final concat 成功后的 partial 文件不再有长期价值；
/// 3. 过期 unfinished upload 也不能永远卡在 prepared。
pub fn 列出待清理上传残留(
    仓储: &impl 媒体仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<待清理上传残留>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待清理上传残留(当前时间戳秒, 限制条数)
}

/// shell 真删完残留文件之后，应用层要把“这批残留已经清掉”回写真相。
/// 这里故意只收口到 upload_session，避免 adapter/shell 重新发明 attachment 级第二套清理锚点。
pub fn 标记上传残留已清理(
    仓储: &mut impl 媒体仓储端口,
    上传会话标识: &str,
    清理原因: 上传残留清理原因,
    清理时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if 上传会话标识.trim().is_empty() || 清理时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.标记上传残留已清理(上传会话标识, 清理原因, 清理时间戳秒)
}

/// mezzanine 删除事实要单独回写，避免 locator 继续把过期回退层冒充可用 original。
pub fn 标记媒体回退母本已删除(
    仓储: &mut impl 媒体仓储端口,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if 附件标识.trim().is_empty() || 删除时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.标记媒体回退母本已删除(附件标识, 删除时间戳秒)
}

/// 显式放弃旧上传：
/// 1. 只有 owner 自己能放弃；
/// 2. ready 附件不能走这条退场路径；
/// 3. 一旦放弃，就必须把附件和 transport 一起标脏，后面的 hook/complete 才不会复活旧上传。
pub fn 放弃媒体上传(
    仓储: &mut impl 媒体仓储端口,
    会话标识: &str,
    附件标识: &str,
    放弃时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if 附件标识.trim().is_empty() || 放弃时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    room::application::校验实时连接会话(仓储, 会话标识)?;
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(会话标识)?
        .ok_or(contract::错误码::会话无效)?;
    let snapshot = 仓储
        .查询附件快照(附件标识)?
        .ok_or(contract::错误码::附件不存在)?;
    if snapshot.所属匿名身份标识 != 所属匿名身份标识 {
        return Err(contract::错误码::附件不属于当前发送者);
    }
    if snapshot.状态 == 附件状态读取结果::就绪 {
        return Err(contract::错误码::附件未就绪);
    }
    if snapshot.状态 == 附件状态读取结果::已过期 {
        return Ok(());
    }
    仓储.标记媒体上传已放弃(附件标识, 放弃时间戳秒)
}

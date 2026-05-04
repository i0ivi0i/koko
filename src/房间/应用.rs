use crate::{application, domain, shared::contract};

/// 只负责“会话有效 / 房间存在 / 成员资格”三件基础事实的最小房间读口。
///
/// 它被单独切出来，是因为消息、媒体、恢复和 realtime 都需要这些事实，
/// 但它们不该因此把“历史页 / 快照 / 阅读推进 / 进房建房”整包带走。
pub trait 会话房间校验仓储端口 {
    fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码>;

    fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码>;

    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码>;
}

/// 房间上下文自己的完整冷路径仓储口。
/// 这里才允许出现“进房 / 快照 / 历史 / 增量 / 阅读推进”这些房间真相动作。
pub trait 房间仓储端口: 会话房间校验仓储端口 {
    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<contract::快照, contract::错误码>;

    fn 查询房间最新事件位置(
        &self,
        房间标识: &str,
    ) -> Result<Option<i64>, contract::错误码>;

    fn 拉取房间快照(
        &self,
        房间标识: &str,
        上次已读事件位置: Option<i64>,
        首条未读事件位置: Option<i64>,
    ) -> Result<contract::快照, contract::错误码>;

    fn 查询房间阅读位置(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<Option<i64>, contract::错误码>;

    fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码>;

    fn 拉取房间历史页(
        &self,
        房间标识: &str,
        截止位置之前: i64,
        限制条数: i64,
    ) -> Result<contract::快照, contract::错误码>;

    fn 推进房间阅读位置(
        &mut self,
        房间标识: &str,
        会话标识: &str,
        已读到事件位置: i64,
    ) -> Result<(), contract::错误码>;
}

/// realtime / 冷路径 / 媒体复用的最小会话校验。
/// 这条规则必须留在房间 owner，而不是散落到 handler、媒体或消息里各判各的。
pub fn 校验实时连接会话(
    仓储: &impl 会话房间校验仓储端口,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let exists = 仓储.检查会话存在(会话标识)?;
    if exists {
        Ok(())
    } else {
        Err(contract::错误码::会话无效)
    }
}

/// 房间存在性校验只负责把“有没有这个房间”说清楚。
/// 这样后续成员资格失败就不会把 `room_not_found` 吞成 `membership_required`。
pub fn 校验房间存在(
    仓储: &impl 会话房间校验仓储端口,
    房间标识: &str,
) -> Result<(), contract::错误码> {
    if 仓储.检查房间存在(房间标识)? {
        Ok(())
    } else {
        Err(contract::错误码::房间不存在)
    }
}

/// realtime / 冷路径 / 媒体转发共用的订阅资格校验。
/// 成员资格真相仍只由房间应用层裁决，外壳与适配层都不能私自宣布“能发能看”。
pub fn 校验房间订阅资格(
    仓储: &impl 会话房间校验仓储端口,
    房间标识: &str,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let is_member = 仓储.检查成员资格(房间标识, 会话标识)?;
    domain::member::校验成员可发言(is_member).map_err(application::映射领域错误)
}

/// 进房/建房主链：
/// 1. 先在领域层校验短码语义。
/// 2. 再进入仓储完成事实写入。
/// 3. 这条链现在归房间业务模块 owner，不再继续挤在共享应用入口里。
pub fn 按短码进房或建房(
    仓储: &mut impl 房间仓储端口,
    会话标识: &str,
    房间短码: &str,
) -> Result<contract::快照, contract::错误码> {
    domain::room::校验房间短码(房间短码).map_err(application::映射领域错误)?;
    仓储.按短码进房或建房(会话标识, 房间短码)
}

/// 加载房间增量事件用例：
/// 1. 参数合法性校验。
/// 2. 会话有效性校验。
/// 3. 房间存在性校验。
/// 4. 成员资格校验。
/// 5. 返回该位置之后的权威增量。
pub fn 加载房间增量事件(
    仓储: &impl 房间仓储端口,
    房间标识: &str,
    会话标识: &str,
    从位置开始: i64,
) -> Result<contract::快照, contract::错误码> {
    if 从位置开始 < 0 {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
    校验房间存在(仓储, 房间标识)?;
    校验房间订阅资格(仓储, 房间标识, 会话标识)?;
    仓储.拉取房间增量事件(房间标识, 从位置开始)
}

/// 加载房间更早历史页用例：
/// 1. 参数合法性校验。
/// 2. 会话有效性校验。
/// 3. 房间存在性校验。
/// 4. 成员资格校验。
/// 5. 返回该顺序锚点之前的一页历史消息。
pub fn 加载房间历史页(
    仓储: &impl 房间仓储端口,
    房间标识: &str,
    会话标识: &str,
    截止位置之前: i64,
    限制条数: i64,
) -> Result<contract::快照, contract::错误码> {
    if 截止位置之前 <= 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
    校验房间存在(仓储, 房间标识)?;
    校验房间订阅资格(仓储, 房间标识, 会话标识)?;
    // limit 在应用层统一收口，避免某个壳把历史页放大成巨批次，把冷路径拉重。
    let limit = 限制条数.min(55);
    仓储.拉取房间历史页(房间标识, 截止位置之前, limit)
}

/// 推进房间阅读位置用例：
/// 1. 参数合法性校验。
/// 2. 会话有效性校验。
/// 3. 房间存在性校验。
/// 4. 成员资格校验。
/// 5. 不允许越过房间当前 latest_event_position。
/// 6. 最终按身份级锚点单调写入。
pub fn 推进房间阅读位置(
    仓储: &mut impl 房间仓储端口,
    房间标识: &str,
    会话标识: &str,
    已读到事件位置: i64,
) -> Result<contract::命令结果, contract::错误码> {
    if 已读到事件位置 < 0 {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
    校验房间存在(仓储, 房间标识)?;
    校验房间订阅资格(仓储, 房间标识, 会话标识)?;
    let latest_event_position = 仓储
        .查询房间最新事件位置(房间标识)?
        .ok_or(contract::错误码::房间不存在)?;
    // 阅读推进只能落在已经成立的权威事件范围内，不能把未来位置写成已读。
    if 已读到事件位置 > latest_event_position {
        return Err(contract::错误码::参数非法);
    }
    仓储.推进房间阅读位置(房间标识, 会话标识, 已读到事件位置)?;
    Ok(contract::命令结果::成功)
}

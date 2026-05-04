use crate::{application, domain, shared::contract};

/// realtime 热路径只共享最小的会话 / 房间 / 成员事实查询。
/// 它和冷路径共用同一条业务语义，但不再共用一个跨上下文 async 总口。
#[allow(async_fn_in_trait)]
pub trait 实时会话房间校验仓储端口 {
    async fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码>;

    async fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码>;

    async fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码>;
}

/// realtime 房间热路径自己的最小仓储口。
/// 当前只承接“订阅补洞读增量”这条高频链路，不把消息创建和附件读取整包塞进来。
#[allow(async_fn_in_trait)]
pub trait 实时房间仓储端口: 实时会话房间校验仓储端口 {
    async fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码>;
}

/// realtime 连接会话校验的异步版：
/// 热路径直接 await 仓储查询，不再经过 blocking 线程池桥接。
/// 这条能力被单独放入 realtime 业务模块，是为了让 handler 明确依赖热路径 owner。
pub async fn 校验实时连接会话_异步(
    仓储: &impl 实时会话房间校验仓储端口,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let exists = 仓储.检查会话存在(会话标识).await?;
    if exists {
        Ok(())
    } else {
        Err(contract::错误码::会话无效)
    }
}

/// 异步房间存在性校验只负责把“有没有这个房间”说清楚。
/// 这样实时链上的成员失败就不会把 `room_not_found` 吞成 `membership_required`。
pub async fn 校验房间存在_异步(
    仓储: &impl 实时会话房间校验仓储端口,
    房间标识: &str,
) -> Result<(), contract::错误码> {
    if 仓储.检查房间存在(房间标识).await? {
        Ok(())
    } else {
        Err(contract::错误码::房间不存在)
    }
}

/// async 热路径和同步冷路径必须共用同一条成员资格真相。
/// 这样 socket handler 才不会为了“方便”再长一层私有权限判断。
pub async fn 校验房间订阅资格_异步(
    仓储: &impl 实时会话房间校验仓储端口,
    房间标识: &str,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let is_member = 仓储.检查成员资格(房间标识, 会话标识).await?;
    domain::member::校验成员可发言(is_member).map_err(application::映射领域错误)
}

/// realtime 订阅首帧补洞的异步版。
/// 这里刻意保持“会话 -> 房间存在 -> 成员资格 -> 拉增量”的顺序，
/// 让 handler 只负责把权威裁决翻译成 `control_result / room_events`。
pub async fn 加载房间增量事件_异步(
    仓储: &impl 实时房间仓储端口,
    房间标识: &str,
    会话标识: &str,
    从位置开始: i64,
) -> Result<contract::快照, contract::错误码> {
    if 从位置开始 < 0 {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话_异步(仓储, 会话标识).await?;
    校验房间存在_异步(仓储, 房间标识).await?;
    校验房间订阅资格_异步(仓储, 房间标识, 会话标识).await?;
    仓储.拉取房间增量事件(房间标识, 从位置开始).await
}

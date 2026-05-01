use crate::{contract, usecase};

/// realtime 连接会话校验的异步版：
/// 热路径直接 await 仓储查询，不再经过 blocking 线程池桥接。
/// 这条能力被单独放入 realtime 业务模块，是为了让 handler 明确依赖热路径 owner。
pub async fn 校验实时连接会话_异步<R: usecase::Realtime仓储端口 + ?Sized>(
    仓储: &R,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let exists = 仓储.检查会话存在(会话标识).await?;
    if exists {
        Ok(())
    } else {
        Err(contract::错误码::会话无效)
    }
}

/// realtime 订阅首帧补洞的异步版。
/// 这里刻意保持“会话 -> 房间存在 -> 成员资格 -> 拉增量”的顺序，
/// 让 handler 只负责把权威裁决翻译成 `control_result / room_events`。
pub async fn 加载房间增量事件_异步<R: usecase::Realtime仓储端口 + ?Sized>(
    仓储: &R,
    房间标识: &str,
    会话标识: &str,
    从位置开始: i64,
) -> Result<contract::快照, contract::错误码> {
    if 从位置开始 < 0 {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话_异步(仓储, 会话标识).await?;
    usecase::校验房间存在_异步(仓储, 房间标识).await?;
    usecase::校验房间订阅资格_异步(仓储, 房间标识, 会话标识).await?;
    仓储.拉取房间增量事件(房间标识, 从位置开始).await
}

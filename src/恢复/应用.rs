use crate::{room::application as 房间应用, shared::contract};

/// 加载房间恢复快照：
/// 1. 先确认会话有效，禁止拿伪造 session 读取恢复真相。
/// 2. 再确认房间存在与成员资格，禁止未入房会话越权恢复。
/// 3. 最后基于权威最新位置与已读锚点裁决首条未读位置。
///
/// 这条链之所以单独落到 `recovery` 模块，
/// 是为了把“恢复成立性”从普通房间查询里分离出来，
/// 避免后面又把体验恢复、本地缓存恢复和房间真相恢复揉成一团。
pub fn 加载房间快照(
    仓储: &impl 房间应用::房间仓储端口,
    房间标识: &str,
    会话标识: &str,
) -> Result<contract::快照, contract::错误码> {
    房间应用::校验实时连接会话(仓储, 会话标识)?;
    房间应用::校验房间存在(仓储, 房间标识)?;
    房间应用::校验房间订阅资格(仓储, 房间标识, 会话标识)?;

    let latest_event_position = 仓储
        .查询房间最新事件位置(房间标识)?
        .ok_or(contract::错误码::房间不存在)?;
    let last_read_event_position = 仓储.查询房间阅读位置(房间标识, 会话标识)?;

    // 首条未读位置只能由后端权威事件顺序与已读锚点共同裁决，
    // 禁止前端、本地缓存或壳层自己猜。
    let first_unread_event_position = match last_read_event_position {
        Some(last_read_event_position) if last_read_event_position < latest_event_position => {
            Some(last_read_event_position + 1)
        }
        _ => None,
    };

    仓储.拉取房间快照(
        房间标识,
        last_read_event_position,
        first_unread_event_position,
    )
}

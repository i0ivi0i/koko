use crate::{contract, domain};

/// 用例层只编排业务动作，持久化细节通过端口下沉到适配层实现。
pub trait 仓储端口 {
    fn 创建匿名会话(
        &mut self, 显示名: &str
    ) -> Result<contract::快照, contract::错误码>;

    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<contract::快照, contract::错误码>;

    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码>;

    fn 拉取房间快照(
        &self, 房间标识: &str
    ) -> Result<contract::快照, contract::错误码>;

    fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码>;
}

pub fn 引导匿名会话(
    仓储: &mut dyn 仓储端口,
    显示名: &str,
) -> Result<contract::快照, contract::错误码> {
    仓储.创建匿名会话(显示名)
}

pub fn 按短码进房或建房(
    仓储: &mut dyn 仓储端口,
    会话标识: &str,
    房间短码: &str,
) -> Result<contract::快照, contract::错误码> {
    domain::room::校验房间短码(房间短码).map_err(映射领域错误)?;
    仓储.按短码进房或建房(会话标识, 房间短码)
}

pub fn 加载房间快照(
    仓储: &dyn 仓储端口,
    房间标识: &str,
    会话标识: &str,
) -> Result<contract::快照, contract::错误码> {
    let is_member = 仓储.检查成员资格(房间标识, 会话标识)?;
    domain::member::校验成员可发言(is_member).map_err(映射领域错误)?;
    仓储.拉取房间快照(房间标识)
}

pub fn 发送文本消息(
    仓储: &mut dyn 仓储端口,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
) -> Result<contract::领域事件, contract::错误码> {
    if 客户端消息标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    let is_member = 仓储.检查成员资格(房间标识, 会话标识)?;
    let msg = domain::message::创建文本消息(is_member, 文本).map_err(映射领域错误)?;
    仓储.创建消息事件(房间标识, 客户端消息标识, 会话标识, &msg.文本)
}

fn 映射领域错误(err: domain::领域错误) -> contract::错误码 {
    match err {
        domain::领域错误::成员资格不足 => contract::错误码::成员资格不足,
        domain::领域错误::消息文本为空 | domain::领域错误::房间短码非法 => {
            contract::错误码::参数非法
        }
    }
}

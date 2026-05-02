use crate::{shared::contract, domain};

/// 跨业务仍共同消费的应用层入口。
///
/// 这里不再回灌任何业务 owner，只保留跨上下文共享的最小端口与校验逻辑。
pub use crate::media::模型::*;

/// 应用层只编排业务动作，持久化细节通过端口下沉到适配层实现。
///
/// 维护者说明：
/// - 这个 trait 是“应用层对持久化的最小依赖面”。
/// - 新增仓储方法前，先确认是否真属于应用层编排所需能力。
/// - 不要在端口里泄漏 SQL/HTTP/socket 类型。
pub trait 仓储端口 {
    /// 设备级匿名身份引导。
    /// 约束：同一设备入口凭证必须恢复同一个匿名内部身份与当前稳定会话锚点。
    fn 引导匿名身份(
        &mut self,
        设备匿名凭证: &str,
    ) -> Result<contract::匿名身份引导结果, contract::错误码>;

    /// 按短码进房或建房并返回房间快照。
    /// 约束：短码合法性由领域层先校验，这里只执行持久化事实写入。
    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<contract::快照, contract::错误码>;

    /// 查询“会话是否存在”这一基础事实。
    /// 约束：这里只回答会话有效性，不扩展成连接态或页面态判断。
    fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码>;

    /// 查询会话当前对应的匿名内部身份。
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码>;

    /// 查询“房间是否存在”这一基础事实。
    /// 约束：这里只回答房间存在性，不把它扩展成成员资格或展示语义。
    fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码>;

    /// 查询房间当前最新事件位置。
    /// 约束：这里只回答权威顺序锚点，不扩展成展示或恢复语义。
    fn 查询房间最新事件位置(
        &self,
        房间标识: &str,
    ) -> Result<Option<i64>, contract::错误码>;

    /// 查询“会话是否为当前房间成员”这一只读事实。
    /// 约束：不要在仓储层把这个事实扩展成复杂权限决策。
    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码>;

    /// 拉取房间基线快照。
    /// 约束：返回“当前权威锚点”，用于首屏基线和补洞兜底。
    fn 拉取房间快照(
        &self,
        房间标识: &str,
        上次已读事件位置: Option<i64>,
        首条未读事件位置: Option<i64>,
    ) -> Result<contract::快照, contract::错误码>;

    /// 查询当前身份在房间里的阅读锚点。
    /// 约束：没有锚点时返回 `None`，不偷偷发明默认已读位置。
    fn 查询房间阅读位置(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<Option<i64>, contract::错误码>;

    /// 拉取房间增量事件。
    /// 约束：只回答“从某个权威位置之后有哪些事件”，不内嵌成员裁决。
    fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码>;

    /// 拉取更早历史页。
    /// 约束：这里只回答“某个顺序锚点之前的一页消息”，不内嵌成员裁决。
    fn 拉取房间历史页(
        &self,
        房间标识: &str,
        截止位置之前: i64,
        限制条数: i64,
    ) -> Result<contract::快照, contract::错误码>;

    /// 统一消息主链的提交入口：
    /// 同步入口下的纯文本消息与附件消息都必须走这条单一路径提交。
    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码>;

    /// 查询上传链已经形成的附件事实。
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<附件读取结果>, contract::错误码>;

    /// 推进当前身份在某个房间里的阅读锚点。
    /// 约束：最终必须按匿名内部身份落库，且只能单调前进。
    fn 推进房间阅读位置(
        &mut self,
        房间标识: &str,
        会话标识: &str,
        已读到事件位置: i64,
    ) -> Result<(), contract::错误码>;
}

/// realtime 热路径专用异步仓储口。
///
/// 迁移约束：
/// 1. 这里只收口“连接认证 / 增量订阅 / 创建消息”三条最热链路；
/// 2. 冷路径继续沿用同步 `仓储端口`，避免一次把整仓储面扫穿；
/// 3. 等热路径迁完并验证后，再继续收口旧的 blocking 桥接。
#[allow(async_fn_in_trait)]
pub trait Realtime仓储端口 {
    async fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码>;

    async fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码>;

    async fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码>;

    async fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码>;

    async fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码>;

    async fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<附件读取结果>, contract::错误码>;

    async fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码>;
}

/// realtime 连接会话校验：
/// 只确认“连接携带的会话是否存在”，不在这里混入成员资格或房间权限。
pub fn 校验实时连接会话(
    仓储: &dyn 仓储端口,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let exists = 仓储.检查会话存在(会话标识)?;
    if exists {
        Ok(())
    } else {
        Err(contract::错误码::会话无效)
    }
}

/// realtime / 冷路径共用的订阅资格校验。
/// 约束：房间成员真相只由应用层查询并裁决，handler 不得私自判断。
pub fn 校验房间订阅资格(
    仓储: &dyn 仓储端口,
    房间标识: &str,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let is_member = 仓储.检查成员资格(房间标识, 会话标识)?;
    domain::member::校验成员可发言(is_member).map_err(映射领域错误)
}

pub(crate) async fn 校验房间订阅资格_异步<R: Realtime仓储端口 + ?Sized>(
    仓储: &R,
    房间标识: &str,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    // async 热路径和同步冷路径必须共用同一条成员资格真相；
    // 这样 socket handler 才不会为了“方便”再长一层私有权限判断。
    let is_member = 仓储.检查成员资格(房间标识, 会话标识).await?;
    domain::member::校验成员可发言(is_member).map_err(映射领域错误)
}

/// 房间存在性校验只负责把“有没有这个房间”说清楚。
/// 这样后续成员资格失败就不会把 `room_not_found` 吞成 `membership_required`。
pub(crate) fn 校验房间存在(
    仓储: &dyn 仓储端口, 房间标识: &str
) -> Result<(), contract::错误码> {
    if 仓储.检查房间存在(房间标识)? {
        Ok(())
    } else {
        Err(contract::错误码::房间不存在)
    }
}

pub(crate) async fn 校验房间存在_异步<R: Realtime仓储端口 + ?Sized>(
    仓储: &R,
    房间标识: &str,
) -> Result<(), contract::错误码> {
    if 仓储.检查房间存在(房间标识).await? {
        Ok(())
    } else {
        Err(contract::错误码::房间不存在)
    }
}

/// 领域错误 -> 契约错误码映射。
/// 约束：这里只做语义映射，不改动错误事实本身。
pub(crate) fn 映射领域错误(err: domain::领域错误) -> contract::错误码 {
    match err {
        domain::领域错误::成员资格不足 => contract::错误码::成员资格不足,
        domain::领域错误::消息文本为空
        | domain::领域错误::消息内容为空
        | domain::领域错误::房间短码非法 => contract::错误码::参数非法,
        domain::领域错误::附件类型不支持 => contract::错误码::附件类型不支持,
        domain::领域错误::附件数量超限 => contract::错误码::附件数量超限,
    }
}

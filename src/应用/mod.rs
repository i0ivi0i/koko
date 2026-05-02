use crate::{shared::contract, domain};

/// 跨业务仍共同消费的应用层入口。
///
/// 这里不是旧根用例的兼容入口：业务主链已经优先指向身份、房间、消息、
/// 媒体、实时和恢复 owner；这里暂存尚未继续下沉的端口与少量共享应用服务。
pub use crate::identity::application::引导匿名身份;
pub use crate::media::distribution::application::{
    列出待做种协作分发项, 写入协作分发swarm存活, 写入协作分发torrent元信息,
    写入协作分发元数据, 查询媒体定位, 读取附件内容,
};
pub use crate::media::upload::application::{
    准备媒体附件上传, 完成媒体附件上传, 读取待完成媒体附件,
};
pub use crate::message::application::{创建消息, 创建消息_异步};
pub use crate::realtime::application::{加载房间增量事件_异步, 校验实时连接会话_异步};
pub use crate::recovery::application::加载房间快照;
pub use crate::room::application::{
    加载房间历史页, 加载房间增量事件, 按短码进房或建房, 推进房间阅读位置,
};
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
    /// 当前新增默认实现，是为了先让统一消息用例落地，再分批把仓储适配补齐。
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        let _ = 会话标识;
        Ok(None)
    }

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
    /// 默认实现先返回空，便于用例和测试先收口边界，再逐步补适配。
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<附件读取结果>, contract::错误码> {
        let _ = 附件标识;
        Ok(None)
    }

    /// 把已校验好的媒体附件写入权威真相。
    fn 创建媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &媒体附件写入请求,
    ) -> Result<媒体附件快照, contract::错误码> {
        let _ = (所属匿名身份标识, 附件);
        Err(contract::错误码::系统错误)
    }

    /// 记录原始 File 字节的强哈希。它只服务精确去重，不拥有权限和消息成立真相。
    fn 记录附件source_hash(
        &mut self,
        附件标识: &str,
        source_hash: &str,
        source_byte_size: i64,
        source_file_name: Option<&str>,
    ) -> Result<(), contract::错误码> {
        let _ = (附件标识, source_hash, source_byte_size, source_file_name);
        Err(contract::错误码::系统错误)
    }

    /// source_hash 查询只回答“当前发送者是否已经有权复用这份资产”。
    /// 目标房间只用于发送上下文，不能被误当成媒体资产身份边界；SQL 仍必须拒绝全站存在性探测。
    fn 查询可复用source_hash媒体资产(
        &self,
        会话标识: &str,
        目标房间标识: &str,
        当前匿名身份标识: &str,
        source_hash: &str,
        source_byte_size: i64,
        种类: 媒体附件类型,
    ) -> Result<Option<可复用媒体资产>, contract::错误码> {
        let _ = (
            会话标识,
            目标房间标识,
            当前匿名身份标识,
            source_hash,
            source_byte_size,
            种类,
        );
        Ok(None)
    }

    /// 转发只从“当前会话可见的源附件”出发复用 canonical 资产。
    /// 这里禁止接受 source_hash，也禁止返回旧房间、旧消息或旧上传者，避免把转发误做成全站探测接口。
    fn 查询可转发媒体资产(
        &self,
        会话标识: &str,
        源附件标识: &str,
        种类: 媒体附件类型,
    ) -> Result<Option<可复用媒体资产>, contract::错误码> {
        let _ = (会话标识, 源附件标识, 种类);
        Ok(None)
    }

    /// canonical 资产写入以 `content_hash` 幂等收口；命中已有资产时不得续租 24 小时冷源窗口。
    fn 写入canonical媒体资产(
        &mut self,
        请求: &Canonical媒体资产写入请求,
    ) -> Result<(), contract::错误码> {
        let _ = 请求;
        Err(contract::错误码::系统错误)
    }

    /// 附件引用 canonical 资产只是资产复用，不改变附件 owner、消息、房间或权限事实。
    fn 绑定附件canonical媒体资产(
        &mut self,
        附件标识: &str,
        content_hash: &str,
    ) -> Result<(), contract::错误码> {
        let _ = (附件标识, content_hash);
        Err(contract::错误码::系统错误)
    }

    /// 协作分发元数据是 ready 后的补充真相面。
    /// 第一版只允许写入稳定片段，不让壳层自己拼 hash / swarm_id。
    fn 写入协作分发元数据(
        &mut self,
        请求: &协作分发元数据写入请求,
    ) -> Result<协作分发元数据快照, contract::错误码> {
        let _ = 请求;
        Err(contract::错误码::系统错误)
    }

    /// locator 需要把稳定分发片段一起带给壳层，但这里仍然只回答“有没有这份片段”。
    fn 查询协作分发元数据(
        &self,
        附件标识: &str,
    ) -> Result<Option<协作分发元数据快照>, contract::错误码> {
        let _ = 附件标识;
        Ok(None)
    }

    /// 列出当前仍应由后端强 seed 的附件集合。
    /// 这条查询只回答“现在谁该做种”，不直接触发 sidecar IO。
    fn 列出待做种协作分发项(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待做种协作分发项>, contract::错误码> {
        let _ = (当前时间戳秒, 限制条数);
        Ok(vec![])
    }

    /// swarm 运行态存活属于易变事实，必须按 swarm_id + session + kind 独立持久化。
    /// 这样才能避免把“页面在线”偷写成 attachment 的长期可用来源。
    fn 写入协作分发swarm存活(
        &mut self,
        请求: &协作分发swarm存活写入请求,
    ) -> Result<(), contract::错误码> {
        let _ = 请求;
        Err(contract::错误码::系统错误)
    }

    /// metainfo 字节读取单独收口，避免 locator 查询每次都拖大字段。
    fn 查询协作分发torrent元信息(
        &self,
        附件标识: &str,
    ) -> Result<Option<协作分发torrent元信息快照>, contract::错误码> {
        let _ = 附件标识;
        Ok(None)
    }

    /// ready 后生成出来的 metainfo 仍由应用层统一写入，不让 handler 越层直插 SQL。
    fn 写入协作分发torrent元信息(
        &mut self,
        请求: &协作分发torrent元信息写入请求,
    ) -> Result<协作分发torrent元信息快照, contract::错误码> {
        let _ = 请求;
        Err(contract::错误码::系统错误)
    }

    /// 流媒体清单是视频主链切换后的稳定主入口。
    /// 这里的真相只回答“manifest 存在哪里”，不回答具体端侧该优先消费 HLS 还是 DASH。
    fn 写入流媒体清单元数据(
        &mut self,
        请求: &流媒体清单写入请求,
    ) -> Result<流媒体清单快照, contract::错误码> {
        let _ = 请求;
        Err(contract::错误码::系统错误)
    }

    fn 查询流媒体清单元数据(
        &self,
        附件标识: &str,
    ) -> Result<Option<流媒体清单快照>, contract::错误码> {
        let _ = 附件标识;
        Ok(None)
    }

    /// 列出已经超过标准流媒体冷备窗口、且还没留下删除时间的 manifest 真相。
    /// 注意：这里只回答“服务端清单该删了”，不碰 swarm/distribution 线索。
    fn 列出待清理流媒体清单(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理流媒体清单>, contract::错误码> {
        let _ = (当前时间戳秒, 限制条数);
        Ok(vec![])
    }

    /// manifest/segment 真删完后，必须把 streaming_deleted_at 回写真相。
    /// 这样 locator 与内容读取才能共享同一条“标准流媒体已退场”的事实。
    fn 标记流媒体清单已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        let _ = (附件标识, 删除时间戳秒);
        Err(contract::错误码::系统错误)
    }

    /// 创建 prepared 附件占位，供浏览器后续直传对象内容。
    fn 创建预备媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &媒体附件准备请求,
    ) -> Result<媒体附件准备快照, contract::错误码> {
        let _ = (所属匿名身份标识, 附件);
        Err(contract::错误码::系统错误)
    }

    /// prepare 第二阶段失败时，需要把还没绑定上传会话的 prepared 占位回滚掉。
    /// 约束：这里只回收“孤儿 prepared 附件”，不承载正常业务删除语义。
    fn 回滚预备媒体附件记录(
        &mut self,
        附件标识: &str,
    ) -> Result<(), contract::错误码> {
        let _ = 附件标识;
        Err(contract::错误码::系统错误)
    }

    /// 读取“当前还能否继续上传/完成上传”的最小附件事实。
    fn 查询待完成媒体附件(
        &self,
        附件标识: &str,
    ) -> Result<Option<待完成媒体附件读取结果>, contract::错误码> {
        let _ = 附件标识;
        Ok(None)
    }

    /// 查询当前会话是否有权读取某个附件内容变体。
    fn 查询附件可读内容(
        &self,
        附件标识: &str,
        会话标识: &str,
        变体: 附件内容变体,
    ) -> Result<Option<附件内容读取结果>, contract::错误码> {
        let _ = (附件标识, 会话标识, 变体);
        Ok(None)
    }

    /// 列出已经超过冷源保留窗口、且尚未留下删除时间的附件原始对象。
    fn 列出待清理媒体冷源(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理媒体冷源>, contract::错误码> {
        let _ = (当前时间戳秒, 限制条数);
        Ok(vec![])
    }

    /// 原始对象删掉后，要把 `origin_deleted_at` 写回附件真相，避免 locator 和内容读取继续各判各的。
    fn 标记媒体冷源已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        let _ = (附件标识, 删除时间戳秒);
        Err(contract::错误码::系统错误)
    }

    fn 列出待清理canonical媒体资产(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理Canonical媒体资产>, contract::错误码> {
        let _ = (当前时间戳秒, 限制条数);
        Ok(vec![])
    }

    fn 标记canonical媒体资产已删除(
        &mut self,
        content_hash: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        let _ = (content_hash, 删除时间戳秒);
        Err(contract::错误码::系统错误)
    }

    /// 视频 mezzanine 24h TTL 到期后，需要由后台统一回收。
    fn 列出待清理媒体回退母本(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理媒体回退母本>, contract::错误码> {
        let _ = (当前时间戳秒, 限制条数);
        Ok(vec![])
    }

    fn 标记媒体回退母本已删除(
        &mut self,
        附件标识: &str,
        删除时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        let _ = (附件标识, 删除时间戳秒);
        Err(contract::错误码::系统错误)
    }

    /// 上传残留清理只回答“有哪些文件现在已经可以删了”。
    /// 约束：这里不决定 shell 应该如何删文件，也不绕过应用层直接改 ready/room/message 真相。
    fn 列出待清理上传残留(
        &self,
        当前时间戳秒: i64,
        限制条数: i64,
    ) -> Result<Vec<待清理上传残留>, contract::错误码> {
        let _ = (当前时间戳秒, 限制条数);
        Ok(vec![])
    }

    /// shell 删除残留文件之后，要把“这批 locator 已经不再可用”写回权威库。
    /// 约束：这里只写清理结果，不发明第二条上传完成语义。
    fn 标记上传残留已清理(
        &mut self,
        上传会话标识: &str,
        清理原因: 上传残留清理原因,
        清理时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        let _ = (上传会话标识, 清理原因, 清理时间戳秒);
        Err(contract::错误码::系统错误)
    }

    /// restart 语义下，旧附件和旧 transport 都必须先显式退场。
    /// 这里只有“留事实”这一层；删临时文件仍由 shell 根据 storage_locator 执行。
    fn 标记媒体上传已放弃(
        &mut self,
        附件标识: &str,
        放弃时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        let _ = (附件标识, 放弃时间戳秒);
        Err(contract::错误码::系统错误)
    }

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
    ) -> Result<Option<String>, contract::错误码> {
        let _ = 会话标识;
        Ok(None)
    }

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
    ) -> Result<Option<附件读取结果>, contract::错误码> {
        let _ = 附件标识;
        Ok(None)
    }

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

/// 发送文本消息主链：
/// 1. 参数合法性（客户端消息 ID 不能为空）
/// 2. 成员资格校验
/// 3. 文本不变量校验
/// 4. 交给仓储在权威存储内提交事件
pub fn 发送文本消息(
    仓储: &mut dyn 仓储端口,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
) -> Result<contract::领域事件, contract::错误码> {
    创建消息(仓储, 房间标识, 会话标识, 客户端消息标识, 文本, &[])
}

struct SourceHash附件记录<'a> {
    source_hash: &'a str,
    source_byte_size: i64,
    source_file_name: Option<&'a str>,
}

/// 从已有 canonical 资产派生当前业务附件引用。
///
/// 这条内部主链同时服务 source_hash 秒传和转发：
/// - 只新增当前发送者拥有的 ready 附件事实；
/// - 只绑定同一份 canonical 物理资产；
/// - 只复用同一份 swarm/torrent 线索；
/// - 绝不复制旧消息、旧房间或旧上传者事实。
fn 用可复用资产创建ready附件引用(
    仓储: &mut dyn 仓储端口,
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

pub fn 复用source_hash媒体附件(
    仓储: &mut dyn 仓储端口,
    请求: &SourceHash媒体复用请求,
) -> Result<SourceHash媒体复用结果, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || !是64位小写hex(请求.source_hash.as_str())
        || 请求.source_byte_size <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    校验房间订阅资格(仓储, &请求.房间标识, &请求.会话标识)?;
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

    Ok(SourceHash媒体复用结果::Reused {
        附件: snapshot,
        协作分发: distribution,
        torrent,
    })
}

pub fn 转发媒体附件到房间(
    仓储: &mut dyn 仓储端口,
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
    校验房间订阅资格(仓储, &请求.目标房间标识, &请求.会话标识)?;
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

    // 转发必须复用统一消息主链，让 owner、附件状态、房间成员资格和事件顺序继续由同一处裁决。
    let message_event = 创建消息(
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

pub fn 写入协作分发存活(
    仓储: &mut dyn 仓储端口,
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
    let locator = 查询媒体定位(仓储, &请求.附件标识, &请求.会话标识)?;
    let distribution = locator.协作分发.ok_or(contract::错误码::附件未就绪)?;
    写入协作分发swarm存活(
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

pub fn 写入流媒体清单元数据(
    仓储: &mut dyn 仓储端口,
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

pub fn 读取协作分发torrent元信息(
    仓储: &dyn 仓储端口,
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
    仓储: &dyn 仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<待清理媒体冷源>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待清理媒体冷源(当前时间戳秒, 限制条数)
}

/// 原始对象一旦删掉，就必须把删除时间回写到附件真相。
/// 这样 locator、legacy original 路由和分发 runtime 才能共享同一条冷源退场事实。
pub fn 标记媒体冷源已删除(
    仓储: &mut dyn 仓储端口,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if 附件标识.trim().is_empty() || 删除时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.标记媒体冷源已删除(附件标识, 删除时间戳秒)
}

pub fn 列出待清理canonical媒体资产(
    仓储: &dyn 仓储端口,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<待清理Canonical媒体资产>, contract::错误码> {
    if 当前时间戳秒 < 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    仓储.列出待清理canonical媒体资产(当前时间戳秒, 限制条数)
}

pub fn 标记canonical媒体资产已删除(
    仓储: &mut dyn 仓储端口,
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
    仓储: &dyn 仓储端口,
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
    仓储: &dyn 仓储端口,
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
    仓储: &mut dyn 仓储端口,
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
    仓储: &dyn 仓储端口,
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
    仓储: &mut dyn 仓储端口,
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
    仓储: &mut dyn 仓储端口,
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
    仓储: &mut dyn 仓储端口,
    会话标识: &str,
    附件标识: &str,
    放弃时间戳秒: i64,
) -> Result<(), contract::错误码> {
    if 附件标识.trim().is_empty() || 放弃时间戳秒 < 0 {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
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

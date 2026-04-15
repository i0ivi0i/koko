use crate::{contract, domain};

/// 用例层读取到的附件种类快照。
/// 这是应用层对仓储的最小依赖面，不把数据库字段名直接泄漏进领域。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 附件种类读取结果 {
    图片,
    视频,
    语音,
    GIF,
    文件,
}

/// 用例层读取到的附件状态快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 附件状态读取结果 {
    已准备,
    上传中,
    处理中,
    就绪,
    失败,
    已过期,
}

/// 上传链已经形成的最小附件事实。
/// 这里继续保持“应用层稳定字段”，但允许把图片真实资产和冷源生命周期
/// 这种已经进入业务协议面的事实一起带出，避免它们只留在 adapter 私货里。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 附件读取结果 {
    pub 附件标识: String,
    /// 这里只允许承载内部身份真相：优先 `identity_uuid`，不再把兼容旧串往应用层带。
    pub 所属匿名身份标识: String,
    pub 种类: 附件种类读取结果,
    pub mime_type: String,
    pub 状态: 附件状态读取结果,
    pub 宽: Option<i32>,
    pub 高: Option<i32>,
    /// 这里只表达“当前附件是否已经拥有稳定静态封面真相”，
    /// 不把具体 URL 或存储键倒灌进应用层。
    pub 允许缩略图: bool,
    pub 资产原图存储键: Option<String>,
    pub 完整图存储键: Option<String>,
    pub 原始冷源到期时间戳秒: Option<i64>,
    pub 原始冷源删除时间戳秒: Option<i64>,
}

/// 媒体上传主链当前只点亮图片和视频两种附件。
/// 其它附件种类以后若要接入，也必须复用同一条 prepared -> ready 主链。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 媒体附件类型 {
    图片,
    视频,
}

/// 上传链完成 prepare 后，进入应用层持久化所需的最小字段。
/// 存储键属于 adapter 细节，但仍需通过应用层编排把 owner 真相和持久化动作收口。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体附件准备请求 {
    pub 附件标识: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 原始内容存储键: String,
}

/// prepare 阶段只落“媒体占位真相”，不把 ready 元数据提前伪造出来。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体附件准备快照 {
    pub 附件标识: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 原始内容存储键: String,
    pub 状态: 附件状态读取结果,
}

/// complete 前要读到的最小附件事实。
/// 它只服务“继续上传/完成上传”的业务编排，不外泄到共享 contract。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待完成媒体附件读取结果 {
    pub 附件标识: String,
    /// prepare/complete owner 校验只认内部身份，不再认旧 `anonymous_identity_id` 文本串。
    pub 所属匿名身份标识: String,
    /// 当前 attachment 活着的上传会话锚点。
    /// 它不参与 UI 展示，但 complete / abandon / hook 必须围绕它收口。
    pub 当前上传会话标识: Option<String>,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 原始内容存储键: String,
    pub 状态: 附件状态读取结果,
}

/// complete 阶段拿到真实字节后，进入应用层持久化所需的最小媒体字段。
/// 这里刻意把“图片原始冷源”和“视频 24h mezzanine 回退层”并列收口：
/// 1. 图片仍以原图冷源为唯一 fallback；
/// 2. 视频则改成高质量 mezzanine 作为短期回退层，避免 raw upload 被删后壳层继续猜测另一套 cold source。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体附件写入请求 {
    pub 附件标识: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 宽: i32,
    pub 高: i32,
    pub 原始内容存储键: String,
    pub 缩略图存储键: Option<String>,
    pub 资产原图存储键: Option<String>,
    pub 完整图存储键: Option<String>,
    pub 原始冷源到期时间戳秒: Option<i64>,
    pub 回退母本存储键: Option<String>,
    pub 回退母本到期时间戳秒: Option<i64>,
}

/// 媒体上传成功后返回给壳层的最小快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体附件快照 {
    pub 附件标识: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 宽: i32,
    pub 高: i32,
    /// ready 快照要把“有没有静态封面”一起带出去，
    /// 这样 complete / locator / 消息时间线都能共用同一份 preview 真相。
    pub 允许缩略图: bool,
    pub 状态: 附件状态读取结果,
}

/// 协作分发元数据是 ready 附件旁边的稳定分发表面：
/// 1. 业务锚点仍然是 attachment_id；
/// 2. 这里只记录 Phase 1 真正需要的稳定字段；
/// 3. tracker ticket、announce、peer 数等运行态以后单独扩展，不污染当前真相面。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发元数据写入请求 {
    pub 附件标识: String,
    pub content_id: String,
    pub content_hash: String,
    pub swarm_id: String,
    pub web_seed_until秒: i64,
}

/// torrent 元信息属于协作分发的可派生持久化物。
/// 它和附件真相分开存放，但仍以 attachment_id 为锚点，避免演化成第二条主链。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发torrent元信息写入请求 {
    pub 附件标识: String,
    pub torrent_bytes: Vec<u8>,
    pub torrent_info_hash: String,
    pub piece_length字节: i32,
}

/// cooperative 分发只上报“最近仍有 peer 存活”的事实。
/// 浏览器是否在线、有没有 peer 仍属于运行态，但最近活跃时间戳要交给后端统一落权威记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发存活写入请求 {
    pub 附件标识: String,
    pub 会话标识: String,
    pub 最近peer存活时间戳秒: i64,
}

/// 受控 torrent 出口读取需要完整 metainfo 字节。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发torrent元信息快照 {
    pub 附件标识: String,
    pub torrent_bytes: Vec<u8>,
    pub torrent_info_hash: String,
    pub piece_length字节: i32,
}

/// locator 带出的协作分发快照只暴露“稳定可缓存的分发片段”。
/// 这不是运行态，也不等于 tracker 准入凭证。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发元数据快照 {
    pub 附件标识: String,
    pub content_id: String,
    pub content_hash: String,
    pub swarm_id: String,
    pub web_seed_until秒: i64,
    pub 最近peer存活时间戳秒: Option<i64>,
    pub torrent_info_hash: Option<String>,
}

/// 流媒体清单元数据是真正把“视频主链已经切到标准 manifest”落成权威事实的持久化表面。
/// 这里只保存稳定清单存储键，不把段列表、播放器状态或本地缓存态混进仓储真相。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 流媒体清单写入请求 {
    pub 附件标识: String,
    pub hls主清单存储键: String,
    pub dash主清单存储键: String,
}

/// locator/complete 只需要知道“这条视频有没有正式清单入口”。
/// 段文件继续通过稳定前缀派生，不把大量文件明细塞回数据库。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 流媒体清单快照 {
    pub 附件标识: String,
    pub hls主清单存储键: String,
    pub dash主清单存储键: String,
}

/// locator 只回答“当前怎么受控取媒体”，不暴露存储键、权限投影或 swarm 运行态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体定位结果 {
    pub 附件标识: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 状态: 附件状态读取结果,
    pub 宽: Option<i32>,
    pub 高: Option<i32>,
    pub 允许缩略图: bool,
    pub 原始冷源到期时间戳秒: Option<i64>,
    pub 原始冷源删除时间戳秒: Option<i64>,
    pub 协作分发: Option<协作分发元数据快照>,
    pub 流媒体清单: Option<流媒体清单快照>,
}

/// 后台清理循环只需要知道“哪条附件的原始冷源该删了”。
/// 这里故意不把图片 full/original 资产键混进来，避免清理任务越权碰长期资产主链。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待清理媒体冷源 {
    pub 附件标识: String,
    pub 原始内容存储键: String,
}

/// 视频 mezzanine 是短期回退层，不是长期主资产。
/// 因此后台清理需要有一条独立待删清单，避免跟图片原图冷源混成一个 owner。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待清理媒体回退母本 {
    pub 附件标识: String,
    pub 回退母本存储键: String,
}

/// 原始冷源只保留 24 小时窗口。
/// 这里先把窗口值收成应用层常量，避免后续在外壳、handler、测试里继续散落“86400”。
pub const 媒体原始冷源保留秒数: i64 = 24 * 60 * 60;

/// 冷源可用性只看三件事：
/// 1. 还有没有冷源地址；
/// 2. 是否已经超过 TTL；
/// 3. 是否已经被后台物理删除并留下权威删除时间。
fn 冷源生命周期当前可用(
    到期时间戳秒: Option<i64>,
    删除时间戳秒: Option<i64>,
    当前时间戳秒: i64,
) -> bool {
    if 删除时间戳秒.is_some() {
        return false;
    }
    match 到期时间戳秒 {
        Some(到期时间戳秒) => 当前时间戳秒 <= 到期时间戳秒,
        None => false,
    }
}

pub fn 冷源当前可用(
    原始地址: Option<&str>,
    到期时间戳秒: Option<i64>,
    删除时间戳秒: Option<i64>,
    当前时间戳秒: i64,
) -> bool {
    let Some(原始地址) = 原始地址 else {
        return false;
    };
    if 原始地址.trim().is_empty() {
        return false;
    }
    冷源生命周期当前可用(到期时间戳秒, 删除时间戳秒, 当前时间戳秒)
}

/// 构造共享 contract 里的冷源描述。
/// 这个函数当前只回答“冷源现在还能不能用”，不夹带页面流程、fallback 顺序或播放器策略。
pub fn 构造媒体冷源描述(
    原始地址: Option<String>,
    到期时间戳秒: Option<i64>,
    删除时间戳秒: Option<i64>,
    当前时间戳秒: i64,
) -> contract::媒体冷源描述 {
    let 到期时间戳秒 = 到期时间戳秒.unwrap_or(当前时间戳秒);
    contract::媒体冷源描述 {
        是否可用: 冷源当前可用(
            原始地址.as_deref(),
            Some(到期时间戳秒),
            删除时间戳秒,
            当前时间戳秒,
        ),
        原始地址,
        到期时间戳秒,
        角色: contract::媒体冷源角色::冷备引导,
    }
}

/// 附件内容读取变体。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum 附件内容变体 {
    原图,
    缩略图,
    完整图,
    资产原图,
}

/// 受控内容读取只把必要结果返回给 shell，不把房间成员真相泄漏到壳层。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 附件内容读取结果 {
    pub mime_type: String,
    pub 存储键: String,
}

/// 用例层只编排业务动作，持久化细节通过端口下沉到适配层实现。
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

    /// 以事务方式提交“消息已创建”领域事件。
    /// 约束：客户端消息标识用于幂等链路追踪，不可被仓储静默丢弃。
    fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码>;

    /// 统一消息主链的提交入口。
    /// 默认实现先兼容纯文本路径；真正的附件事件提交会在后续任务里由适配层接管。
    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        if !附件.is_empty() {
            return Err(contract::错误码::系统错误);
        }
        self.创建消息事件(房间标识, 客户端消息标识, 会话标识, 文本)
    }

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

    /// cooperative 客户端活跃时只刷新最近一次 peer 存活时间。
    fn 写入协作分发最近peer存活时间(
        &mut self,
        附件标识: &str,
        最近peer存活时间戳秒: i64,
    ) -> Result<(), contract::错误码> {
        let _ = (附件标识, 最近peer存活时间戳秒);
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

    /// 创建 prepared 附件占位，供浏览器后续直传对象内容。
    fn 创建预备媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &媒体附件准备请求,
    ) -> Result<媒体附件准备快照, contract::错误码> {
        let _ = (所属匿名身份标识, 附件);
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

    async fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码>;

    async fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        if !附件.is_empty() {
            return Err(contract::错误码::系统错误);
        }
        self.创建消息事件(房间标识, 客户端消息标识, 会话标识, 文本)
            .await
    }
}

/// 设备级匿名身份引导用例：
/// 1. 只接受壳层持久化的入口凭证
/// 2. 恢复或创建匿名内部身份
/// 3. 返回当前稳定花名与会话锚点
pub fn 引导匿名身份(
    仓储: &mut dyn 仓储端口,
    设备匿名凭证: &str,
) -> Result<contract::匿名身份引导结果, contract::错误码> {
    if 设备匿名凭证.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    仓储.引导匿名身份(设备匿名凭证)
}

/// 进房/建房主链：
/// 1. 先在领域层校验短码语义
/// 2. 再进入仓储完成事实写入
pub fn 按短码进房或建房(
    仓储: &mut dyn 仓储端口,
    会话标识: &str,
    房间短码: &str,
) -> Result<contract::快照, contract::错误码> {
    domain::room::校验房间短码(房间短码).map_err(映射领域错误)?;
    仓储.按短码进房或建房(会话标识, 房间短码)
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

/// realtime 连接会话校验的异步版：
/// 热路径直接 await 仓储查询，不再经过 blocking 线程池桥接。
pub async fn 校验实时连接会话_异步<R: Realtime仓储端口 + ?Sized>(
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

/// 加载房间快照用例：
/// 先验证成员资格，再返回基线快照，防止未入房会话越权读取房间事实。
pub fn 加载房间快照(
    仓储: &dyn 仓储端口,
    房间标识: &str,
    会话标识: &str,
) -> Result<contract::快照, contract::错误码> {
    校验实时连接会话(仓储, 会话标识)?;
    校验房间存在(仓储, 房间标识)?;
    // 先验证成员资格，再返回快照，避免未入房会话直接读取房间真相。
    校验房间订阅资格(仓储, 房间标识, 会话标识)?;
    let latest_event_position = 仓储
        .查询房间最新事件位置(房间标识)?
        .ok_or(contract::错误码::房间不存在)?;
    let last_read_event_position = 仓储.查询房间阅读位置(房间标识, 会话标识)?;
    // 第一条未读的裁决必须在应用层完成，不能让前端自己猜，也不能把语义散到 adapter。
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

/// 加载房间增量事件用例：
/// 1. 参数合法性校验
/// 2. 会话有效性校验
/// 3. 房间存在性校验
/// 4. 成员资格校验
/// 5. 返回该位置之后的权威增量
pub fn 加载房间增量事件(
    仓储: &dyn 仓储端口,
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

/// realtime 订阅首帧补洞的异步版。
pub async fn 加载房间增量事件_异步<R: Realtime仓储端口 + ?Sized>(
    仓储: &R,
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

/// 加载房间更早历史页用例：
/// 1. 参数合法性校验
/// 2. 会话有效性校验
/// 3. 房间存在性校验
/// 4. 成员资格校验
/// 5. 返回该顺序锚点之前的一页历史消息
pub fn 加载房间历史页(
    仓储: &dyn 仓储端口,
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
/// 1. 参数合法性校验
/// 2. 会话有效性校验
/// 3. 房间存在性校验
/// 4. 成员资格校验
/// 5. 不允许越过房间当前 latest_event_position
/// 6. 最终按身份级锚点单调写入
pub fn 推进房间阅读位置(
    仓储: &mut dyn 仓储端口,
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

async fn 校验房间订阅资格_异步<R: Realtime仓储端口 + ?Sized>(
    仓储: &R,
    房间标识: &str,
    会话标识: &str,
) -> Result<(), contract::错误码> {
    let is_member = 仓储.检查成员资格(房间标识, 会话标识).await?;
    domain::member::校验成员可发言(is_member).map_err(映射领域错误)
}

/// 房间存在性校验只负责把“有没有这个房间”说清楚。
/// 这样后续成员资格失败就不会把 `room_not_found` 吞成 `membership_required`。
fn 校验房间存在(
    仓储: &dyn 仓储端口, 房间标识: &str
) -> Result<(), contract::错误码> {
    if 仓储.检查房间存在(房间标识)? {
        Ok(())
    } else {
        Err(contract::错误码::房间不存在)
    }
}

async fn 校验房间存在_异步<R: Realtime仓储端口 + ?Sized>(
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

/// 统一消息创建主链：
/// 1. client_message_id 不能为空
/// 2. 发送者身份必须稳定可解析
/// 3. 每个附件都要先过 owner / status / kind 校验
/// 4. 最终由领域决定“文本 + 附件”这条消息能否成立
pub fn 创建消息(
    仓储: &mut dyn 仓储端口,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
    附件标识列表: &[String],
) -> Result<contract::领域事件, contract::错误码> {
    if 客户端消息标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    校验房间订阅资格(仓储, 房间标识, 会话标识)?;

    let mut attachments = Vec::with_capacity(附件标识列表.len());
    if !附件标识列表.is_empty() {
        // 只有真正引用附件时，才需要解析发送者身份并校验附件 owner。
        // 这样可以保持现有纯文本消息主链不被图片第一阶段的新约束误伤。
        let 发送者身份 = 仓储
            .查询会话所属匿名身份(会话标识)?
            .ok_or(contract::错误码::会话无效)?;
        for attachment_id in 附件标识列表 {
            let snapshot = 仓储
                .查询附件快照(attachment_id)?
                .ok_or(contract::错误码::附件不存在)?;
            // 附件 owner 比对只认内部身份真相，这样兼容旧串就不会再渗回消息主链。
            if snapshot.所属匿名身份标识 != 发送者身份 {
                return Err(contract::错误码::附件不属于当前发送者);
            }
            if snapshot.状态 != 附件状态读取结果::就绪 {
                return Err(contract::错误码::附件未就绪);
            }
            let attachment = match snapshot.种类 {
                附件种类读取结果::图片 => domain::message::待发送附件 {
                    附件标识: snapshot.附件标识,
                    种类: domain::message::附件种类::图片,
                    宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
                    高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
                    有预览图: snapshot.允许缩略图,
                },
                附件种类读取结果::视频 => domain::message::待发送附件 {
                    附件标识: snapshot.附件标识,
                    种类: domain::message::附件种类::视频,
                    宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
                    高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
                    有预览图: snapshot.允许缩略图,
                },
                附件种类读取结果::语音 => {
                    return Err(contract::错误码::附件类型不支持);
                }
                附件种类读取结果::GIF => {
                    return Err(contract::错误码::附件类型不支持);
                }
                附件种类读取结果::文件 => {
                    return Err(contract::错误码::附件类型不支持);
                }
            };
            attachments.push(attachment);
        }
    }

    let msg = domain::message::创建消息(true, 文本, &attachments).map_err(映射领域错误)?;
    仓储.创建统一消息事件(房间标识, 客户端消息标识, 会话标识, &msg.文本, &msg.附件)
}

/// realtime 创建消息的异步版。
pub async fn 创建消息_异步<R: Realtime仓储端口 + ?Sized>(
    仓储: &mut R,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
    附件标识列表: &[String],
) -> Result<contract::领域事件, contract::错误码> {
    if 客户端消息标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    校验房间订阅资格_异步(仓储, 房间标识, 会话标识).await?;

    let mut attachments = Vec::with_capacity(附件标识列表.len());
    if !附件标识列表.is_empty() {
        let 发送者身份 = 仓储
            .查询会话所属匿名身份(会话标识)
            .await?
            .ok_or(contract::错误码::会话无效)?;
        for attachment_id in 附件标识列表 {
            let snapshot = 仓储
                .查询附件快照(attachment_id)
                .await?
                .ok_or(contract::错误码::附件不存在)?;
            // realtime 入口和同步入口必须共用同一条内部身份 owner 规则，避免两条主链各判各的。
            if snapshot.所属匿名身份标识 != 发送者身份 {
                return Err(contract::错误码::附件不属于当前发送者);
            }
            if snapshot.状态 != 附件状态读取结果::就绪 {
                return Err(contract::错误码::附件未就绪);
            }
            let attachment = match snapshot.种类 {
                附件种类读取结果::图片 => domain::message::待发送附件 {
                    附件标识: snapshot.附件标识,
                    种类: domain::message::附件种类::图片,
                    宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
                    高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
                    有预览图: snapshot.允许缩略图,
                },
                附件种类读取结果::视频 => domain::message::待发送附件 {
                    附件标识: snapshot.附件标识,
                    种类: domain::message::附件种类::视频,
                    宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
                    高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
                    有预览图: snapshot.允许缩略图,
                },
                附件种类读取结果::语音 | 附件种类读取结果::GIF | 附件种类读取结果::文件 =>
                {
                    return Err(contract::错误码::附件类型不支持);
                }
            };
            attachments.push(attachment);
        }
    }

    let msg = domain::message::创建消息(true, 文本, &attachments).map_err(映射领域错误)?;
    仓储
        .创建统一消息事件(房间标识, 客户端消息标识, 会话标识, &msg.文本, &msg.附件)
        .await
}

/// 先在业务真相里申请一个媒体附件占位，再把字节上传交给运输层。
pub fn 准备媒体附件上传(
    仓储: &mut dyn 仓储端口,
    会话标识: &str,
    附件: &媒体附件准备请求,
) -> Result<媒体附件准备快照, contract::错误码> {
    if 附件.附件标识.trim().is_empty()
        || 附件.mime_type.trim().is_empty()
        || 附件.原始内容存储键.trim().is_empty()
        || 附件.字节大小 <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(会话标识)?
        .ok_or(contract::错误码::会话无效)?;
    仓储.创建预备媒体附件记录(&所属匿名身份标识, 附件)
}

/// complete 前必须先验证：
/// 1. 当前会话仍然有效；
/// 2. 附件仍归当前发送者所有；
/// 3. 附件现在确实还处于 prepared。
pub fn 读取待完成媒体附件(
    仓储: &dyn 仓储端口,
    会话标识: &str,
    附件标识: &str,
) -> Result<待完成媒体附件读取结果, contract::错误码> {
    if 附件标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
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
    if prepared.状态 != 附件状态读取结果::已准备 {
        return Err(contract::错误码::附件未就绪);
    }
    Ok(prepared)
}

/// 完成上传只负责把 prepared 升级成 ready。
/// 它不创建消息，也不改变消息发送主链。
pub fn 完成媒体附件上传(
    仓储: &mut dyn 仓储端口,
    会话标识: &str,
    附件: &媒体附件写入请求,
) -> Result<媒体附件快照, contract::错误码> {
    let prepared = 读取待完成媒体附件(仓储, 会话标识, &附件.附件标识)?;
    if prepared.种类 != 附件.种类 {
        return Err(contract::错误码::附件类型不支持);
    }
    仓储.创建媒体附件记录(&prepared.所属匿名身份标识, 附件)
}

/// Phase 1 先把“ready 后立刻补齐分发元数据”也收口在用例层语义里。
/// 这样 handler 只负责调度，不直接越层操纵仓储。
pub fn 写入协作分发元数据(
    仓储: &mut dyn 仓储端口,
    请求: &协作分发元数据写入请求,
) -> Result<协作分发元数据快照, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.content_id.trim().is_empty()
        || 请求.content_hash.trim().is_empty()
        || 请求.swarm_id.trim().is_empty()
    {
        return Err(contract::错误码::参数非法);
    }
    仓储.写入协作分发元数据(请求)
}

pub fn 写入协作分发存活(
    仓储: &mut dyn 仓储端口,
    请求: &协作分发存活写入请求,
) -> Result<(), contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.会话标识.trim().is_empty()
        || 请求.最近peer存活时间戳秒 <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    let locator = 查询媒体定位(仓储, &请求.附件标识, &请求.会话标识)?;
    if locator.协作分发.is_none() {
        return Err(contract::错误码::附件未就绪);
    }
    仓储.写入协作分发最近peer存活时间(&请求.附件标识, 请求.最近peer存活时间戳秒)
}

pub fn 写入协作分发torrent元信息(
    仓储: &mut dyn 仓储端口,
    请求: &协作分发torrent元信息写入请求,
) -> Result<协作分发torrent元信息快照, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.torrent_info_hash.trim().is_empty()
        || 请求.torrent_bytes.is_empty()
        || 请求.piece_length字节 <= 0
    {
        return Err(contract::错误码::参数非法);
    }
    仓储.写入协作分发torrent元信息(请求)
}

pub fn 写入流媒体清单元数据(
    仓储: &mut dyn 仓储端口,
    请求: &流媒体清单写入请求,
) -> Result<流媒体清单快照, contract::错误码> {
    if 请求.附件标识.trim().is_empty()
        || 请求.hls主清单存储键.trim().is_empty()
        || 请求.dash主清单存储键.trim().is_empty()
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

/// 读取附件内容：
/// 1. 会话必须有效
/// 2. 附件必须存在且 ready
/// 3. 实际可见性仍按“当前会话是否能看到引用该附件的消息”裁决
pub fn 读取附件内容(
    仓储: &dyn 仓储端口,
    附件标识: &str,
    会话标识: &str,
    变体: 附件内容变体,
) -> Result<附件内容读取结果, contract::错误码> {
    if 附件标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
    let snapshot = 仓储
        .查询附件快照(附件标识)?
        .ok_or(contract::错误码::附件不存在)?;
    if snapshot.状态 != 附件状态读取结果::就绪 {
        return Err(contract::错误码::附件未就绪);
    }
    if matches!(变体, 附件内容变体::原图) {
        let 当前时间戳秒 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or_default();
        if !冷源生命周期当前可用(
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
    仓储: &dyn 仓储端口,
    附件标识: &str,
    会话标识: &str,
) -> Result<媒体定位结果, contract::错误码> {
    if 附件标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
    let snapshot = 仓储
        .查询附件快照(附件标识)?
        .ok_or(contract::错误码::附件不存在)?;
    if snapshot.状态 != 附件状态读取结果::就绪 {
        return Err(contract::错误码::附件未就绪);
    }
    仓储
        .查询附件可读内容(附件标识, 会话标识, 附件内容变体::原图)?
        .ok_or(contract::错误码::成员资格不足)?;
    let kind = match snapshot.种类 {
        附件种类读取结果::图片 => 媒体附件类型::图片,
        附件种类读取结果::视频 => 媒体附件类型::视频,
        _ => return Err(contract::错误码::附件类型不支持),
    };
    let distribution = 仓储.查询协作分发元数据(附件标识)?;
    let streaming_manifest = match kind {
        媒体附件类型::视频 => 仓储.查询流媒体清单元数据(附件标识)?,
        媒体附件类型::图片 => None,
    };
    Ok(媒体定位结果 {
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
fn 映射领域错误(err: domain::领域错误) -> contract::错误码 {
    match err {
        domain::领域错误::成员资格不足 => contract::错误码::成员资格不足,
        domain::领域错误::消息文本为空
        | domain::领域错误::消息内容为空
        | domain::领域错误::房间短码非法 => contract::错误码::参数非法,
        domain::领域错误::附件类型不支持 => contract::错误码::附件类型不支持,
        domain::领域错误::附件数量超限 => contract::错误码::附件数量超限,
    }
}

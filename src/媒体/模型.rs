use crate::shared::contract;

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
/// 这里继续保持“应用层稳定字段”，但允许把图片真实资产和受控冷备窗口
/// 这种已经进入业务协议面的事实一起带出，避免它们只留在 adapter 私货里。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 附件读取结果 {
    pub 附件标识: String,
    /// 这里只允许承载内部身份真相：优先 `identity_uuid`，不再把旧匿名短串往应用层带。
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
    /// app-facing 冷备窗口已经在仓储投影层收口：
    /// 1. 新主链附件优先认协作分发表里的 `web_seed_until`；
    /// 2. 没有分发表的历史附件才回退 `attachments.origin_expires_at`。
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
    /// 原始用户 File 字节的 SHA-256；只用于精确原文件去重，不参与 canonical 身份判断。
    pub source_hash: Option<String>,
    pub source_byte_size: Option<i64>,
    pub source_file_name: Option<String>,
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

/// canonical 媒体资产是内容身份层的稳定事实：
/// - `content_hash` 锚定正式共享字节；
/// - torrent / web_seed 元数据跟随内容资产复用；
/// - 业务附件仍然单独存在，不能把资产复用偷换成消息或附件复用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Canonical媒体资产写入请求 {
    pub content_hash: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 宽: i32,
    pub 高: i32,
    pub 存储键: String,
    pub torrent_bytes: Vec<u8>,
    pub torrent_info_hash: String,
    pub piece_length字节: i32,
    pub web_seed_until秒: i64,
    pub origin_expires_at秒: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 可复用媒体资产 {
    pub content_hash: String,
    pub 种类: 媒体附件类型,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 宽: i32,
    pub 高: i32,
    pub 存储键: String,
    pub torrent_bytes: Vec<u8>,
    pub torrent_info_hash: String,
    pub piece_length字节: i32,
    pub web_seed_until秒: i64,
    pub origin_expires_at秒: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceHash媒体复用请求 {
    pub 会话标识: String,
    pub 房间标识: String,
    pub 附件标识: String,
    pub 种类: 媒体附件类型,
    pub source_hash: String,
    pub source_byte_size: i64,
    pub source_file_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceHash媒体复用结果 {
    Miss,
    Reused(Box<SourceHash媒体复用命中>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceHash媒体复用命中 {
    pub 附件: 媒体附件快照,
    pub 协作分发: 协作分发元数据快照,
    pub torrent: 协作分发torrent元信息快照,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体附件转发请求 {
    pub 会话标识: String,
    pub 目标房间标识: String,
    pub 源附件标识: String,
    pub 新附件标识: String,
    pub 客户端消息标识: String,
    pub 文本: String,
    pub 种类: 媒体附件类型,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 媒体附件转发结果 {
    pub 消息事件: contract::领域事件,
    pub 附件: 媒体附件快照,
    pub 协作分发: 协作分发元数据快照,
    pub torrent: 协作分发torrent元信息快照,
}

/// 协作分发元数据是 ready 附件旁边的稳定分发表面：
/// 1. 业务锚点仍然是 attachment_id；
/// 2. 这里只记录 Phase 1 真正需要的稳定字段；
/// 3. tracker ticket、announce、peer 数等运行态以后单独扩展，不污染当前真相面。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发元数据写入请求 {
    pub 附件标识: String,
    /// content_id 是附件级业务内容引用；分发层去重不能把它当成 canonical 资产身份。
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
pub const 协作分发存活类型旁观意图: &str = "viewer_intent";
#[allow(non_upper_case_globals)]
pub const 协作分发存活类型片段peer: &str = "partial_peer";
#[allow(non_upper_case_globals)]
pub const 协作分发存活类型完整peer: &str = "complete_peer";
#[allow(non_upper_case_globals)]
pub const 协作分发存活类型后端强种子: &str = "backend_strong_seed";

#[allow(non_upper_case_globals)]
pub fn 是有效协作分发存活类型(value: &str) -> bool {
    matches!(
        value,
        协作分发存活类型旁观意图
            | 协作分发存活类型片段peer
            | 协作分发存活类型完整peer
            | 协作分发存活类型后端强种子
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发存活写入请求 {
    pub 附件标识: String,
    pub 会话标识: String,
    pub 存活类型: String,
    pub 最近peer存活时间戳秒: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 协作分发swarm存活写入请求 {
    pub swarm_id: String,
    pub 附件标识: String,
    pub 会话标识: String,
    pub 存活类型: String,
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
    /// 三路最近来源事实必须拆开保留：
    /// 1. partial_peer 只能抬到 connecting，不能冒充 ready；
    /// 2. complete/backend strong seed 才能抬起 available/ready；
    /// 3. locator 继续只暴露最小可缓存事实，不下发 UI 私货。
    pub 最近片段peer存活时间戳秒: Option<i64>,
    pub 最近完整peer存活时间戳秒: Option<i64>,
    pub 最近后端强种子存活时间戳秒: Option<i64>,
    pub torrent_info_hash: Option<String>,
}

/// 后台强 seed 对账只需要这组最小事实：
/// 1. 哪个附件还在 0-24h 服务器强 seed 窗口；
/// 2. owner 可用会话（用于构造受控 torrent/web_seed 入口）；
/// 3. 稳定 swarm 元数据（用于签票与 sidecar 启动命令）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待做种协作分发项 {
    pub 附件标识: String,
    pub 会话标识: String,
    pub content_id: String,
    pub content_hash: String,
    pub swarm_id: String,
    pub web_seed_until秒: i64,
    pub torrent_info_hash: String,
}

/// 流媒体清单元数据是真正把“视频主链已经切到标准 manifest”落成权威事实的持久化表面。
/// 这里只保存稳定清单存储键，不把段列表、播放器状态或本地缓存态混进仓储真相。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 流媒体清单写入请求 {
    pub 附件标识: String,
    pub hls主清单存储键: String,
    pub dash主清单存储键: String,
    /// writer 侧必须显式写入 24h 冷备窗口的截止时间，
    /// 避免把“清单什么时候退场”继续藏在 shell 默认值或测试约定里。
    pub streaming到期时间戳秒: i64,
    /// 新写入默认应为 `None`；只有后台真的删完 manifest/segment 后，才允许回写删除时间。
    pub streaming删除时间戳秒: Option<i64>,
}

/// locator/complete 只需要知道“这条视频有没有正式清单入口”。
/// 段文件继续通过稳定前缀派生，不把大量文件明细塞回数据库。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 流媒体清单快照 {
    pub 附件标识: String,
    pub hls主清单存储键: String,
    pub dash主清单存储键: String,
    /// 读侧允许为 `None`，是为了覆盖旧数据刚迁移但还没被 complete 重写的过渡窗口；
    /// 真正的新主链写入请求则必须始终给出明确 TTL。
    pub streaming到期时间戳秒: Option<i64>,
    pub streaming删除时间戳秒: Option<i64>,
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

/// canonical 资产级冷源清理按内容资产去重，避免多个附件共享同一对象时重复删除或互相误伤。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待清理Canonical媒体资产 {
    pub content_hash: String,
    pub 存储键: String,
}

/// 视频 mezzanine 是短期回退层，不是长期主资产。
/// 因此后台清理需要有一条独立待删清单，避免跟图片原图冷源混成一个 owner。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待清理媒体回退母本 {
    pub 附件标识: String,
    pub 回退母本存储键: String,
}

/// 流媒体清单只代表服务端 24h 标准流媒体冷备窗口。
/// 它的删除不能顺手影响 swarm metadata，否则就会把服务器冷备和平面长期存活混成一个 owner。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待清理流媒体清单 {
    pub 附件标识: String,
    pub hls主清单存储键: String,
    pub dash主清单存储键: String,
}

/// 上传残留清理原因只表达“为什么这批临时文件已经没有长期价值”。
/// 它不描述 shell 要怎么删文件，也不承载 UI 语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum 上传残留清理原因 {
    已放弃会话,
    最终合并后的分片残留,
    已过期未完成上传,
}

/// 后台残留清理一条只描述一个可删除的临时文件事实。
/// shell 层后续可以按 upload_session 分组执行删除，但用例层不提前替它发明文件系统策略。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待清理上传残留 {
    pub 附件标识: String,
    pub 上传会话标识: String,
    pub 临时文件定位: String,
    pub 清理原因: 上传残留清理原因,
}

/// 原始冷源只保留 24 小时窗口。
/// 这里先把窗口值收成应用层常量，避免后续在外壳、handler、测试里继续散落“86400”。
pub const 媒体原始冷源保留秒数: i64 = 24 * 60 * 60;
/// 标准流媒体产物同样只保留 24 小时冷备窗口。
/// 这条常量只回答“服务端清单什么时候该退场”，不等于 swarm 长期存活时间。
pub const 流媒体冷备保留秒数: i64 = 24 * 60 * 60;

pub(crate) fn 是64位小写hex(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

/// 冷源可用性只看三件事：
/// 1. 还有没有冷源地址；
/// 2. 是否已经超过 TTL；
/// 3. 是否已经被后台物理删除并留下权威删除时间。
pub(crate) fn 冷源生命周期当前可用(
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

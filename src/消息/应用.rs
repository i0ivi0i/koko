use crate::{
    application, domain,
    identity::application as 身份应用,
    media::模型::{附件状态读取结果, 附件种类读取结果, 附件读取结果},
    realtime::application as 实时应用,
    room::application as 房间应用,
    shared::contract,
};

/// 消息主链自己的同步仓储口。
/// 它只保留"成员资格校验 + 身份解析 + 附件快照读取 + 权威事件提交"这条最小依赖面。
pub trait 消息仓储端口:
    身份应用::会话身份读取端口 + 房间应用::会话房间校验仓储端口
{
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<附件读取结果>, contract::错误码>;

    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码>;
}

/// 热路径合并校验结果：一次 SQL 把会话存在、房间存在、成员资格、匿名身份全部取回。
/// 只在 realtime 异步创建消息时使用，同步冷路径不走这条链。
pub struct 消息发送资格校验结果 {
    pub session_exists: bool,
    pub room_exists: bool,
    pub is_member: bool,
    /// 当 session 存在时解析出的内部匿名身份标识（identity_uuid）。
    /// 纯文本消息可以不用它，但有附件时需要它来校验 owner。
    pub 匿名身份标识: Option<String>,
}

/// realtime 热路径专属消息仓储口。
/// 它补齐同步消息主链在 async 热链真正需要的额外能力：
/// - 合并校验（会话 + 房间 + 成员 + 身份，一次 roundtrip）
/// - 批量附件快照查询（N 条附件一次 roundtrip）
/// - 单条附件快照查询（向后兼容，已有调用方仍可使用）
/// - 消息事件提交
#[allow(async_fn_in_trait)]
pub trait Realtime消息仓储端口: 实时应用::实时会话房间校验仓储端口 {
    async fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码>;

    async fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<附件读取结果>, contract::错误码>;

    /// 一次 SQL 批量读取多条附件快照，消除逐条查询的 N 次 roundtrip。
    async fn 批量查询附件快照(
        &self,
        附件标识列表: &[String],
    ) -> Result<Vec<附件读取结果>, contract::错误码>;

    /// 一次 SQL 合并校验会话存在、房间存在、成员资格，并顺带取回匿名身份。
    /// 替代原先 `检查会话存在 + 检查房间存在 + 检查成员资格 + 查询会话所属匿名身份` 的 4 次 roundtrip。
    async fn 校验并读取消息发送资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<消息发送资格校验结果, contract::错误码>;

    async fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码>;
}

fn 校验客户端消息标识(客户端消息标识: &str) -> Result<(), contract::错误码> {
    if 客户端消息标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    Ok(())
}

/// 把媒体模型的 `附件状态读取结果` 映射成领域的 `附件槽位状态`。
/// 这是 application 边界的翻译点，领域不直接认识媒体模型。
fn 映射附件槽位状态(
    状态: &附件状态读取结果,
) -> Result<domain::message::附件槽位状态, contract::错误码> {
    match 状态 {
        附件状态读取结果::已准备 | 附件状态读取结果::上传中 => {
            Ok(domain::message::附件槽位状态::上传中)
        }
        附件状态读取结果::处理中 => Ok(domain::message::附件槽位状态::处理中),
        附件状态读取结果::就绪 => Ok(domain::message::附件槽位状态::已就绪),
        // 失败和已过期的附件不允许进入消息主链
        附件状态读取结果::失败 | 附件状态读取结果::已过期 => {
            Err(contract::错误码::附件未就绪)
        }
    }
}

/// 统一把"附件快照 -> 待发送附件"这条业务规则收口在一个 owner 里：
/// 1. owner 只认内部匿名身份，不认旧展示短串；
/// 2. pending-first：非失败/非过期状态即可进入消息主链，不再要求 ready；
/// 3. 当前切片只允许图片/视频成立消息。
fn 从附件快照构造待发送附件(
    发送者身份: &str,
    snapshot: 附件读取结果,
) -> Result<domain::message::待发送附件, contract::错误码> {
    // 这里是消息主链对附件 owner 的唯一业务裁决点。
    // 同步冷路径和 realtime 热路径都必须共用它，避免两套实现日后各改各的。
    if snapshot.所属匿名身份标识 != 发送者身份 {
        return Err(contract::错误码::附件不属于当前发送者);
    }
    let 状态 = 映射附件槽位状态(&snapshot.状态)?;
    // pending-first：宽高在 prepare 阶段可能已有值，
    // 没有宽高的附件无法渲染卡片，仍然拒绝
    Ok(match snapshot.种类 {
        附件种类读取结果::图片 => domain::message::待发送附件 {
            附件标识: snapshot.附件标识,
            种类: domain::message::附件种类::图片,
            宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
            高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
            有预览图: false,
            状态,
        },
        附件种类读取结果::视频 => domain::message::待发送附件 {
            附件标识: snapshot.附件标识,
            种类: domain::message::附件种类::视频,
            宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
            高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
            有预览图: snapshot.允许缩略图,
            状态,
        },
        附件种类读取结果::语音 | 附件种类读取结果::GIF | 附件种类读取结果::文件 =>
        {
            return Err(contract::错误码::附件类型不支持);
        }
    })
}

/// 同步/异步两条消息入口会先各自读出附件快照，再统一走这一层业务裁决。
/// 这样主链只保留一份附件成立规则，外层差异只剩 IO 读取方式。
fn 按统一消息规则校验附件快照列表(
    发送者身份: Option<&str>,
    附件快照列表: Vec<附件读取结果>,
) -> Result<Vec<domain::message::待发送附件>, contract::错误码> {
    let 发送者身份 = if 附件快照列表.is_empty() {
        ""
    } else {
        发送者身份.ok_or(contract::错误码::会话无效)?
    };
    let mut 待发送附件列表 = Vec::with_capacity(附件快照列表.len());
    for snapshot in 附件快照列表 {
        待发送附件列表.push(从附件快照构造待发送附件(发送者身份, snapshot)?);
    }
    Ok(待发送附件列表)
}

fn 读取待发送附件(
    仓储: &impl 消息仓储端口,
    会话标识: &str,
    附件标识列表: &[String],
) -> Result<Vec<domain::message::待发送附件>, contract::错误码> {
    let mut 附件快照列表 = Vec::with_capacity(附件标识列表.len());
    for attachment_id in 附件标识列表 {
        let snapshot = 仓储
            .查询附件快照(attachment_id)?
            .ok_or(contract::错误码::附件不存在)?;
        附件快照列表.push(snapshot);
    }
    // 只有真正引用附件时，才需要解析发送者身份并校验附件 owner。
    // 这样可以保持现有纯文本消息主链不被附件规则误伤。
    let 发送者身份 = if 附件快照列表.is_empty() {
        None
    } else {
        Some(
            仓储
                .查询会话所属匿名身份(会话标识)?
                .ok_or(contract::错误码::会话无效)?,
        )
    };
    按统一消息规则校验附件快照列表(发送者身份.as_deref(), 附件快照列表)
}

/// 发送文本消息主链：
/// 这里只是"纯文本消息"的语义别名，真正消息成立仍统一走 `创建消息`。
pub fn 发送文本消息(
    仓储: &mut impl 消息仓储端口,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
) -> Result<contract::领域事件, contract::错误码> {
    创建消息(仓储, 房间标识, 会话标识, 客户端消息标识, 文本, &[])
}

/// 统一消息创建主链：
/// 1. client_message_id 不能为空。
/// 2. 发送者身份必须稳定可解析。
/// 3. 每个附件都要先过 owner / status / kind 校验。
/// 4. 最终由领域决定"文本 + 附件"这条消息能否成立。
pub fn 创建消息(
    仓储: &mut impl 消息仓储端口,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
    附件标识列表: &[String],
) -> Result<contract::领域事件, contract::错误码> {
    校验客户端消息标识(客户端消息标识)?;
    房间应用::校验房间订阅资格(仓储, 房间标识, 会话标识)?;
    let attachments = 读取待发送附件(仓储, 会话标识, 附件标识列表)?;

    let msg =
        domain::message::创建消息(true, 文本, &attachments).map_err(application::映射领域错误)?;
    仓储.创建统一消息事件(房间标识, 客户端消息标识, 会话标识, &msg.文本, &msg.附件)
}

/// realtime 创建消息的异步版（热路径优化版）。
/// 与同步版 `创建消息` 共享同一套领域校验和附件裁决规则，区别只在 IO 方式：
/// - 会话 + 房间 + 成员资格 + 匿名身份合并为一次 SQL roundtrip
/// - N 条附件快照合并为一次 SQL roundtrip
///
/// 成功后返回权威领域事件，由 handler 决定如何广播成 `room_event`。
pub async fn 创建消息_异步(
    仓储: &mut impl Realtime消息仓储端口,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
    附件标识列表: &[String],
) -> Result<contract::领域事件, contract::错误码> {
    校验客户端消息标识(客户端消息标识)?;

    // ── 第 1 次 roundtrip：合并校验会话 + 房间 + 成员 + 身份（替代原先 4 次独立查询）──
    let 资格 = 仓储.校验并读取消息发送资格(房间标识, 会话标识).await?;
    if !资格.session_exists {
        return Err(contract::错误码::会话无效);
    }
    if !资格.room_exists {
        return Err(contract::错误码::房间不存在);
    }
    if !资格.is_member {
        return Err(contract::错误码::成员资格不足);
    }

    // ── 第 2 次 roundtrip（仅当有附件时）：批量读取附件快照（替代原先 N 次逐条查询）──
    let attachments = if 附件标识列表.is_empty() {
        Vec::new()
    } else {
        let 快照列表 = 仓储.批量查询附件快照(附件标识列表).await?;
        // 批量查询可能返回数量少于请求数（有附件不存在），必须检查。
        if 快照列表.len() != 附件标识列表.len() {
            return Err(contract::错误码::附件不存在);
        }
        按统一消息规则校验附件快照列表(资格.匿名身份标识.as_deref(), 快照列表)?
    };

    // ── 领域校验（纯内存，零 IO）──
    let msg =
        domain::message::创建消息(true, 文本, &attachments).map_err(application::映射领域错误)?;

    // ── 第 3 次 roundtrip：提交消息事件 ──
    仓储
        .创建统一消息事件(房间标识, 客户端消息标识, 会话标识, &msg.文本, &msg.附件)
        .await
}

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
    上传中,
    处理中,
    就绪,
    失败,
    已过期,
}

/// 上传链已经形成的最小附件事实。
/// 当前只保留创建消息真正需要的字段，不让 adapter 私货倒灌进 usecase。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 附件读取结果 {
    pub 附件标识: String,
    pub 所属匿名身份标识: String,
    pub 种类: 附件种类读取结果,
    pub 状态: 附件状态读取结果,
    pub 宽: Option<i32>,
    pub 高: Option<i32>,
}

/// 上传链完成图片解析后，进入应用层持久化所需的最小字段。
/// 存储键属于 adapter 细节，但仍需通过应用层编排把 owner 真相和持久化动作收口。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 图片附件写入请求 {
    pub 附件标识: String,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 宽: i32,
    pub 高: i32,
    pub 原图存储键: String,
    pub 缩略图存储键: Option<String>,
}

/// 图片上传成功后返回给壳层的最小快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 图片附件快照 {
    pub 附件标识: String,
    pub mime_type: String,
    pub 字节大小: i64,
    pub 宽: i32,
    pub 高: i32,
    pub 状态: 附件状态读取结果,
}

/// 附件内容读取变体。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum 附件内容变体 {
    原图,
    缩略图,
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

    /// 把已校验好的图片附件写入权威真相。
    fn 创建图片附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &图片附件写入请求,
    ) -> Result<图片附件快照, contract::错误码> {
        let _ = (所属匿名身份标识, 附件);
        Err(contract::错误码::系统错误)
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

    /// 推进当前身份在某个房间里的阅读锚点。
    /// 约束：最终必须按匿名内部身份落库，且只能单调前进。
    fn 推进房间阅读位置(
        &mut self,
        房间标识: &str,
        会话标识: &str,
        已读到事件位置: i64,
    ) -> Result<(), contract::错误码>;
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

/// 房间存在性校验只负责把“有没有这个房间”说清楚。
/// 这样后续成员资格失败就不会把 `room_not_found` 吞成 `membership_required`。
fn 校验房间存在(
    仓储: &dyn 仓储端口,
    房间标识: &str,
) -> Result<(), contract::错误码> {
    if 仓储.检查房间存在(房间标识)? {
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
                },
                附件种类读取结果::视频 => {
                    return Err(contract::错误码::附件类型不支持);
                }
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

/// 上传链完成后的图片附件登记：
/// 1. 会话必须有效
/// 2. owner 必须收口到稳定匿名内部身份
/// 3. 这里只创建附件，不创建消息
pub fn 登记图片附件(
    仓储: &mut dyn 仓储端口,
    会话标识: &str,
    附件: &图片附件写入请求,
) -> Result<图片附件快照, contract::错误码> {
    if 附件.附件标识.trim().is_empty()
        || 附件.mime_type.trim().is_empty()
        || 附件.原图存储键.trim().is_empty()
    {
        return Err(contract::错误码::参数非法);
    }
    校验实时连接会话(仓储, 会话标识)?;
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(会话标识)?
        .ok_or(contract::错误码::会话无效)?;
    仓储.创建图片附件记录(&所属匿名身份标识, 附件)
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
    仓储
        .查询附件可读内容(附件标识, 会话标识, 变体)?
        .ok_or(contract::错误码::成员资格不足)
}

/// 领域错误 -> 契约错误码映射。
/// 约束：这里只做语义映射，不改动错误事实本身。
fn 映射领域错误(err: domain::领域错误) -> contract::错误码 {
    match err {
        domain::领域错误::成员资格不足 => contract::错误码::成员资格不足,
        domain::领域错误::消息文本为空
        | domain::领域错误::消息内容为空
        | domain::领域错误::房间短码非法 => {
            contract::错误码::参数非法
        }
        domain::领域错误::附件类型不支持 => contract::错误码::附件类型不支持,
        domain::领域错误::附件数量超限 => contract::错误码::附件数量超限,
    }
}

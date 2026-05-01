use crate::{contract, domain, usecase};
use crate::usecase::{附件状态读取结果, 附件种类读取结果};

/// 发送文本消息主链：
/// 这里只是“纯文本消息”的语义别名，真正消息成立仍统一走 `创建消息`。
pub fn 发送文本消息(
    仓储: &mut dyn usecase::仓储端口,
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
/// 4. 最终由领域决定“文本 + 附件”这条消息能否成立。
pub fn 创建消息(
    仓储: &mut dyn usecase::仓储端口,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
    文本: &str,
    附件标识列表: &[String],
) -> Result<contract::领域事件, contract::错误码> {
    if 客户端消息标识.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    usecase::校验房间订阅资格(仓储, 房间标识, 会话标识)?;

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
                    有预览图: false,
                },
                附件种类读取结果::视频 => domain::message::待发送附件 {
                    附件标识: snapshot.附件标识,
                    种类: domain::message::附件种类::视频,
                    宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
                    高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
                    有预览图: snapshot.允许缩略图,
                },
                附件种类读取结果::语音
                | 附件种类读取结果::GIF
                | 附件种类读取结果::文件 => {
                    return Err(contract::错误码::附件类型不支持);
                }
            };
            attachments.push(attachment);
        }
    }

    let msg = domain::message::创建消息(true, 文本, &attachments).map_err(usecase::映射领域错误)?;
    仓储.创建统一消息事件(房间标识, 客户端消息标识, 会话标识, &msg.文本, &msg.附件)
}

/// realtime 创建消息的异步版。
/// 这里只负责把 command 落成同一条权威消息成立主链；
/// 成功后返回的仍然只能是领域事件，由 handler 决定如何广播成 `room_event`。
pub async fn 创建消息_异步<R: usecase::Realtime仓储端口 + ?Sized>(
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
    usecase::校验房间订阅资格_异步(仓储, 房间标识, 会话标识).await?;

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
                    有预览图: false,
                },
                附件种类读取结果::视频 => domain::message::待发送附件 {
                    附件标识: snapshot.附件标识,
                    种类: domain::message::附件种类::视频,
                    宽: snapshot.宽.ok_or(contract::错误码::附件未就绪)?,
                    高: snapshot.高.ok_or(contract::错误码::附件未就绪)?,
                    有预览图: snapshot.允许缩略图,
                },
                附件种类读取结果::语音
                | 附件种类读取结果::GIF
                | 附件种类读取结果::文件 => {
                    return Err(contract::错误码::附件类型不支持);
                }
            };
            attachments.push(attachment);
        }
    }

    let msg = domain::message::创建消息(true, 文本, &attachments).map_err(usecase::映射领域错误)?;
    仓储
        .创建统一消息事件(房间标识, 客户端消息标识, 会话标识, &msg.文本, &msg.附件)
        .await
}

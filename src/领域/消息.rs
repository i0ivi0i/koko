use super::{member::校验成员可发言, 领域错误};

/// 领域内的最小消息对象，只承载业务文本事实。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 文本消息 {
    /// 已通过领域校验的文本内容（去除首尾空白）。
    pub 文本: String,
}

/// 统一附件平台的领域种类枚举。
/// 第一阶段只允许图片真正进入消息主链，但这里提前留出未来附件平台的稳定语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum 附件种类 {
    图片,
    视频,
    语音,
    GIF,
    文件,
}

/// 用例层在进领域前，需要先把“当前准备挂进消息的附件”收口成纯业务输入。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待发送附件 {
    pub 附件标识: String,
    pub 种类: 附件种类,
    pub 宽: i32,
    pub 高: i32,
}

/// 领域校验通过后的附件引用。
/// 当前只保留消息主链真正需要的图片事实，不把存储私货带进来。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 已校验附件引用 {
    图片 {
        附件标识: String,
        宽: i32,
        高: i32,
    },
}

/// 统一消息模型：文本和附件同属一条消息事实。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 已校验消息 {
    pub 文本: String,
    pub 附件: Vec<已校验附件引用>,
}

const 单条消息最大附件数: usize = 9;

/// 发送文本消息的核心不变量：先校验成员，再校验文本。
///
/// 维护者说明：
/// - 这个函数返回 `文本消息` 代表“领域上可以成立”，不是“已落库”。
/// - 落库与事件位置推进由用例 + 适配层事务保证。
pub fn 创建文本消息(是否成员: bool, 文本: &str) -> Result<文本消息, 领域错误> {
    校验成员可发言(是否成员)?;
    if 文本.trim().is_empty() {
        return Err(领域错误::消息文本为空);
    }
    Ok(文本消息 {
        文本: 文本.trim().to_string(),
    })
}

/// 统一消息主链的核心不变量：
/// 1. 成员资格必须成立
/// 2. 文本和附件不能同时为空
/// 3. 第一阶段只允许图片附件
/// 4. 附件数量必须落在当前约束内
pub fn 创建消息(
    是否成员: bool,
    文本: &str,
    附件: &[待发送附件],
) -> Result<已校验消息, 领域错误> {
    校验成员可发言(是否成员)?;
    let trimmed_text = 文本.trim();
    if trimmed_text.is_empty() && 附件.is_empty() {
        return Err(领域错误::消息内容为空);
    }
    if 附件.len() > 单条消息最大附件数 {
        return Err(领域错误::附件数量超限);
    }

    let mut refs = Vec::with_capacity(附件.len());
    for attachment in 附件 {
        match attachment.种类 {
            附件种类::图片 => refs.push(已校验附件引用::图片 {
                附件标识: attachment.附件标识.clone(),
                宽: attachment.宽,
                高: attachment.高,
            }),
            附件种类::视频 | 附件种类::语音 | 附件种类::GIF | 附件种类::文件 => {
                return Err(领域错误::附件类型不支持);
            }
        }
    }

    Ok(已校验消息 {
        文本: trimmed_text.to_string(),
        附件: refs,
    })
}

use super::{member::校验成员可发言, 领域错误};

/// 领域内的最小消息对象，只承载业务文本事实。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 文本消息 {
    /// 已通过领域校验的文本内容（去除首尾空白）。
    pub 文本: String,
}

/// 统一附件平台的领域种类枚举。
/// 当前最小媒体切片先点亮图片和视频，其他种类继续保留稳定语义占位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum 附件种类 {
    图片,
    视频,
    语音,
    GIF,
    文件,
}

/// 领域自己的附件槽位状态，不依赖 contract。
/// application 负责把媒体模型的 `附件状态读取结果` 映射成这里的枚举，
/// 再由 adapter 投影成 `contract::附件槽位状态`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum 附件槽位状态 {
    待上传,
    上传中,
    处理中,
    已就绪,
    失败,
}

/// 用例层在进领域前，需要先把"当前准备挂进消息的附件"收口成纯业务输入。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 待发送附件 {
    pub 附件标识: String,
    pub 种类: 附件种类,
    pub 宽: i32,
    pub 高: i32,
    /// 领域只保存"这条附件有没有稳定预览图"这个渲染事实，
    /// 不碰 URL 和存储实现，让后续投影层按当前会话去生成受控地址。
    pub 有预览图: bool,
    /// pending-first：附件进入消息不要求 ready，领域只做结构校验。
    /// 状态真相由应用层从媒体模型映射而来，领域不判断上传进度。
    pub 状态: 附件槽位状态,
}

/// 领域校验通过后的附件引用。
/// 这里只保留消息主链真正需要的稳定渲染事实，不把存储私货带进来。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 已校验附件引用 {
    图片 {
        附件标识: String,
        宽: i32,
        高: i32,
        有预览图: bool,
        状态: 附件槽位状态,
    },
    视频 {
        附件标识: String,
        宽: i32,
        高: i32,
        有预览图: bool,
        状态: 附件槽位状态,
    },
}

/// 统一消息模型：文本和附件同属一条消息事实。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 已校验消息 {
    pub 文本: String,
    pub 附件: Vec<已校验附件引用>,
}

const 单条消息最大附件数: usize = 9;
/// 单条消息文本上限：按 Unicode 字符计数，不是字节数。
/// 中文、emoji、英文字母各算 1 个字符。
const 单条消息文本最大字符数: usize = 2000;

/// 发送文本消息的核心不变量：先校验成员，再校验文本。
///
/// 维护者说明：
/// - 这个函数返回 `文本消息` 代表"领域上可以成立"，不是"已落库"。
/// - 落库与事件位置推进由用例 + 适配层事务保证。
pub fn 创建文本消息(是否成员: bool, 文本: &str) -> Result<文本消息, 领域错误> {
    校验成员可发言(是否成员)?;
    let trimmed = 文本.trim();
    if trimmed.is_empty() {
        return Err(领域错误::消息文本为空);
    }
    if trimmed.chars().count() > 单条消息文本最大字符数 {
        return Err(领域错误::消息文本过长);
    }
    Ok(文本消息 {
        文本: trimmed.to_string(),
    })
}

/// 统一消息主链的核心不变量：
/// 1. 成员资格必须成立
/// 2. 文本和附件不能同时为空
/// 3. 当前切片允许图片和视频附件进入消息，其余类型仍拒绝
/// 4. 附件数量必须落在当前约束内
/// 5. pending-first：附件状态不在领域校验范围内，领域只校验结构
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
    if trimmed_text.chars().count() > 单条消息文本最大字符数 {
        return Err(领域错误::消息文本过长);
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
                有预览图: attachment.有预览图,
                状态: attachment.状态,
            }),
            附件种类::视频 => refs.push(已校验附件引用::视频 {
                附件标识: attachment.附件标识.clone(),
                宽: attachment.宽,
                高: attachment.高,
                有预览图: attachment.有预览图,
                状态: attachment.状态,
            }),
            附件种类::语音 | 附件种类::GIF | 附件种类::文件 => {
                return Err(领域错误::附件类型不支持)
            }
        }
    }

    Ok(已校验消息 {
        文本: trimmed_text.to_string(),
        附件: refs,
    })
}

#[cfg(test)]
mod 消息领域测试 {
    use super::*;

    #[test]
    fn 创建文本消息_2000字符以内应成功() {
        let text = "a".repeat(2000);
        let result = 创建文本消息(true, &text);
        assert!(result.is_ok());
    }

    #[test]
    fn 创建文本消息_超过2000字符应拒绝() {
        let text = "a".repeat(2001);
        let result = 创建文本消息(true, &text);
        assert_eq!(result, Err(领域错误::消息文本过长));
    }

    #[test]
    fn 创建消息_超过2000字符即使有附件也应拒绝() {
        let text = "a".repeat(2001);
        let attachment = 待发送附件 {
            附件标识: "att-1".to_string(),
            种类: 附件种类::图片,
            宽: 100,
            高: 100,
            有预览图: false,
            状态: 附件槽位状态::已就绪,
        };
        let result = 创建消息(true, &text, &[attachment]);
        assert_eq!(result, Err(领域错误::消息文本过长));
    }

    #[test]
    fn 创建消息_2000个中文字符应成功() {
        let text = "啊".repeat(2000);
        let result = 创建消息(true, &text, &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn 创建消息_2001个中文字符应拒绝() {
        let text = "啊".repeat(2001);
        let result = 创建消息(true, &text, &[]);
        assert_eq!(result, Err(领域错误::消息文本过长));
    }
}

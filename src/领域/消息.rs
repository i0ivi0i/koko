use super::{member::校验成员可发言, 领域错误};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 文本消息 {
    pub 文本: String,
}

/// 发送文本消息的核心不变量：先校验成员，再校验文本。
pub fn 创建文本消息(是否成员: bool, 文本: &str) -> Result<文本消息, 领域错误> {
    校验成员可发言(是否成员)?;
    if 文本.trim().is_empty() {
        return Err(领域错误::消息文本为空);
    }
    Ok(文本消息 {
        文本: 文本.trim().to_string(),
    })
}

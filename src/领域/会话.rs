/// 会话是用户在系统中的最小身份载体，不承载任何传输层细节。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 会话 {
    pub 会话标识: String,
    pub 显示名: String,
}

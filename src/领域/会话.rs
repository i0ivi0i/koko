/// 会话是用户在系统中的最小身份载体，不承载任何传输层细节。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct 会话 {
    /// 对外稳定会话标识（例如 `s-xxxx`）。
    pub 会话标识: String,
    /// 当前会话展示名。注意：展示名不是权限或治理语义。
    pub 显示名: String,
}

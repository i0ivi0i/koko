use uuid::Uuid;

use crate::{shared::contract, user_identity};

/// 身份 bootstrap 草案是“身份上下文已经裁决完，但还没交给 adapter 落库”的最小真相包。
///
/// 设计边界：
/// 1. 这里允许携带内部身份、主题键、展示花名和稳定会话锚点；
/// 2. 这些字段只在身份上下文 application -> adapter 之间流动，不进入共享 contract；
/// 3. adapter 之后只能持久化/恢复这份草案，不能再自己补造第二份身份真相。
#[derive(Debug, Clone)]
pub struct 匿名身份引导草案 {
    pub 匿名身份标识: String,
    pub 内部身份标识: Uuid,
    pub 主题键: String,
    pub 展示花名: String,
    pub 会话标识: String,
}

impl 匿名身份引导草案 {
    /// 应用层新建 bootstrap 草案时，必须一次性决定：
    /// 1. 当前设备对应哪个匿名内部身份；
    /// 2. 当前对外展示什么花名；
    /// 3. 当前冷/热路径复用哪个稳定会话锚点。
    pub fn 新建() -> Self {
        let projection = user_identity::随机分配资料投影();
        Self {
            匿名身份标识: 生成匿名身份标识(),
            内部身份标识: user_identity::生成内部身份(),
            主题键: projection.theme_key,
            展示花名: projection.display_alias,
            会话标识: 生成会话标识(),
        }
    }

    /// 共享 contract 仍只承认“展示花名 + 会话锚点”。
    /// 匿名内部身份与主题键继续留在身份上下文和持久化层，不外泄给壳层。
    pub fn 导出引导结果(&self) -> contract::匿名身份引导结果 {
        contract::匿名身份引导结果 {
            展示花名: self.展示花名.clone(),
            会话标识: self.会话标识.clone(),
        }
    }
}

/// 迁移窗口内仍需保留旧匿名身份短标识。
/// 它只是持久化层兼容缝，不再冒充内部真实主键。
fn 生成匿名身份标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("a-{}", &raw[..12])
}

/// 会话是运行锚点，不承载展示语义。
/// 当前保持 `s-` 前缀，避免打破既有冷/热路径与测试夹具。
fn 生成会话标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("s-{}", &raw[..12])
}

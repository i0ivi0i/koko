use crate::shared::contract;

pub use super::anonymous_identity::匿名身份引导草案;

/// 会话 -> 匿名内部身份 解析口属于身份上下文。
///
/// 之前这条能力被塞进共享应用总口，结果消息、媒体、阅读推进都得先依赖那个总口。
/// 现在显式把它收回身份 owner 名下，其他上下文如果需要这条事实，只能按这个稳定语义来拿。
pub trait 会话身份读取端口 {
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码>;
}

/// adapter 对 identity bootstrap 暴露的最小持久化结果。
///
/// 这里故意不把“唯一约束冲突”翻成 `系统错误`：
/// application 需要明确知道它遇到的是幂等竞态，才能走二次回查而不是继续拍脑袋补逻辑。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 匿名身份引导写入结果 {
    已写入(contract::匿名身份引导结果),
    设备匿名凭证已存在,
}

/// 身份上下文自己的 bootstrap 仓储口。
/// application 只允许向外要求两件事：
/// 1. 查询这个设备入口凭证是否已经有既有引导结果；
/// 2. 把已经裁决好的 bootstrap 草案持久化。
pub trait 身份引导仓储端口: 会话身份读取端口 {
    fn 查询既有匿名身份引导结果(
        &self,
        设备匿名凭证: &str,
    ) -> Result<Option<contract::匿名身份引导结果>, contract::错误码>;

    fn 写入匿名身份引导草案(
        &mut self,
        设备匿名凭证: &str,
        草案: &匿名身份引导草案,
    ) -> Result<匿名身份引导写入结果, contract::错误码>;
}

/// 身份业务模块的第一条稳定能力：
/// 把“设备入口凭证 -> 当前会话锚点”的裁决收回身份上下文。
///
/// 这里要守的不是“能不能成功落库”，而是“谁拥有 bootstrap 真相”：
/// 1. application 负责决定要不要新建匿名身份草案；
/// 2. adapter 只负责读取既有结果、写入草案和翻译幂等冲突；
/// 3. 同一设备入口凭证如果撞上唯一约束，application 必须二次回查，而不是让 adapter 偷偷裁决业务语义。
pub fn 引导匿名身份(
    仓储: &mut impl 身份引导仓储端口,
    设备匿名凭证: &str,
) -> Result<contract::匿名身份引导结果, contract::错误码> {
    if 设备匿名凭证.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }

    if let Some(existing) = 仓储.查询既有匿名身份引导结果(设备匿名凭证)? {
        return Ok(existing);
    }

    let 草案 = 匿名身份引导草案::新建();
    match 仓储.写入匿名身份引导草案(设备匿名凭证, &草案)? {
        匿名身份引导写入结果::已写入(snapshot) => Ok(snapshot),
        匿名身份引导写入结果::设备匿名凭证已存在 => 仓储
            .查询既有匿名身份引导结果(设备匿名凭证)?
            .ok_or(contract::错误码::系统错误),
    }
}

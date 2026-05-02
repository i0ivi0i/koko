use crate::{shared::contract, usecase};

/// 身份业务模块的第一条稳定能力：
/// 把“设备入口凭证 -> 当前会话锚点”的裁决从统一用例文件里抽出来。
///
/// 这里故意保持实现很薄，因为当前真正的业务真相仍在仓储端口后面。
/// 本次重构的目的不是发明第二套身份逻辑，而是把 owner 位置先收清楚。
pub fn 引导匿名身份(
    仓储: &mut dyn usecase::仓储端口,
    设备匿名凭证: &str,
) -> Result<contract::匿名身份引导结果, contract::错误码> {
    if 设备匿名凭证.trim().is_empty() {
        return Err(contract::错误码::参数非法);
    }
    仓储.引导匿名身份(设备匿名凭证)
}

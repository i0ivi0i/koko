/// 应用启动入口只负责编排，不承载业务规则。
pub async fn 启动() -> std::io::Result<()> {
    let _配置 = crate::assembly::读取配置()?;
    Ok(())
}

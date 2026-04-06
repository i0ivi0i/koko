/// 应用启动入口只负责编排，不承载业务规则。
///
/// 维护者阅读指南：
/// 1. 这里是“启动总管”，职责是：初始化日志 -> 读取配置 -> 自动迁移 -> 绑定端口 -> 启服务。
/// 2. 这里不允许出现任何“谁能发消息/谁是成员”之类的业务裁决。
/// 3. 启动失败会统一打结构化日志，便于排查是配置、迁移还是端口问题。
pub async fn 启动() -> std::io::Result<()> {
    // 约束：日志必须天然存在，不能靠“临时加 println”排错。
    crate::assembly::初始化日志()?;

    // 启动 span 统一携带 usecase/adapter，方便从日志里串联整条启动链路。
    let span = tracing::info_span!("startup", usecase = "服务启动", adapter = "entry");
    let _entered = span.enter();

    // 先读配置；配置缺失是“启动前失败”，不是“运行时异常”。
    let config = crate::assembly::读取配置();
    if let Err(err) = &config {
        记录命令失败("服务启动", "entry", "config_missing", &err.to_string());
    }
    let config = config?;

    // 再追平迁移；迁移失败必须直接阻断启动，避免半健康服务对外。
    let migrate_result = crate::assembly::自动追平迁移(&config.database_url).await;
    if let Err(err) = &migrate_result {
        记录命令失败("服务启动", "entry", "migration_failed", &err.to_string());
    }
    migrate_result?;

    // 这里仅做路由总装，不参与任何业务语义判断。
    let state = crate::shell::构建应用状态(
        config.database_url.clone(),
        config.admin_password.clone(),
    )
    .await?;
    let app = crate::shell::构建路由(state);
    let addr = format!("0.0.0.0:{}", config.app_port);

    // 端口绑定失败通常是“端口占用/权限问题”，归类为基础设施错误。
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|err| std::io::Error::other(format!("监听端口失败: {err}")))?;
    tracing::info!(
        usecase = "服务启动",
        adapter = "entry",
        app_port = config.app_port,
        "HTTP 冷路径服务已启动"
    );
    axum::serve(listener, app)
        .await
        .map_err(|err| std::io::Error::other(format!("服务运行失败: {err}")))
}

/// 启动与入口链路的统一错误日志出口。
///
/// 约束：只记录“入口层失败语义”，不在这里做业务重试或错误吞掉。
pub fn 记录命令失败(usecase: &str, adapter: &str, error_code: &str, message: &str) {
    tracing::error!(
        usecase = usecase,
        adapter = adapter,
        error_code = error_code,
        message = message,
        "命令执行失败"
    );
}

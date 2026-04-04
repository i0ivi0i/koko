/// 应用启动入口只负责编排，不承载业务规则。
pub async fn 启动() -> std::io::Result<()> {
    crate::assembly::初始化日志()?;

    let span = tracing::info_span!("startup", usecase = "服务启动", adapter = "entry");
    let _entered = span.enter();

    let config = crate::assembly::读取配置();
    if let Err(err) = &config {
        记录命令失败("服务启动", "entry", "config_missing", &err.to_string());
    }
    let config = config?;
    let migrate_result = crate::assembly::自动追平迁移(&config.database_url).await;
    if let Err(err) = &migrate_result {
        记录命令失败("服务启动", "entry", "migration_failed", &err.to_string());
    }
    migrate_result?;

    let app = crate::shell::构建路由(config.database_url.clone(), config.admin_password.clone());
    let addr = format!("0.0.0.0:{}", config.app_port);
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

pub fn 记录命令失败(usecase: &str, adapter: &str, error_code: &str, message: &str) {
    tracing::error!(
        usecase = usecase,
        adapter = adapter,
        error_code = error_code,
        message = message,
        "命令执行失败"
    );
}

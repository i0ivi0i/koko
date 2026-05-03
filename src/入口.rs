use std::{future::Future, io, time::Duration};

/// 某些后台任务依赖 sidecar/外部控制面先完成启动。
/// 这里显式延迟首拍，避免 Tokio `interval()` 默认“创建后立刻 tick 一次”把服务刚起来的冷启动窗口打穿。
fn 创建延迟首拍周期器(period: Duration) -> tokio::time::Interval {
    tokio::time::interval_at(tokio::time::Instant::now() + period, period)
}

/// 应用启动入口只负责编排，不承载业务规则。
///
/// 维护者阅读指南：
/// 1. 这里是“启动总管”，职责是：初始化日志 -> 读取配置 -> 自动迁移 -> 绑定端口 -> 启服务。
/// 2. 这里不允许出现任何“谁能发消息/谁是成员”之类的业务裁决。
/// 3. 启动失败会统一打结构化日志，便于排查是配置、迁移还是端口问题。
pub async fn 启动() -> io::Result<()> {
    启动并等待关闭信号(等待退出信号()).await
}

/// 把“如何判断应该停机”从启动主流程里抽出来：
/// - 生产运行时由系统信号驱动
/// - 测试里可以注入自定义关闭 future，验证服务会不会按同一路径优雅退出
pub async fn 启动并等待关闭信号<F>(shutdown_signal: F) -> io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    // 约束：日志必须天然存在，不能靠“临时加 println”排错。
    // main 会尽量在 Tokio runtime 之前先装日志；这里仍保留幂等调用，给测试和其它入口兜底。
    crate::assembly::初始化日志()?;

    // 启动 span 统一携带 application/adapter，方便从日志里串联整条启动链路。
    let span = tracing::info_span!("startup", application = "服务启动", adapter = "entry");
    let _entered = span.enter();
    // accepted 表示“入口已接住这次启动动作”，但此时配置、迁移、端口绑定都还没证明成功。
    tracing::info!(
        application = "服务启动",
        adapter = "entry",
        outcome = "accepted",
        "服务启动请求已受理"
    );

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

    // 这里仅做路由装配，不参与任何业务语义判断。
    let state = crate::shell::构建应用状态(
        config.database_url.clone(),
        config.admin_password.clone(),
    )
    .await?;
    let app = crate::shell::构建路由(state.clone());
    let addr = format!("0.0.0.0:{}", config.app_port);

    // 端口绑定失败通常是“端口占用/权限问题”，归类为基础设施错误。
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(err) => {
            记录命令失败("服务启动", "entry", "port_bind_failed", &err.to_string());
            return Err(std::io::Error::other(format!("监听端口失败: {err}")));
        }
    };
    // 只有监听端口与路由装配都完成后，才允许宣告启动 succeeded。
    tracing::info!(
        application = "服务启动",
        adapter = "entry",
        outcome = "succeeded",
        app_port = config.app_port,
        "HTTP 冷路径服务已启动"
    );
    let cleanup_state = state.clone();
    let cleanup_interval_seconds = config.协作分发.media_origin_cleanup_interval_seconds;
    let cleanup_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            cleanup_interval_seconds as u64,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if let Err(err) = crate::shell::媒体清理::执行一次媒体冷源清理(cleanup_state.clone()).await
            {
                tracing::error!(
                    application = "媒体冷源清理",
                    adapter = "entry",
                    outcome = "failed",
                    error = %err,
                    "后台媒体冷源清理失败"
                );
            }
            if let Err(err) =
                crate::shell::媒体清理::执行一次媒体上传残留清理(cleanup_state.clone()).await
            {
                tracing::error!(
                    application = "上传残留清理",
                    adapter = "entry",
                    outcome = "failed",
                    error = %err,
                    "后台上传残留清理失败"
                );
            }
        }
    });
    let seed_reconcile_state = state.clone();
    let seed_reconcile_interval_seconds = config
        .协作分发
        .swarm_seed_reconcile_interval_seconds;
    let seed_reconcile_handle = tokio::spawn(async move {
        let mut interval = 创建延迟首拍周期器(Duration::from_secs(
            seed_reconcile_interval_seconds as u64,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            // 做种续租不能挂在冷源清理周期上；ticket TTL 更短时必须按独立 cadence 刷新 sidecar。
            if let Err(err) =
                crate::shell::协作分发做种::执行一次协作分发做种对账(seed_reconcile_state.clone()).await
            {
                tracing::error!(
                    application = "协作分发做种对账",
                    adapter = "entry",
                    outcome = "failed",
                    error = %err,
                    "后台协作分发做种对账失败"
                );
            }
        }
    });
    let serve_result = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal.await;
            tracing::info!(
                application = "服务停止",
                adapter = "entry",
                outcome = "accepted",
                "接收到退出信号，开始优雅停机"
            );
        })
        .await;
    cleanup_handle.abort();
    seed_reconcile_handle.abort();
    if let Err(err) = serve_result {
        记录命令失败("服务启动", "entry", "serve_failed", &err.to_string());
        return Err(io::Error::other(format!("服务运行失败: {err}")));
    }
    tracing::info!(
        application = "服务停止",
        adapter = "entry",
        outcome = "succeeded",
        "HTTP 冷路径服务已优雅停止"
    );
    Ok(())
}

/// 启动与入口链路的统一错误日志出口。
///
/// 约束：只记录“入口层失败语义”，不在这里做业务重试或错误吞掉。
pub fn 记录命令失败(application: &str, adapter: &str, error_code: &str, message: &str) {
    tracing::error!(
        application = application,
        adapter = adapter,
        outcome = "failed",
        error_code = error_code,
        message = message,
        "命令执行失败"
    );
}

/// 运行态的关闭信号统一收口到这里，避免退出语义散落在 main、launcher 或 adapter 里。
///
/// 当前先覆盖 Tokio 官方最常见的 Ctrl+C 路径；
/// Unix 下再顺手承接 SIGTERM，方便以后容器或 service manager 直接复用。
async fn 等待退出信号() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("安装 Ctrl+C 信号监听失败");
    };

    #[cfg(unix)]
    {
        let terminate = async {
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("安装 SIGTERM 信号监听失败")
                .recv()
                .await;
        };

        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
        }
    }

    #[cfg(not(unix))]
    {
        ctrl_c.await;
    }
}

#[cfg(test)]
mod tests {
    use super::创建延迟首拍周期器;
    use std::time::Instant;
    use tokio::time::{self, Duration, MissedTickBehavior};

    #[tokio::test]
    async fn 延迟首拍周期器不会在刚创建后立刻触发() {
        let mut interval = 创建延迟首拍周期器(Duration::from_millis(200));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);

        assert!(
            time::timeout(Duration::from_millis(50), interval.tick())
                .await
                .is_err(),
            "协作分发做种对账首拍必须等 sidecar 启动窗口过去，不能在服务刚绑定端口后立刻开火"
        );

        let started_at = Instant::now();
        interval.tick().await;
        assert!(
            started_at.elapsed() >= Duration::from_millis(120),
            "首拍至少要明显晚于刚创建后的冷启动窗口，不能退化回立即 tick"
        );
    }
}

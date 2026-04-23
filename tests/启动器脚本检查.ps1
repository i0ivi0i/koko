$ErrorActionPreference = "Stop"

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$runScriptPath = Join-Path $repoRoot "run.ps1"
$upScriptPath = Join-Path $repoRoot "up.ps1"
$cleanScriptPath = Join-Path $repoRoot "qingli.ps1"
$trackerScriptPath = Join-Path $repoRoot "frontend\\dev-tracker.mjs"
$seederScriptPath = Join-Path $repoRoot "frontend\\dev-seeder.mjs"

Assert-True (Test-Path -LiteralPath $runScriptPath) "缺少 run.ps1。"
Assert-True (Test-Path -LiteralPath $upScriptPath) "缺少 up.ps1；应该提供显式升级入口，而不是让 run.ps1 偷偷升级依赖。"
Assert-True (Test-Path -LiteralPath $cleanScriptPath) "缺少 qingli.ps1；应该提供项目级测试数据清理入口。"

$runScript = Get-Content -LiteralPath $runScriptPath -Raw
$upScript = Get-Content -LiteralPath $upScriptPath -Raw
$cleanScript = Get-Content -LiteralPath $cleanScriptPath -Raw
$cleanupMenuSection = [regex]::Match(
    $runScript,
    'function Show-StartupCleanupMenu \{[\s\S]*?\n\}\r?\n\r?\nfunction New-LauncherLogDirectory'
).Value
$cleanStartupOptimizationSection = [regex]::Match(
    $cleanScript,
    'function Get-StartupArtifactOptimizationTargets \{[\s\S]*?\n\}\r?\n\r?\nfunction Get-WorkspaceStorageReclaimTargets'
).Value
$trackerScript = if (Test-Path -LiteralPath $trackerScriptPath) {
    Get-Content -LiteralPath $trackerScriptPath -Raw
} else {
    ""
}
$seederScript = if (Test-Path -LiteralPath $seederScriptPath) {
    Get-Content -LiteralPath $seederScriptPath -Raw
} else {
    ""
}
$runScriptTokens = $null
$runScriptParseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    $runScriptPath,
    [ref]$runScriptTokens,
    [ref]$runScriptParseErrors
) | Out-Null
$cleanScriptTokens = $null
$cleanScriptParseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    $cleanScriptPath,
    [ref]$cleanScriptTokens,
    [ref]$cleanScriptParseErrors
) | Out-Null

Assert-True ($runScriptParseErrors.Count -eq 0) "run.ps1 必须先通过 PowerShell 语法解析，不能连启动前都在脚本插值阶段炸掉。"
Assert-True ($cleanScriptParseErrors.Count -eq 0) "qingli.ps1 必须先通过 PowerShell 语法解析，不能连清理前都在参数或插值阶段炸掉。"

Assert-True ($runScript -match '\[switch\]\$UpgradeDependencies') "run.ps1 应该显式接受 UpgradeDependencies 开关。"
Assert-True ($runScript -match '\[switch\]\$DisableLocalHttpsBootstrap') "run.ps1 应允许显式关闭本地 HTTPS 引导，避免调试特殊场景时只能改脚本。"
Assert-True ($runScript -match 'if \(\$UpgradeDependencies\)') "run.ps1 应该只在显式升级模式下刷新依赖。"
Assert-True ($runScript -match 'https\.ps1') "run.ps1 应该衔接 https.ps1，让一键启动默认包含本地 HTTPS 主链。"
Assert-True ($runScript -match '-SkipAppBootstrap') "run.ps1 调用 https.ps1 时应显式跳过二次拉起 run.ps1，避免启动递归。"
Assert-True ($runScript -match '-LauncherMode') "run.ps1 调用 https.ps1 时应使用 launcher 模式，避免把证书安装/开机任务交互阻塞主链。"
Assert-True (-not ($runScript -match 'Start-AppViaRunScriptIfNeeded')) "run.ps1 不得复制 https.ps1 的 app bootstrap 协调入口。"
Assert-True (-not ($runScript -match 'Wait-LoopbackPortOpen')) "run.ps1 不得复制 https.ps1 的端口就绪轮询。"
Assert-True ($runScript -match 'Update-CloudflareTunnelStateFromLogLine') "run.ps1 应把 tunnel 行解析收口到独立 helper，避免 Write-ManagedProcessLogs 长成第二运行总控。"
Assert-True ($runScript -match 'Write-ManagedStreamLines') "run.ps1 应把 stdout/stderr 输出循环收口到独立 helper，避免 Write-ManagedProcessLogs 同时背两条日志 owner。"
Assert-True ($runScript -match 'Write-CloudflareTunnelReadyBanner') "run.ps1 应把 tunnel ready 横幅收口到独立 helper，避免 Write-ManagedProcessLogs 继续混入展示编排。"
Assert-True ($runScript -match 'Write-ManagedProcessLogs[\s\S]*Update-CloudflareTunnelStateFromLogLine') "Write-ManagedProcessLogs 应该只托管日志读取与输出，把 tunnel 状态解析委托给 helper。"
Assert-True ($runScript -match 'Stop-StaleLauncherBackend') "run.ps1 应该只清理自己 launcher-run 留下的开发态后端残进程，而不是发明项目级退出真相。"
Assert-True ($runScript -match 'launcher-run') "run.ps1 应该把开发启动器产物隔离在 launcher-run 目录下，避免跟源码主产物争抢。"
Assert-True ($runScript -match 'Get-Command tusd(?:\.exe)?') "run.ps1 应该显式检查 tusd 可执行文件是否存在。"
Assert-True ($runScript -match '-hooks-http') "run.ps1 应该显式给 tusd 配置 HTTP hooks。"
Assert-True ($runScript -match '-hooks-enabled-events') "run.ps1 应该显式限制启用的 tusd hook 事件。"
Assert-True ($runScript -match 'pre-create,post-finish,pre-terminate,post-terminate') "run.ps1 应该显式打开 pre-create/post-finish/pre-terminate/post-terminate。"
Assert-True ($runScript -match '-hooks-http-forward-headers') "run.ps1 应该显式透传 tusd hook 需要的头。"
Assert-True ($runScript -match 'Authorization,X-Request-ID,X-Koko-Internal-Termination') "run.ps1 默认应透传 Authorization、X-Request-ID 和内部 termination 守卫头。"
Assert-True ($runScript -match 'TUSD_MAX_SIZE') "run.ps1 应该允许显式覆写 tusd 的 max-size。"
Assert-True ($runScript -match '-max-size') "run.ps1 应该显式传入 tusd 的 max-size。"
Assert-True (
    $runScript -match '200\s*\*\s*1024\s*\*\s*1024' -or
    $runScript -match '209715200'
) "run.ps1 默认的 tusd max-size 至少应该覆盖当前群聊视频 200 MiB 的业务上限。"
Assert-True ($runScript -match '-disable-download') "run.ps1 应该显式禁用 tusd 默认下载能力。"
Assert-True ($runScript -match 'TUSD_BEHIND_PROXY') "run.ps1 应允许显式声明 tusd behind-proxy。"
Assert-True ($runScript -match '-behind-proxy') "run.ps1 应在启用时把 behind-proxy 传给 tusd。"
Assert-True ($runScript -match 'TUSD_HOST') "run.ps1 应该允许显式覆写 tusd 的监听 host。"
Assert-True ($runScript -match '"0\.0\.0\.0"') "run.ps1 默认的 tusd 监听 host 应该允许局域网设备访问，不能继续硬编码成本机回环。"
Assert-True ($runScript -match 'TUSD_PORT') "run.ps1 应该允许显式覆写 tusd 的监听端口。"
Assert-True ($runScript -match '-base-path') "run.ps1 应该显式固定 tusd 的 Tus base path。"
Assert-True ($runScript -match '-upload-dir') "run.ps1 应该显式固定 tusd 的共享上传目录。"
Assert-True ($runScript -match 'MEDIA_TUS_INTERNAL_TERMINATION_TOKEN') "run.ps1 应该给后端和 tusd hook 协调同一份内部 termination 守卫。"
Assert-True ($runScript -match '/internal/tus/hooks') "run.ps1 应该把 tusd hook 回调地址切到 /internal/tus/hooks。"
Assert-True ($runScript -match '-Name "tusd"') "run.ps1 应该把 tusd 作为独立托管进程拉起。"
Assert-True (-not ($runScript -match '--info-dir')) "tusd 本地盘不再需要 Rustus 风格的 info-dir。"
Assert-True (-not ($runScript -match '--remove-parts')) "tusd 不支持 Rustus 的 remove-parts，partial 清理由主服务/GC 收口。"
Assert-True (-not ($runScript -match '-disable-termination')) "当前阶段要站在 tusd 官方 termination 能力上，run.ps1 不应禁用 termination。"
Assert-True ($runScript -match 'bittorrent-tracker') "run.ps1 应该启动 bittorrent-tracker 开发进程，避免 Phase 2 还要靠手工另开一个窗口。"
Assert-True ($runScript -match 'SWARM_TRACKER_PORT') "run.ps1 应该允许显式覆写 tracker 端口。"
Assert-True ($runScript -match 'SWARM_SEEDER_PORT') "run.ps1 应该允许显式覆写 seeder 控制面端口。"
Assert-True ($runScript -match 'SWARM_TRACKER_PUBLIC_URL') "run.ps1 应该允许显式覆写前端 announce 用的 tracker 公网地址。"
Assert-True ($runScript -match 'SWARM_TICKET_SECRET') "run.ps1 应该为后端和 tracker 协调同一份 swarm join ticket secret。"
Assert-True ($runScript -match '--ticket-secret') "run.ps1 应该把 ticket secret 传给 tracker 进程，而不是让 tracker 自己猜。"
Assert-True ($runScript -match '-Name "tracker"') "run.ps1 应该把 tracker 当成独立受管进程拉起。"
Assert-True ($runScript -match '-Name "webtorrent-seeder"') "run.ps1 应该把 webtorrent-seeder 当成独立受管进程拉起。"
Assert-True ($runScript -match 'dev-seeder\.mjs') "run.ps1 应该显式拉起 dev-seeder.mjs，避免 seeder 仍靠人工另开窗口。"
Assert-True (Test-Path -LiteralPath $trackerScriptPath) "应该提供 frontend/dev-tracker.mjs，把官方 tracker server 子入口收口成可复用开发脚本。"
Assert-True (Test-Path -LiteralPath $seederScriptPath) "应该提供 frontend/dev-seeder.mjs，把 WebRTC seeder sidecar 收口成可复用开发脚本。"
Assert-True ($trackerScript -match 'bittorrent-tracker/server') "frontend/dev-tracker.mjs 应该直接复用官方 bittorrent-tracker/server 子入口，而不是手搓 tracker。"
Assert-True ($trackerScript -match 'jsonwebtoken') "frontend/dev-tracker.mjs 应该直接复用成熟 JWT 库校验 join_ticket，而不是手搓签名解析。"
Assert-True ($trackerScript -match 'params\.ticket') "frontend/dev-tracker.mjs 应该从 tracker 参数里读取 join_ticket。"
Assert-True ($trackerScript -match 'join_ticket_invalid') "frontend/dev-tracker.mjs 应该对外返回稳定的 invalid ticket 原因，方便前端恢复。"
Assert-True ($seederScript -match 'webtorrent-hybrid|webtorrent') "frontend/dev-seeder.mjs 应该复用成熟 WebTorrent 实现，而不是手搓协议栈。"
Assert-True ($seederScript -match '/seed/start') "frontend/dev-seeder.mjs 应该暴露 start 控制面。"
Assert-True ($seederScript -match '/seed/stop') "frontend/dev-seeder.mjs 应该暴露 stop 控制面。"
Assert-True ($seederScript -match '/seed/reconcile') "frontend/dev-seeder.mjs 应该暴露 reconcile 控制面。"
Assert-True ($seederScript -match 'getAnnounceOpts') "frontend/dev-seeder.mjs 应该把 join ticket 通过 getAnnounceOpts 透传给 tracker。"
Assert-True ($seederScript -match 'joinTicket|join_ticket') "frontend/dev-seeder.mjs 的 start payload 应该支持 join ticket 字段。"
Assert-True ($seederScript -match 'announceTicketRef') "frontend/dev-seeder.mjs 应该持有可更新的 announce ticket 引用，避免同一 infohash 在 ticket 轮换后继续广播旧票据。"
Assert-True ($seederScript -match 'refreshedTicket') "frontend/dev-seeder.mjs 应该显式返回 ticket 刷新结果，便于控制面和烟测定位续租是否生效。"
Assert-True ($seederScript -match 'existing\.joinTicket') "frontend/dev-seeder.mjs 应该在复用同一 infohash 会话时比较并更新 join ticket。"
Assert-True ($seederScript -match 'existing\.announceTicketRef') "frontend/dev-seeder.mjs 应该把新 ticket 回写到活跃会话 announce 引用，防止 tracker 长时间 join_ticket_invalid。"
Assert-True ($seederScript -match 'SWARM_SEEDER_FORCE_MOCK') "frontend/dev-seeder.mjs 应该支持 SWARM_SEEDER_FORCE_MOCK=1，便于在无 WebTorrent 运行时的环境里稳定复现实验与自动化验证。"
Assert-True ($runScript -match 'Get-ListeningPortProcessRecords') "run.ps1 应该在启动前识别端口占用归属，而不是等 sidecar 启动失败后才把残留暴露给开发者。"
Assert-True ($runScript -match 'Stop-StaleLauncherSidecars') "run.ps1 应该在启动前自动回收自己留下的 tusd / tracker 残留。"
Assert-True ($runScript -match 'Invoke-LauncherCleanup') "run.ps1 应该把退出清理收口成统一入口，避免 finally / 退出事件各清各的。"
Assert-True ($runScript -match 'PowerShell\.Exiting') "run.ps1 应该在 PowerShell 退出时继续 best-effort 清理自己托管的开发子进程。"
Assert-True (-not ($runScript -match 'cargo\s+install\s+tusd')) "run.ps1 不应该偷偷安装 tusd；缺失时应该直接失败。"
Assert-True (-not ($runScript -match 'GenerateConsoleCtrlEvent')) "run.ps1 不应该为了开发态收尾引入 Windows 控制台信号桥接这种过度设计。"
Assert-True (-not ($runScript -match 'CREATE_NEW_PROCESS_GROUP')) "run.ps1 不应该内建 Win32 进程组控制，避免开发脚本反客为主。"
Assert-True (-not ($runScript -match 'CancelKeyPress')) "run.ps1 不应该接管项目级退出语义；控制台中断细节不该让开发脚本越位。"
Assert-True ($runScript -match 'taskkill\.exe /PID \$process\.Id /T /F') "run.ps1 仍然应该保留强杀兜底，避免失控 watcher 留下孤儿进程。"
Assert-True ($upScript -match '-UpgradeDependencies') "up.ps1 应该把 UpgradeDependencies 开关传给 run.ps1。"
Assert-True ($upScript -match 'run\.ps1') "up.ps1 应该复用 run.ps1，而不是复制出第二套启动主链。"
Assert-True ($cleanScript -match '\[switch\]\$Apply') "qingli.ps1 应该显式接受 Apply 开关，避免无人值守调用把 -Apply 误解析成别的参数。"
Assert-True ($cleanScript -match '\[switch\]\$OptimizeStartupArtifacts') "qingli.ps1 应该显式接受启动自动优化开关，避免 run.ps1 再复制第二套清理真相。"
Assert-True ($cleanScript -match '\[switch\]\$ReclaimWorkspaceStorage') "qingli.ps1 应该显式接受工作区重清理开关，给磁盘告急场景留出一键回收入口。"
Assert-True ($cleanScript -match 'MEDIA_TUS_UPLOAD_DIR') "qingli.ps1 应该跟随 tusd 主链清理 MEDIA_TUS_UPLOAD_DIR，而不是继续只盯着旧的 Rustus 目录。"
Assert-True ($cleanScript -match 'TUSD_PORT' -or $cleanScript -match 'MEDIA_TUS_SERVER_PORT') "qingli.ps1 应该优先读取当前 tusd 端口配置，而不是只看旧的 RUSTUS_SERVER_PORT。"
Assert-True ($cleanScript -match 'SWARM_SEEDER_PORT') "qingli.ps1 应该把 webtorrent-seeder 也纳入已识别服务停服范围。"
Assert-True ($cleanScript -match 'Get-NetTCPConnection') "qingli.ps1 的停服判断应该直接查看端口归属，而不是只做盲猜。"
Assert-True ($cleanScript -match 'taskkill\.exe /PID \$processId /T /F') "qingli.ps1 在 Force 模式下应该能强制结束已识别的项目开发进程。"
Assert-True ($cleanScript -match 'if \(\$Force\) \{[\s\S]*Stop-RecognizedProjectServices') "qingli.ps1 应该只在 Force 无人值守模式下自动停掉已识别项目服务。"
Assert-True ($cleanScript -match 'target\\launcher-run') "qingli.ps1 的自动优化清理应该纳入 launcher-run 产物。"
Assert-True ($cleanScript -match 'target\\realtime-tests') "qingli.ps1 的自动优化清理应该纳入 realtime-tests 产物。"
Assert-True ($cleanScript -match 'frontend\\dist') "qingli.ps1 的自动优化清理应该纳入前端 dist 产物。"
Assert-True ($cleanScript -match 'tmp\\audit') "qingli.ps1 的自动优化清理应该纳入 tmp/audit 审计产物。"
Assert-True (-not ($cleanScript -match 'target\\debug')) "qingli.ps1 的自动优化清理不应该越权清空默认 target/debug。"
Assert-True (-not ($cleanStartupOptimizationSection -match 'frontend\\node_modules')) "qingli.ps1 的自动优化清理不应该动前端 node_modules。"
Assert-True ($cleanScript -match 'cargo(?:\.exe)?\s+clean') "qingli.ps1 的工作区重清理应该直接复用 cargo clean，而不是手搓第二套 Rust 构建产物删除逻辑。"
Assert-True ($cleanScript -match 'frontend\\node_modules') "qingli.ps1 的工作区重清理应该能回收前端 node_modules。"
Assert-True ($cleanScript -match 'frontend\\\.tsbuildinfo') "qingli.ps1 的工作区重清理应该能回收 TypeScript 增量缓存。"
Assert-True ($runScript -match '\[switch\]\$DisableAutoOptimizeCleanup') "run.ps1 应该允许显式关闭启动前自动优化，避免特殊调试场景只能改脚本。"
Assert-True ($runScript -match 'qingli\.ps1') "run.ps1 应该复用 qingli.ps1 的自动优化入口，而不是复制第三套清理逻辑。"
Assert-True ($runScript -match 'Show-StartupCleanupMenu') "run.ps1 现在应在每次启动时弹出清理模式菜单。"
Assert-True ($runScript -match 'ReadKey') "run.ps1 的清理模式菜单应直接读取键盘输入。"
Assert-True ($runScript -match 'VirtualKeyCode\s*-eq\s*38') "run.ps1 的清理模式菜单应支持上箭头。"
Assert-True ($runScript -match 'VirtualKeyCode\s*-eq\s*40') "run.ps1 的清理模式菜单应支持下箭头。"
Assert-True ($runScript -match 'VirtualKeyCode\s*-eq\s*13') "run.ps1 的清理模式菜单应支持回车确认。"
Assert-True ($runScript -match '继续启动') "run.ps1 的清理模式菜单应包含继续启动选项。"
Assert-True ($runScript -match '重清理后启动') "run.ps1 的清理模式菜单应包含重清理后启动选项。"
Assert-True ($runScript -match '取消') "run.ps1 的清理模式菜单应包含取消选项。"
Assert-True (-not ($cleanupMenuSection -match 'SetCursorPosition')) "run.ps1 的清理模式菜单不应再依赖 Console 游标定位；当前实现会在缓冲区边界下直接炸掉。"
Assert-True ($cleanupMenuSection -match 'Clear-Host') "run.ps1 的清理模式菜单应采用整屏重绘这类更稳的渲染方式，避免 cursor top 越界。"
Assert-True ($runScript -match '-OptimizeStartupArtifacts') "run.ps1 启动前应调用 qingli.ps1 的自动优化模式。"
Assert-True ($runScript -match '-SkipDatabase') "run.ps1 的自动优化不应触碰数据库真相。"
Assert-True ($runScript -match '-SkipFiles') "run.ps1 的自动优化不应触碰媒体/上传目录真相。"
Assert-True ($runScript -match '-ReclaimWorkspaceStorage') "run.ps1 的启动菜单应能分流到工作区重清理。"
Assert-True ($runScript -match 'Show-StartupCleanupMenu[\s\S]*Invoke-StartupArtifactOptimization') "run.ps1 的启动菜单应能分流到默认轻清理。"
Assert-True ($runScript -match 'Show-StartupCleanupMenu[\s\S]*Invoke-WorkspaceStorageReclaim') "run.ps1 的启动菜单应能分流到工作区重清理。"
Assert-True ($runScript -match 'Ensure-FrontendDependenciesInstalled') "run.ps1 应该在前端首轮构建前检查并补齐缺失依赖，避免重清理后直接卡死在空 node_modules。"
Assert-True ($runScript -match '--dir",\s*"frontend",\s*"install",\s*"--frozen-lockfile"' -or $runScript -match '--dir frontend install --frozen-lockfile') "run.ps1 补齐前端依赖时必须使用 frozen lockfile，不能偷偷升级依赖。"
Assert-True ($runScript -match 'Ensure-FrontendDependenciesInstalled[\s\S]*pnpm --dir frontend build') "run.ps1 应先补齐前端依赖，再执行首轮构建。"
Write-Host "启动器脚本检查通过。"

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
Assert-True ($runScript -match 'Write-ManagedStreamLines') "run.ps1 应把 stdout/stderr 输出循环收口到独立 helper，避免 Write-ManagedProcessLogs 同时背两条日志 owner。"
Assert-True (-not ($runScript -match 'Cloudflare|cloudflare|cloudflared|trycloudflare|DisableCloudflareTunnel|CLOUDFLARE_TUNNEL')) "run.ps1 已由 https.ps1 承接 HTTPS，且本项目任何环境都严禁 cloudflared，不得继续保留 Cloudflare tunnel 启动、下载、解析或开关。"
Assert-True (-not ($runScript -match '-Name "tunnel"')) "run.ps1 不得再托管 tunnel 子进程，避免和 https.ps1 形成两套公网/HTTPS入口。"
Assert-True (-not ($runScript -match 'Write-ManagedProcessLogs\s+\$cloudflareTunnelProcess')) "run.ps1 日志循环不得继续读取已删除的 Cloudflare tunnel 进程。"
Assert-True (-not ($runScript -match 'Stop-StaleLauncherBackend')) "run.ps1 不应继续保留已退场的单独后端残留清理壳；残留识别应统一收口到当前 launcher 服务补扫入口。"
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
Assert-True ($runScript -match '"127\.0\.0\.1"') "run.ps1 默认应把 tusd 收回本机回环，只允许浏览器通过后端同源 /files 入口访问。"
Assert-True ($runScript -match 'TUSD_PORT') "run.ps1 应该允许显式覆写 tusd 的监听端口。"
Assert-True ($runScript -match '-base-path') "run.ps1 应该显式固定 tusd 的 Tus base path。"
Assert-True ($runScript -match '-upload-dir') "run.ps1 应该显式固定 tusd 的共享上传目录。"
Assert-True ($runScript -match 'MEDIA_TUS_INTERNAL_TERMINATION_TOKEN') "run.ps1 应该给后端和 tusd hook 协调同一份内部 termination 守卫。"
Assert-True ($runScript -match 'MEDIA_TUS_PUBLIC_ENDPOINT') "run.ps1 应该显式协调浏览器公开 Tus contract。"
Assert-True ($runScript -match '"/files"') "run.ps1 的浏览器公开 Tus contract 默认应收口到同源 /files。"
Assert-True ($runScript -match '/internal/tus/hooks') "run.ps1 应该把 tusd hook 回调地址切到 /internal/tus/hooks。"
Assert-True ($runScript -match '-Name "tusd"') "run.ps1 应该把 tusd 作为独立托管进程拉起。"
Assert-True (-not ($runScript -match '--info-dir')) "tusd 本地盘不再需要 Rustus 风格的 info-dir。"
Assert-True (-not ($runScript -match '--remove-parts')) "tusd 不支持 Rustus 的 remove-parts，partial 清理由主服务/GC 收口。"
Assert-True (-not ($runScript -match '-disable-termination')) "当前阶段要站在 tusd 官方 termination 能力上，run.ps1 不应禁用 termination。"
Assert-True ($runScript -match 'bittorrent-tracker') "run.ps1 应该启动 bittorrent-tracker 开发进程，避免 Phase 2 还要靠手工另开一个窗口。"
Assert-True (-not ($runScript -match 'dev-tracker\.mjs')) "run.ps1 禁止继续启动自写 dev-tracker.mjs；业务验票已经回到 Rust 同源代理。"
Assert-True ($runScript -match 'SWARM_TRACKER_PORT') "run.ps1 应该允许显式覆写 tracker 端口。"
Assert-True ($runScript -match 'SWARM_SEEDER_PORT') "run.ps1 应该允许显式覆写 seeder 控制面端口。"
Assert-True ($runScript -match 'SWARM_TRACKER_PUBLIC_URL') "run.ps1 应该允许显式覆写前端 announce 用的 tracker 公网地址。"
Assert-True ($runScript -match '/api/swarm/announce') "run.ps1 的浏览器公开 announce 默认必须收口到同源 /api/swarm/announce。"
Assert-True ($runScript -match 'SWARM_TRACKER_UPSTREAM_URL') "run.ps1 应该显式配置后端 tracker upstream，浏览器和 sidecar 都不能裸连 tracker。"
Assert-True ($runScript -match 'SWARM_SEEDER_TRACKER_URL') "run.ps1 应该允许显式覆写 seeder 私有 tracker announce。"
Assert-True ($runScript -match 'api/swarm/announce') "seeder 私有 announce 默认必须走后端同源认证入口。"
Assert-True ($runScript -match 'stats') "成熟 tracker 必须暴露结构化 stats 入口，不能只靠人眼读日志。"
Assert-True ($runScript -match 'WebTorrent seeder 私有 announce') "run.ps1 应该把 public announce 与 seeder 私有 announce 分开打印，避免烟测误读。"
Assert-True ($runScript -match 'SWARM_TICKET_SECRET') "run.ps1 应该为后端和 tracker 协调同一份 swarm join ticket secret。"
Assert-True (-not ($runScript -match '--ticket-secret')) "成熟 tracker 不再接业务密钥；join_ticket 门禁只能由 Rust 同源代理执行。"
Assert-True ($runScript -match '-Name "tracker"') "run.ps1 应该把 tracker 当成独立受管进程拉起。"
Assert-True ($runScript -match '-Name "webtorrent-seeder"') "run.ps1 应该把 webtorrent-seeder 当成独立受管进程拉起。"
Assert-True ($runScript -match 'dev-seeder\.mjs') "run.ps1 应该显式拉起 dev-seeder.mjs，避免 seeder 仍靠人工另开窗口。"
Assert-True (Test-Path -LiteralPath $seederScriptPath) "应该提供 frontend/dev-seeder.mjs，把 WebRTC seeder sidecar 收口成可复用开发脚本。"
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
Assert-True ($runScript -match 'Test-TcpPortBindable') "run.ps1 启动前应显式验证目标端口已真正可绑定，避免 Ctrl+C 强杀后端口还没释放就又起一轮，最后只能靠重启电脑。"
Assert-True ($runScript -match 'Wait-PortsBindable') "run.ps1 启动前应等待 app/tusd/tracker/seeder 目标端口真正释放，而不是只看当前有没有监听。"
Assert-True (-not ($runScript -match 'Stop-StaleLauncherSidecars')) "run.ps1 不应继续保留旧 sidecar 清理包装；启动前残留回收应直接走统一 launcher 服务补扫。"
Assert-True ($runScript -match 'Invoke-LauncherCleanup') "run.ps1 应该把退出清理收口成统一入口，避免 finally / 退出事件各清各的。"
Assert-True ($runScript -match 'Resolve-RecognizedLauncherService') "run.ps1 应该把 launcher backend / tusd / tracker / seeder 的残留识别收口到统一 helper，避免 Ctrl+C 后只停到父进程却漏掉仍在监听的孤儿进程。"
Assert-True ($runScript -match 'Test-CommandLineFlagValue') "run.ps1 应该用统一 helper 识别带引号的 flag/value，避免 Windows 下 \"--port\" \"7072\" 这种真实命令行漏掉残留进程。"
Assert-True ($runScript -match 'Test-CommandLineFlagValue[\s\S]*--port') "run.ps1 的 tracker/seeder 端口识别应通过统一 helper 支持 --port / -p 这类带引号参数。"
Assert-True ($runScript -match 'Wait-ManagedProcessPortReady') "run.ps1 启动后应确认本轮 backend/tusd/tracker/seeder 进程真的占到了目标端口，不能把半死不活的本地堆栈当启动成功。"
Assert-True ($runScript -match 'Wait-ManagedProcessPortReady[\s\S]*TimeoutSeconds 180') "run.ps1 对 backend 首轮冷编译至少应留出 180 秒等待窗，不能再把正常编译误杀成启动失败。"
Assert-True ($runScript -match 'RequireNonLoopback') "run.ps1 至少应对 backend/tusd 校验非回环监听，避免本机能开、局域网设备却根本打不进来。"
Assert-True ($runScript -match 'ParentProcessId') "run.ps1 端口就绪校验不能只盯父进程；cargo/pnpm 真正占端口的是子进程树。"
Assert-True ($runScript -match '清理上一轮 launcher 残留服务') "run.ps1 启动前应直接按统一 launcher 服务补扫当前端口残留。"
Assert-True ($runScript -match 'Invoke-LauncherCleanup[\s\S]*Stop-RecognizedLauncherServices') "run.ps1 退出时在停止托管进程后还应按当前端口补扫一次已识别服务，避免 Ctrl+C 后继续留下占端口残留。"
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
Assert-True (-not ($cleanScript -match 'Cloudflare|cloudflare|cloudflared|trycloudflare')) "qingli.ps1 不得继续保留任何 cloudflared / Cloudflare Tunnel 相关临时目录或清理入口。"
Assert-True ($cleanScript -match 'MEDIA_TUS_UPLOAD_DIR') "qingli.ps1 应该跟随 tusd 主链清理 MEDIA_TUS_UPLOAD_DIR，而不是继续只盯着旧的 Rustus 目录。"
Assert-True ($cleanScript -match 'TUSD_PORT' -or $cleanScript -match 'MEDIA_TUS_SERVER_PORT') "qingli.ps1 应该优先读取当前 tusd 端口配置，而不是只看旧的 RUSTUS_SERVER_PORT。"
Assert-True ($cleanScript -match 'SWARM_SEEDER_PORT') "qingli.ps1 应该把 webtorrent-seeder 也纳入已识别服务停服范围。"
Assert-True ($cleanScript -match 'bittorrent-tracker') "qingli.ps1 应该识别当前 pnpm exec bittorrent-tracker 残留，而不是让旧 tracker 规则卡住下次启动。"
Assert-True (-not ($cleanScript -match 'dev-tracker\.mjs')) "qingli.ps1 不应继续按已退场的 dev-tracker.mjs 识别 tracker 残留。"
Assert-True ($cleanScript -match 'Test-CommandLineFlagValue') "qingli.ps1 应该用统一 helper 识别带引号的 flag/value，避免 Windows 下 \"--port\" \"7072\" 这种真实命令行漏掉自动停服。"
Assert-True ($cleanScript -match 'Test-CommandLineFlagValue[\s\S]*--port') "qingli.ps1 的 tracker/seeder 端口识别应通过统一 helper 支持 --port / -p 这类带引号参数。"
Assert-True ($cleanScript -match 'Get-NetTCPConnection') "qingli.ps1 的停服判断应该直接查看端口归属，而不是只做盲猜。"
Assert-True ($cleanScript -match 'taskkill\.exe /PID \$processId /T /F') "qingli.ps1 在 Force 模式下应该能强制结束已识别的项目开发进程。"
Assert-True ($cleanScript -match 'if \(\$Force\) \{[\s\S]*Stop-RecognizedProjectServices') "qingli.ps1 应该只在 Force 无人值守模式下自动停掉已识别项目服务。"
Assert-True (-not ($cleanStartupOptimizationSection -match 'target\\launcher-run')) "qingli.ps1 的自动优化清理不应删除 launcher-run；这是 run.ps1 的 Cargo 增量热缓存。"
Assert-True ($cleanScript -match 'target\\realtime-tests') "qingli.ps1 的自动优化清理应该纳入 realtime-tests 产物。"
Assert-True (-not ($cleanStartupOptimizationSection -match 'frontend\\dist')) "qingli.ps1 的自动优化清理不应删除 frontend/dist；前端 watch 启动会自行刷新构建产物。"
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
Assert-True ($runScript -match 'Ensure-FrontendDependenciesInstalled') "run.ps1 应该在启动前端 watcher 前检查并补齐缺失依赖，避免重清理后直接卡死在空 node_modules。"
Assert-True ($runScript -match '--dir",\s*"frontend",\s*"install",\s*"--frozen-lockfile"' -or $runScript -match '--dir frontend install --frozen-lockfile') "run.ps1 补齐前端依赖时必须使用 frozen lockfile，不能偷偷升级依赖。"
Assert-True ($runScript -match '\[switch\]\$ForceInitialFrontendBuild') "run.ps1 应提供显式完整首轮构建开关，默认开发启动不应强制全量前端门禁。"
Assert-True ($runScript -match 'if \(\$ForceInitialFrontendBuild\) \{[\s\S]*pnpm --dir frontend build') "run.ps1 只有在显式完整构建开关下才应执行 pnpm --dir frontend build。"
Assert-True ($runScript -match 'Ensure-FrontendDependenciesInstalled[\s\S]*dev:watch:supervised') "run.ps1 应先补齐前端依赖，再启动前端增量编译 watcher。"
Write-Host "启动器脚本检查通过。"

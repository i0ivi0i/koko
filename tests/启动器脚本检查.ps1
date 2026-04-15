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
$trackerScriptPath = Join-Path $repoRoot "frontend\\dev-tracker.mjs"

Assert-True (Test-Path -LiteralPath $runScriptPath) "缺少 run.ps1。"
Assert-True (Test-Path -LiteralPath $upScriptPath) "缺少 up.ps1；应该提供显式升级入口，而不是让 run.ps1 偷偷升级依赖。"

$runScript = Get-Content -LiteralPath $runScriptPath -Raw
$upScript = Get-Content -LiteralPath $upScriptPath -Raw
$trackerScript = if (Test-Path -LiteralPath $trackerScriptPath) {
    Get-Content -LiteralPath $trackerScriptPath -Raw
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

Assert-True ($runScriptParseErrors.Count -eq 0) "run.ps1 必须先通过 PowerShell 语法解析，不能连启动前都在脚本插值阶段炸掉。"

Assert-True ($runScript -match '\[switch\]\$UpgradeDependencies') "run.ps1 应该显式接受 UpgradeDependencies 开关。"
Assert-True ($runScript -match 'if \(\$UpgradeDependencies\)') "run.ps1 应该只在显式升级模式下刷新依赖。"
Assert-True ($runScript -match 'Stop-StaleLauncherBackend') "run.ps1 应该只清理自己 launcher-run 留下的开发态后端残进程，而不是发明项目级退出真相。"
Assert-True ($runScript -match 'launcher-run') "run.ps1 应该把开发启动器产物隔离在 launcher-run 目录下，避免跟源码主产物争抢。"
Assert-True ($runScript -match 'Get-Command rustus(?:\.exe)?') "run.ps1 应该显式检查 rustus 可执行文件是否存在。"
Assert-True ($runScript -match '--hooks-http-urls') "run.ps1 应该显式给 rustus 配置 http hooks。"
Assert-True ($runScript -match '--hooks-http-proxy-headers') "run.ps1 应该让 rustus 透传 Authorization 给 hook 接收方。"
Assert-True ($runScript -match '--hooks') "run.ps1 应该显式限制 rustus 只启用当前后端真正处理的 hooks。"
Assert-True ($runScript -match 'pre-create,post-finish') "run.ps1 应该只启用 pre-create 和 post-finish，避免 post-create 等默认 hooks 反向打坏上传创建。"
Assert-True ($runScript -match 'RUSTUS_MAX_BODY_SIZE') "run.ps1 应该允许显式覆写 rustus 的 body size 上限，避免默认 256KiB 把正常图片直接打成 413。"
Assert-True ($runScript -match '--max-body-size') "run.ps1 应该显式传入 rustus 的 max-body-size，不能让 sidecar 默认 body limit 反向打坏媒体上传。"
Assert-True (
    $runScript -match '200\s*\*\s*1024\s*\*\s*1024' -or
    $runScript -match '209715200'
) "run.ps1 默认的 rustus body size 至少应该覆盖当前群聊视频 200 MiB 的业务上限。"
Assert-True ($runScript -match 'RUSTUS_MAX_FILE_SIZE') "run.ps1 应该允许显式覆写 rustus 的整文件上限。"
Assert-True ($runScript -match '--max-file-size') "run.ps1 应该显式传入 rustus 的 max-file-size。"
Assert-True (
    $runScript -match '200\s*\*\s*1024\s*\*\s*1024' -or
    $runScript -match '209715200'
) "run.ps1 默认的 rustus 整文件上限应该覆盖当前群聊视频 200 MiB 的业务上限。"
Assert-True ($runScript -match 'RUSTUS_SERVER_HOST') "run.ps1 应该允许显式覆写 rustus 的监听 host，避免 LAN / 公网模拟设备只能打到本机回环地址。"
Assert-True ($runScript -match '"0\.0\.0\.0"') "run.ps1 默认的 rustus 监听 host 应该允许局域网设备访问，不能继续硬编码成本机回环。"
Assert-True ($runScript -match '--url') "run.ps1 应该显式固定 rustus 的 Tus base url。"
Assert-True ($runScript -match '--data-dir') "run.ps1 应该显式固定 rustus 的共享上传目录。"
Assert-True ($runScript -match '--info-dir') "run.ps1 应该显式固定 rustus 的上传 info 目录。"
Assert-True ($runScript -match '-Name "rustus"') "run.ps1 应该把 rustus 作为独立托管进程拉起。"
Assert-True ($runScript -match 'bittorrent-tracker') "run.ps1 应该启动 bittorrent-tracker 开发进程，避免 Phase 2 还要靠手工另开一个窗口。"
Assert-True ($runScript -match 'SWARM_TRACKER_PORT') "run.ps1 应该允许显式覆写 tracker 端口。"
Assert-True ($runScript -match 'SWARM_TRACKER_PUBLIC_URL') "run.ps1 应该允许显式覆写前端 announce 用的 tracker 公网地址。"
Assert-True ($runScript -match '-Name "tracker"') "run.ps1 应该把 tracker 当成独立受管进程拉起。"
Assert-True (Test-Path -LiteralPath $trackerScriptPath) "应该提供 frontend/dev-tracker.mjs，把官方 tracker server 子入口收口成可复用开发脚本。"
Assert-True ($trackerScript -match 'bittorrent-tracker/server') "frontend/dev-tracker.mjs 应该直接复用官方 bittorrent-tracker/server 子入口，而不是手搓 tracker。"
Assert-True (-not ($runScript -match 'cargo\s+install\s+rustus')) "run.ps1 不应该偷偷安装 rustus；缺失时应该直接失败。"
Assert-True (-not ($runScript -match 'GenerateConsoleCtrlEvent')) "run.ps1 不应该为了开发态收尾引入 Windows 控制台信号桥接这种过度设计。"
Assert-True (-not ($runScript -match 'CREATE_NEW_PROCESS_GROUP')) "run.ps1 不应该内建 Win32 进程组控制，避免开发脚本反客为主。"
Assert-True (-not ($runScript -match 'CancelKeyPress')) "run.ps1 不应该接管项目级退出语义；控制台中断细节不该让开发脚本越位。"
Assert-True ($runScript -match 'taskkill\.exe /PID \$process\.Id /T /F') "run.ps1 仍然应该保留强杀兜底，避免失控 watcher 留下孤儿进程。"
Assert-True ($upScript -match '-UpgradeDependencies') "up.ps1 应该把 UpgradeDependencies 开关传给 run.ps1。"
Assert-True ($upScript -match 'run\.ps1') "up.ps1 应该复用 run.ps1，而不是复制出第二套启动主链。"
Write-Host "启动器脚本检查通过。"

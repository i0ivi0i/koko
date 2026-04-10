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

Assert-True (Test-Path -LiteralPath $runScriptPath) "缺少 run.ps1。"
Assert-True (Test-Path -LiteralPath $upScriptPath) "缺少 up.ps1；应该提供显式升级入口，而不是让 run.ps1 偷偷升级依赖。"

$runScript = Get-Content -LiteralPath $runScriptPath -Raw
$upScript = Get-Content -LiteralPath $upScriptPath -Raw

Assert-True ($runScript -match '\[switch\]\$UpgradeDependencies') "run.ps1 应该显式接受 UpgradeDependencies 开关。"
Assert-True ($runScript -match 'if \(\$UpgradeDependencies\)') "run.ps1 应该只在显式升级模式下刷新依赖。"
Assert-True ($runScript -match 'Stop-StaleLauncherBackend') "run.ps1 应该只清理自己 launcher-run 留下的开发态后端残进程，而不是发明项目级退出真相。"
Assert-True ($runScript -match 'launcher-run') "run.ps1 应该把开发启动器产物隔离在 launcher-run 目录下，避免跟源码主产物争抢。"
Assert-True ($runScript -match 'Get-Command rustus(?:\.exe)?') "run.ps1 应该显式检查 rustus 可执行文件是否存在。"
Assert-True ($runScript -match '--hooks-http-urls') "run.ps1 应该显式给 rustus 配置 http hooks。"
Assert-True ($runScript -match '--hooks-http-proxy-headers') "run.ps1 应该让 rustus 透传 Authorization 给 hook 接收方。"
Assert-True ($runScript -match '--url') "run.ps1 应该显式固定 rustus 的 Tus base url。"
Assert-True ($runScript -match '--data-dir') "run.ps1 应该显式固定 rustus 的共享上传目录。"
Assert-True ($runScript -match '--info-dir') "run.ps1 应该显式固定 rustus 的上传 info 目录。"
Assert-True ($runScript -match '-Name "rustus"') "run.ps1 应该把 rustus 作为独立托管进程拉起。"
Assert-True (-not ($runScript -match 'cargo\s+install\s+rustus')) "run.ps1 不应该偷偷安装 rustus；缺失时应该直接失败。"
Assert-True (-not ($runScript -match 'GenerateConsoleCtrlEvent')) "run.ps1 不应该为了开发态收尾引入 Windows 控制台信号桥接这种过度设计。"
Assert-True (-not ($runScript -match 'CREATE_NEW_PROCESS_GROUP')) "run.ps1 不应该内建 Win32 进程组控制，避免开发脚本反客为主。"
Assert-True (-not ($runScript -match 'CancelKeyPress')) "run.ps1 不应该接管项目级退出语义；控制台中断细节不该让开发脚本越位。"
Assert-True ($runScript -match 'taskkill\.exe /PID \$process\.Id /T /F') "run.ps1 仍然应该保留强杀兜底，避免失控 watcher 留下孤儿进程。"
Assert-True ($upScript -match '-UpgradeDependencies') "up.ps1 应该把 UpgradeDependencies 开关传给 run.ps1。"
Assert-True ($upScript -match 'run\.ps1') "up.ps1 应该复用 run.ps1，而不是复制出第二套启动主链。"
Write-Host "启动器脚本检查通过。"

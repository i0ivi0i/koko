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
Assert-True ($upScript -match '-UpgradeDependencies') "up.ps1 应该把 UpgradeDependencies 开关传给 run.ps1。"
Assert-True ($upScript -match 'run\.ps1') "up.ps1 应该复用 run.ps1，而不是复制出第二套启动主链。"
Write-Host "启动器脚本检查通过。"

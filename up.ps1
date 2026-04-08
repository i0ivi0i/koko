param()

$ErrorActionPreference = "Stop"

# up.ps1 是“我要追最新依赖”的显式入口；
# 它复用 run.ps1 的稳定启动链，只是在进入前打开升级开关。
$runScriptPath = Join-Path $PSScriptRoot "run.ps1"
& $runScriptPath -UpgradeDependencies

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\\.."))
$scriptPath = Join-Path $repoRoot "https.ps1"

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "缺少被测脚本: $scriptPath"
}

. $scriptPath

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message`nExpected: $Expected`nActual:   $Actual"
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-False {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if ($Condition) {
        throw $Message
    }
}

# 用例1：能从 .env 文本中识别 APP_PORT。
$port = Resolve-AppPortFromEnvContent -EnvContent @"
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/koko_ddd_dev
APP_PORT=18080
RUST_LOG=info
"@
Assert-Equal -Actual $port -Expected 18080 -Message "应优先使用 .env 中的 APP_PORT。"

# 用例2：缺少 APP_PORT 时，回退到默认端口 8080。
$fallbackPort = Resolve-AppPortFromEnvContent -EnvContent @"
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/koko_ddd_dev
RUST_LOG=info
"@
Assert-Equal -Actual $fallbackPort -Expected 8080 -Message "缺少 APP_PORT 时应回退到默认端口。"

# 用例3：Caddyfile 必须包含 tls internal 和反代目标端口。
$caddyfile = Build-CaddyfileContent -AppPort 28080 -LanIPv4Addresses @("192.168.3.10")
Assert-True -Condition $caddyfile.Contains("tls internal") -Message "Caddyfile 应启用 tls internal。"
Assert-True -Condition $caddyfile.Contains("reverse_proxy 127.0.0.1:28080") -Message "Caddyfile 应反代到后端端口。"
Assert-True -Condition $caddyfile.Contains("https://192.168.3.10") -Message "Caddyfile 应包含局域网地址。"

# 用例4：开机自启命令必须使用 caddy start 并带 config。
$cmd = Build-CaddyAutoStartCommand -CaddyPath "C:\tools\caddy.exe" -CaddyfilePath "C:\tmp\Caddyfile"
Assert-True -Condition $cmd.Contains(" start ") -Message "开机自启命令应使用 caddy start。"
Assert-True -Condition $cmd.Contains("--config") -Message "开机自启命令应包含 --config。"
Assert-True -Condition $cmd.Contains("--adapter caddyfile") -Message "开机自启命令应包含 caddyfile adapter。"

# 用例5：HTTPS 运行时目录默认不应在仓库内。
$runtimeDir = Resolve-HttpsRuntimeDirectory
$normalizedRuntimeDir = $runtimeDir.TrimEnd('\').ToLowerInvariant()
$normalizedRepoRoot = $repoRoot.TrimEnd('\').ToLowerInvariant()
Assert-False -Condition $normalizedRuntimeDir.StartsWith($normalizedRepoRoot) -Message "运行时目录不应落在仓库里。"

Write-Host "https.ps1 测试通过"

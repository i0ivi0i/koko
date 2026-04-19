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

# 用例3：Quick Tunnel 参数应指向本机后端端口。
$args = Build-QuickTunnelArgumentList -AppPort 19090
Assert-Equal -Actual $args[0] -Expected "tunnel" -Message "cloudflared 命令应从 tunnel 子命令开始。"
Assert-Equal -Actual $args[1] -Expected "--url" -Message "cloudflared 参数应包含 --url。"
Assert-Equal -Actual $args[2] -Expected "http://127.0.0.1:19090" -Message "Quick Tunnel 应转发到本机后端端口。"
Assert-True -Condition ($args -contains "--loglevel") -Message "Quick Tunnel 参数应显式开启 loglevel。"

# 用例4：下载地址应为官方 release 通道。
$downloadUrl = Resolve-CloudflaredDownloadUrl
Assert-True -Condition $downloadUrl.StartsWith("https://github.com/cloudflare/cloudflared/releases/latest/download/") -Message "cloudflared 下载地址应来自官方 release。"

# 用例5：安装目录可被环境变量覆盖，且不必落在仓库。
$oldCloudflaredHome = $env:KOKO_CLOUDFLARED_HOME
try {
    $env:KOKO_CLOUDFLARED_HOME = "D:\temp\koko-cloudflared-home"
    $overrideDir = Resolve-CloudflaredInstallDirectory -RepoRoot $repoRoot
    Assert-Equal -Actual $overrideDir -Expected ([System.IO.Path]::GetFullPath("D:\temp\koko-cloudflared-home")) -Message "应优先使用 KOKO_CLOUDFLARED_HOME。"
}
finally {
    $env:KOKO_CLOUDFLARED_HOME = $oldCloudflaredHome
}

# 用例6：默认安装目录不应位于仓库内。
$defaultInstallDir = Resolve-CloudflaredInstallDirectory -RepoRoot $repoRoot
$normalizedInstallDir = $defaultInstallDir.TrimEnd('\').ToLowerInvariant()
$normalizedRepoRoot = $repoRoot.TrimEnd('\').ToLowerInvariant()
Assert-False -Condition $normalizedInstallDir.StartsWith($normalizedRepoRoot) -Message "默认 cloudflared 安装目录不应落在仓库里。"

# 用例7：能从 cloudflared 日志行里提取可访问 HTTPS 地址。
$url = TryExtract-TryCloudflareUrlFromLine -Line "INF | Visit it at https://bright-river-abc.trycloudflare.com"
Assert-Equal -Actual $url -Expected "https://bright-river-abc.trycloudflare.com" -Message "应能提取 trycloudflare HTTPS 地址。"

Write-Host "https.ps1 测试通过"

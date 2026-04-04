[CmdletBinding()]
param(
    [string]$DatabaseUrl,
    [string]$AdminToken,
    [string]$BindAddr,
    [switch]$SkipBundle,
    [switch]$DryRun,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
$xtaskArgs = @("xtask", "dev")

if ($PSBoundParameters.ContainsKey("DatabaseUrl")) {
    $xtaskArgs += @("--database-url", $DatabaseUrl)
}

if ($PSBoundParameters.ContainsKey("AdminToken")) {
    $xtaskArgs += @("--admin-token", $AdminToken)
}

if ($PSBoundParameters.ContainsKey("BindAddr")) {
    $xtaskArgs += @("--bind-addr", $BindAddr)
}

if ($SkipBundle.IsPresent) {
    $xtaskArgs += "--skip-bundle"
}

if ($DryRun.IsPresent) {
    $xtaskArgs += "--dry-run"
}

if ($NoBrowser.IsPresent) {
    $xtaskArgs += "--no-browser"
}

# PowerShell 这里只是 Windows 开发入口薄壳；开发编排真相统一交给 cargo xtask dev。
Push-Location $repoRoot
try {
    & cargo @xtaskArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

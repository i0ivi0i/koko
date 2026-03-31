[CmdletBinding()]
param(
    [switch]$SkipBundle,
    [switch]$SkipNextest,
    [switch]$SkipSqlx
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    Write-Host "==> cargo update"
    $global:LASTEXITCODE = 0
    cargo update
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: cargo update (exit code $LASTEXITCODE)"
    }

    $verifyArgs = @()
    if ($SkipBundle) {
        $verifyArgs += "-SkipBundle"
    }
    if ($SkipNextest) {
        $verifyArgs += "-SkipNextest"
    }
    if ($SkipSqlx) {
        $verifyArgs += "-SkipSqlx"
    }

    & (Join-Path $PSScriptRoot "verify-rust-workspace.ps1") @verifyArgs
}
finally {
    Pop-Location
}

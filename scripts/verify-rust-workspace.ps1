[CmdletBinding()]
param(
    [switch]$SkipBundle,
    [switch]$SkipNextest,
    [switch]$SkipSqlx
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Step {
    param(
        [string]$Label,
        [scriptblock]$Action
    )

    Write-Host "==> $Label"
    & $Action
}

Push-Location $repoRoot
try {
    Invoke-Step "cargo check" { cargo check }
    Invoke-Step "cargo check --target wasm32-unknown-unknown" {
        cargo check --target wasm32-unknown-unknown
    }

    if (-not $SkipNextest) {
        Invoke-Step "cargo nextest run" { cargo nextest run }
    }

    Invoke-Step "cargo test --doc" { cargo test --doc }

    if (-not $SkipSqlx) {
        Invoke-Step "cargo sqlx prepare --check" { cargo sqlx prepare --check }
    }

    Invoke-Step "cargo test" { cargo test }

    if (-not $SkipBundle) {
        Invoke-Step ".\scripts\dx-bundle-web.ps1" {
            & (Join-Path $PSScriptRoot "dx-bundle-web.ps1")
        }
    }
}
finally {
    Pop-Location
}

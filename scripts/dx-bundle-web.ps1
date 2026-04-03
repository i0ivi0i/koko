[CmdletBinding()]
param(
    [switch]$Release,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraDxArgs
)

$ErrorActionPreference = "Stop"

$nightlyToolchain = "nightly-x86_64-pc-windows-msvc"
$requiredTarget = "wasm32-unknown-unknown"

function Test-ListContains {
    param(
        [string[]]$Items,
        [string]$Needle
    )

    return [bool]($Items | Select-String -SimpleMatch $Needle)
}

function Get-LockfilePackageVersion {
    param(
        [string]$PackageName
    )

    $repoRoot = Split-Path -Parent $PSScriptRoot
    $lockfilePath = Join-Path $repoRoot "Cargo.lock"
    $lockfile = Get-Content $lockfilePath -Raw
    $pattern = '(?ms)^\[\[package\]\]\r?\nname = "' + [regex]::Escape($PackageName) + '"\r?\nversion = "([^"]+)"'
    $match = [regex]::Match($lockfile, $pattern)
    if (-not $match.Success) {
        throw "Unable to resolve $PackageName version from Cargo.lock"
    }

    return $match.Groups[1].Value
}

$requiredDxVersion = Get-LockfilePackageVersion -PackageName "dioxus"

$dxVersionLine = (& dx --version).Trim()
if ($dxVersionLine -notlike "dioxus $requiredDxVersion*") {
    throw "Expected dx $requiredDxVersion, got: $dxVersionLine"
}

$installedToolchains = @(rustup toolchain list)
if (-not (Test-ListContains -Items $installedToolchains -Needle $nightlyToolchain)) {
    throw "Missing $nightlyToolchain. Run: rustup toolchain install nightly --component rust-src"
}

$installedComponents = @(rustup component list --installed --toolchain $nightlyToolchain)
if (-not (Test-ListContains -Items $installedComponents -Needle "rust-src")) {
    throw "Missing rust-src for $nightlyToolchain. Run: rustup component add rust-src --toolchain $nightlyToolchain"
}

$installedTargets = @(rustup target list --installed --toolchain $nightlyToolchain)
if (-not (Test-ListContains -Items $installedTargets -Needle $requiredTarget)) {
    throw "Missing $requiredTarget for $nightlyToolchain. Run: rustup target add wasm32-unknown-unknown --toolchain $nightlyToolchain"
}

$previousToolchain = $env:RUSTUP_TOOLCHAIN
$previousRustFlags = $env:RUSTFLAGS

try {
    # Rust 1.82+ / LLVM 19+ enables new wasm defaults. Current dx + wasm-bindgen
    # chain needs the official Rust build-std workaround for reproducible bundling.
    $env:RUSTUP_TOOLCHAIN = $nightlyToolchain
    $env:RUSTFLAGS = "-Ctarget-cpu=mvp"

    $dxArgs = @(
        "bundle",
        "--platform",
        "web",
        "--cargo-args=-Zbuild-std=panic_abort,std"
    )

    if ($Release) {
        $dxArgs += "--release"
    }

    if ($ExtraDxArgs) {
        $dxArgs += $ExtraDxArgs
    }

    & dx @dxArgs
    $dxExitCode = $LASTEXITCODE
    if ($dxExitCode -ne 0) {
        exit $dxExitCode
    }

    # Dioxus 会把自定义 script 路径写进 index.html，但这里的 Socket.IO 运行时必须
    # 以浏览器经典脚本的真实产物存在于 dist/public/assets，不能继续吃到旧的 ESM 残留文件。
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $socketIoSource = Join-Path $repoRoot "public\assets\socket.io.min.js"
    $bundledAssetDir = Join-Path $repoRoot "dist\public\assets"
    $socketIoDestination = Join-Path $bundledAssetDir "socket.io.min.js"

    New-Item -ItemType Directory -Path $bundledAssetDir -Force | Out-Null
    Copy-Item -LiteralPath $socketIoSource -Destination $socketIoDestination -Force

    exit 0
}
finally {
    if ($null -eq $previousToolchain) {
        Remove-Item Env:\RUSTUP_TOOLCHAIN -ErrorAction SilentlyContinue
    }
    else {
        $env:RUSTUP_TOOLCHAIN = $previousToolchain
    }

    if ($null -eq $previousRustFlags) {
        Remove-Item Env:\RUSTFLAGS -ErrorAction SilentlyContinue
    }
    else {
        $env:RUSTFLAGS = $previousRustFlags
    }
}

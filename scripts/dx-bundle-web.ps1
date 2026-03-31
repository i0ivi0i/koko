[CmdletBinding()]
param(
    [switch]$Release,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraDxArgs
)

$ErrorActionPreference = "Stop"

$nightlyToolchain = "nightly-x86_64-pc-windows-msvc"
$requiredTarget = "wasm32-unknown-unknown"
$requiredDxVersion = "0.7.4"

function Test-ListContains {
    param(
        [string[]]$Items,
        [string]$Needle
    )

    return [bool]($Items | Select-String -SimpleMatch $Needle)
}

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
    exit $LASTEXITCODE
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

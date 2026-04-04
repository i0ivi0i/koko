$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
$xtaskArgs = @("xtask", "dev") + $args

# PowerShell 这里只是 Windows 开发入口薄壳；开发编排真相统一交给 cargo xtask dev。
Push-Location $repoRoot
try {
    & cargo @xtaskArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

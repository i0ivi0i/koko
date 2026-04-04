Set-Location $PSScriptRoot
& cargo xtask dev @args
exit $LASTEXITCODE

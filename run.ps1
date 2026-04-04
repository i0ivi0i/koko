$ErrorActionPreference = "Stop"

function Import-DotEnv {
    param([string]$Path = ".env")

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            return
        }
        $pair = $line.Split("=", 2)
        if ($pair.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim())
        }
    }
}

Import-DotEnv

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoPath = (Get-Command cargo.exe -ErrorAction Stop).Source
$pnpmPath = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$frontendWatch = $null
$frontendTypeWatch = $null

try {
    # run.ps1 只做编排：先构建前端产物，再开 watch，最后拉起后端。
    Write-Host "前端首轮构建: pnpm --dir frontend build"
    & $pnpmPath --dir frontend build

    Write-Host "前端增量编译: pnpm --dir frontend run dev:watch"
    $frontendWatch = Start-Process -FilePath $pnpmPath `
        -ArgumentList @("--dir", "frontend", "run", "dev:watch") `
        -WorkingDirectory $repoRoot `
        -PassThru

    Write-Host "前端类型守卫: pnpm --dir frontend run typecheck:watch"
    $frontendTypeWatch = Start-Process -FilePath $pnpmPath `
        -ArgumentList @("--dir", "frontend", "run", "typecheck:watch") `
        -WorkingDirectory $repoRoot `
        -PassThru

    Write-Host "启动后端: cargo run"
    $appPort = [Environment]::GetEnvironmentVariable("APP_PORT")
    if ([string]::IsNullOrWhiteSpace($appPort)) {
        $appPort = "8080"
    }
    Write-Host "访问入口: http://127.0.0.1:$appPort/"
    & $cargoPath run
}
finally {
    if ($frontendTypeWatch -and -not $frontendTypeWatch.HasExited) {
        Stop-Process -Id $frontendTypeWatch.Id -Force
    }
    if ($frontendWatch -and -not $frontendWatch.HasExited) {
        Stop-Process -Id $frontendWatch.Id -Force
    }
}

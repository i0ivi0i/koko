param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Import-EnvFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
        if ([string]::IsNullOrWhiteSpace($_) -or $_.TrimStart().StartsWith("#")) {
            return
        }

        $parts = $_ -split "=", 2
        if ($parts.Count -ne 2) {
            return
        }

        [System.Environment]::SetEnvironmentVariable($parts[0], $parts[1])
        Set-Item -Path "Env:$($parts[0])" -Value $parts[1]
    }
}

function Ensure-Command {
    param(
        [string]$Name,
        [string]$InstallCommand
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return
    }

    if ($DryRun) {
        Write-Host "[dry-run] 缺少 $Name，将执行: $InstallCommand"
        return
    }

    Write-Host "安装 $Name ..."
    Invoke-Expression $InstallCommand
}

function Invoke-Step {
    param([string]$Command)

    if ($DryRun) {
        Write-Host "[dry-run] $Command"
        return
    }

    Invoke-Expression $Command
}

Import-EnvFile "$Root\.env"
Import-EnvFile "$Root\.env.local"

if (-not $env:DATABASE_URL) {
    throw "当前环境为 local，未找到 DATABASE_URL。请在项目根目录创建 .env.local，或参考 .env.example 补齐配置。"
}

Ensure-Command "sqlx" "cargo install sqlx-cli --no-default-features --features native-tls,postgres"
Ensure-Command "cargo-watch" "cargo install cargo-watch"
Ensure-Command "dx" "cargo install dioxus-cli"

Invoke-Step "sqlx database create"
Invoke-Step "sqlx migrate run"

if (-not $env:KOKO_API_BASE) {
    $env:KOKO_API_BASE = "http://127.0.0.1:3000"
}

$backendCommand = @"
Set-Location '$Root'
`$env:DATABASE_URL = '$($env:DATABASE_URL)'
cargo watch -x ""run -p koko-server""
"@

$frontendCommand = @"
Set-Location '$Root\web'
`$env:KOKO_API_BASE = '$($env:KOKO_API_BASE)'
dx serve --platform web --port 8080 --addr 127.0.0.1
"@

if ($DryRun) {
    Write-Host "[dry-run] 后端命令："
    Write-Host $backendCommand
    Write-Host "[dry-run] 前端命令："
    Write-Host $frontendCommand
    exit 0
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand | Out-Null
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand | Out-Null

Write-Host "已启动后端热更新和前端开发服务器。"

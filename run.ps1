param(
    [switch]$DryRun,
    [switch]$Init,
    [switch]$Migrate
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogRoot = Join-Path $Root "target\dev-logs"
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

function Require-Command {
    param(
        [string]$Name,
        [string]$Hint
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "缺少 $Name。$Hint"
    }
}

function Invoke-Step {
    param([string]$Command)

    if ($DryRun) {
        Write-Host "[dry-run] $Command"
        return
    }

    Invoke-Expression $Command
}

function Initialize-Database {
    Invoke-Step "sqlx database create"
    Invoke-Step "sqlx migrate run"
}

function Reset-LogFile {
    param([string]$Path)

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    Set-Content -Path $Path -Value $null
}

function Write-NewLogLines {
    param(
        [string]$Path,
        [string]$Tag,
        [string]$Color,
        [ref]$LineCount
    )

    if (-not (Test-Path $Path)) {
        return
    }

    $lines = Get-Content $Path
    if ($null -eq $lines) {
        return
    }

    $start = [Math]::Min($LineCount.Value, $lines.Count)
    for ($index = $start; $index -lt $lines.Count; $index++) {
        $line = $lines[$index]
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        Write-Host "[$Tag] $line" -ForegroundColor $Color
    }

    $LineCount.Value = $lines.Count
}

if ($Init -and $Migrate) {
    throw "不能同时使用 -Init 和 -Migrate。"
}

Import-EnvFile "$Root\.env.local"

if (-not $env:DATABASE_URL) {
    throw "当前环境为 local，未找到 DATABASE_URL。请在项目根目录创建 .env.local 并补齐配置。"
}

if (-not $env:KOKO_API_BASE) {
    $env:KOKO_API_BASE = "http://127.0.0.1:3000"
}

if ($Init) {
    Ensure-Command "sqlx" "cargo install sqlx-cli --no-default-features --features native-tls,postgres"
    Ensure-Command "cargo-watch" "cargo install cargo-watch"
    Ensure-Command "dx" "cargo install dioxus-cli"
    Initialize-Database
    Write-Host "初始化完成。" -ForegroundColor Green
    exit 0
}

if ($Migrate) {
    Require-Command "sqlx" "请先执行 .\run.ps1 -Init"
    Initialize-Database
    Write-Host "迁移完成。" -ForegroundColor Green
    exit 0
}

Require-Command "cargo-watch" "请先执行 .\run.ps1 -Init"
Require-Command "dx" "请先执行 .\run.ps1 -Init"

$backendStdout = Join-Path $LogRoot "server.out.log"
$backendStderr = Join-Path $LogRoot "server.err.log"
$frontendStdout = Join-Path $LogRoot "web.out.log"
$frontendStderr = Join-Path $LogRoot "web.err.log"

Reset-LogFile $backendStdout
Reset-LogFile $backendStderr
Reset-LogFile $frontendStdout
Reset-LogFile $frontendStderr

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
    Write-Host "[dry-run] 启动模式：dev"
    Write-Host "[dry-run] 日志目录：$LogRoot"
    Write-Host "[dry-run] 后端命令："
    Write-Host $backendCommand
    Write-Host "[dry-run] 前端命令："
    Write-Host $frontendCommand
    exit 0
}

$backendProcess = Start-Process powershell `
    -ArgumentList "-NoLogo", "-Command", $backendCommand `
    -PassThru `
    -RedirectStandardOutput $backendStdout `
    -RedirectStandardError $backendStderr

$frontendProcess = Start-Process powershell `
    -ArgumentList "-NoLogo", "-Command", $frontendCommand `
    -PassThru `
    -RedirectStandardOutput $frontendStdout `
    -RedirectStandardError $frontendStderr

$backendOutLines = 0
$backendErrLines = 0
$frontendOutLines = 0
$frontendErrLines = 0

Write-Host "开发服务已启动。按 Ctrl+C 停止。" -ForegroundColor Cyan
Write-Host "后端: http://127.0.0.1:3000" -ForegroundColor DarkCyan
Write-Host "前端: http://127.0.0.1:8080" -ForegroundColor DarkCyan
Write-Host "日志: $LogRoot" -ForegroundColor DarkCyan

try {
    while ($true) {
        Write-NewLogLines -Path $backendStdout -Tag "server" -Color "Green" -LineCount ([ref]$backendOutLines)
        Write-NewLogLines -Path $backendStderr -Tag "server:err" -Color "Red" -LineCount ([ref]$backendErrLines)
        Write-NewLogLines -Path $frontendStdout -Tag "web" -Color "Cyan" -LineCount ([ref]$frontendOutLines)
        Write-NewLogLines -Path $frontendStderr -Tag "web:err" -Color "Magenta" -LineCount ([ref]$frontendErrLines)

        if ($backendProcess.HasExited -or $frontendProcess.HasExited) {
            break
        }

        Start-Sleep -Milliseconds 500
    }
}
finally {
    Write-NewLogLines -Path $backendStdout -Tag "server" -Color "Green" -LineCount ([ref]$backendOutLines)
    Write-NewLogLines -Path $backendStderr -Tag "server:err" -Color "Red" -LineCount ([ref]$backendErrLines)
    Write-NewLogLines -Path $frontendStdout -Tag "web" -Color "Cyan" -LineCount ([ref]$frontendOutLines)
    Write-NewLogLines -Path $frontendStderr -Tag "web:err" -Color "Magenta" -LineCount ([ref]$frontendErrLines)

    foreach ($process in @($backendProcess, $frontendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
    }
}

if ($backendProcess.HasExited) {
    Write-Host "后端进程已退出，退出码: $($backendProcess.ExitCode)" -ForegroundColor Yellow
}

if ($frontendProcess.HasExited) {
    Write-Host "前端进程已退出，退出码: $($frontendProcess.ExitCode)" -ForegroundColor Yellow
}

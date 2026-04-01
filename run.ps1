[CmdletBinding()]
param(
    [string]$DatabaseUrl = "postgres://postgres:postgres@127.0.0.1:5432/koko_dev_chat",
    [string]$AdminToken = "local-admin-token",
    [string]$BindAddr = "127.0.0.1:4000",
    [switch]$SkipBundle,
    [switch]$DryRun,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$serverProcess = $null

$repoRoot = $PSScriptRoot
$bundleScript = Join-Path $repoRoot "scripts\dx-bundle-web.ps1"
$migrationsDir = Join-Path $repoRoot "migrations"

function Invoke-Step {
    param(
        [string]$Label,
        [scriptblock]$Action
    )

    Write-Host "==> $Label"
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: $Label (exit code $LASTEXITCODE)"
    }
}

function Get-DatabaseConfig {
    param(
        [string]$Url
    )

    $uri = [Uri]$Url
    $databaseName = $uri.AbsolutePath.Trim("/")
    if ([string]::IsNullOrWhiteSpace($databaseName)) {
        throw "DatabaseUrl must include a database name. Got: $Url"
    }

    $adminBuilder = [UriBuilder]$Url
    $adminBuilder.Path = "/postgres"

    [pscustomobject]@{
        DatabaseName = $databaseName
        AdminUrl = $adminBuilder.Uri.AbsoluteUri
    }
}

function Ensure-Command {
    param(
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function Ensure-Database {
    param(
        [string]$Url,
        [string]$MigrationsPath
    )

    $config = Get-DatabaseConfig -Url $Url
    $databaseNameLiteral = $config.DatabaseName.Replace("'", "''")
    $databaseNameIdentifier = $config.DatabaseName.Replace("""", """""")
    $databaseExists = (& psql $config.AdminUrl -tAc "SELECT 1 FROM pg_database WHERE datname = '$databaseNameLiteral'").Trim()

    if ($databaseExists -ne "1") {
        Invoke-Step "Create database $($config.DatabaseName)" {
            & psql $config.AdminUrl -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE ""$databaseNameIdentifier""" | Out-Null
        }
    }

    $migrations = Get-ChildItem $MigrationsPath -Filter "*.sql" | Sort-Object Name
    if ($migrations.Count -eq 0) {
        throw "No SQL migrations found in $MigrationsPath"
    }

    Invoke-Step "准备数据库结构" {
        foreach ($migration in $migrations) {
            & psql $Url -v ON_ERROR_STOP=1 -q -f $migration.FullName | Out-Null
        }
    }
}

function Resolve-AppUrl {
    param(
        [string]$Address
    )

    $port = $Address.Substring($Address.LastIndexOf(":") + 1)
    $hostName = $Address.Substring(0, $Address.Length - $port.Length - 1).Trim()
    if ([string]::IsNullOrWhiteSpace($hostName) -or $hostName -eq "0.0.0.0") {
        $hostName = "127.0.0.1"
    }

    if ($hostName.Contains(":") -and -not $hostName.StartsWith("[")) {
        return "http://[$hostName]:$port/"
    }

    return "http://$hostName`:$port/"
}

function Wait-ForServerReady {
    param(
        [string]$Url,
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            return $false
        }

        try {
            $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
            continue
        }

        Start-Sleep -Milliseconds 500
    }

    return $false
}

function Read-LogTail {
    param(
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return ""
    }

    return (Get-Content $Path -Tail 40) -join [Environment]::NewLine
}

Push-Location $repoRoot
try {
    $appUrl = Resolve-AppUrl -Address $BindAddr

    if ($DryRun) {
        if ($SkipBundle) {
            Write-Host "==> Skip web bundle"
        }
        else {
            Write-Host "==> powershell -ExecutionPolicy Bypass -File $bundleScript"
        }

        $config = Get-DatabaseConfig -Url $DatabaseUrl
        Write-Host "==> Ensure database $($config.DatabaseName)"
        Write-Host "==> 准备数据库结构: $migrationsDir"
        Write-Host "==> Set KOKO_DATABASE_URL"
        Write-Host "==> Set KOKO_ADMIN_TOKEN"
        Write-Host "==> Set KOKO_BIND_ADDR"
        Write-Host "==> cargo run"
        if ($NoBrowser) {
            Write-Host "==> 浏览器不会自动打开"
        }
        else {
            Write-Host "==> 浏览器会自动打开: $appUrl"
        }
        Write-Host "==> 启动成功后可直接开始测试，按 Ctrl+C 可停止服务"
        exit 0
    }

    Ensure-Command -Name "cargo"
    Ensure-Command -Name "psql"

    if (-not $SkipBundle) {
        Invoke-Step ".\scripts\dx-bundle-web.ps1" {
            & $bundleScript
        }
    }

    Ensure-Database -Url $DatabaseUrl -MigrationsPath $migrationsDir

    $env:KOKO_DATABASE_URL = $DatabaseUrl
    $env:KOKO_ADMIN_TOKEN = $AdminToken
    $env:KOKO_BIND_ADDR = $BindAddr

    $logDir = Join-Path $env:TEMP "koko-run"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $stdoutLog = Join-Path $logDir "server.out.log"
    $stderrLog = Join-Path $logDir "server.err.log"
    Remove-Item $stdoutLog, $stderrLog -ErrorAction SilentlyContinue

    Write-Host "==> 正在启动 Koko 服务..."
    $serverProcess = Start-Process cargo `
        -ArgumentList "run" `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

    if (-not (Wait-ForServerReady -Url $appUrl -Process $serverProcess)) {
        $stderrTail = Read-LogTail -Path $stderrLog
        $stdoutTail = Read-LogTail -Path $stdoutLog
        if (-not [string]::IsNullOrWhiteSpace($stderrTail)) {
            Write-Host $stderrTail
        }
        elseif (-not [string]::IsNullOrWhiteSpace($stdoutTail)) {
            Write-Host $stdoutTail
        }
        throw "Koko 没能成功启动。请先看上面的最后日志，再检查数据库连接和端口占用。"
    }

    if (-not $NoBrowser) {
        Start-Process $appUrl | Out-Null
        Write-Host "==> 已启动，浏览器已打开: $appUrl"
    }
    else {
        Write-Host "==> 已启动，请打开: $appUrl"
    }

    Write-Host "==> 现在可以直接开始真人测试，按 Ctrl+C 可停止服务"
    Wait-Process -Id $serverProcess.Id
}
finally {
    if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
    Pop-Location
}

[CmdletBinding()]
param(
    [string]$DatabaseUrl = "postgres://postgres:postgres@127.0.0.1:5432/koko_dev_chat",
    [string]$AdminToken,
    [string]$BindAddr = "0.0.0.0:8080",
    [switch]$SkipBundle,
    [switch]$DryRun,
    [switch]$NoBrowser,
    # 仅供测试夹具替换子进程入口使用，不是第二套启动协议。
    [string]$TestChildScript
)

$ErrorActionPreference = "Stop"
$serverProcess = $null

$repoRoot = $PSScriptRoot
$cargoManifestPath = Join-Path $repoRoot "Cargo.toml"
$bundleScript = Join-Path $repoRoot "scripts\dx-bundle-web.ps1"
$migrationsDir = Join-Path $repoRoot "migrations"
$runTargetDir = "target/run"

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

function Get-BinaryPath {
    param(
        [string]$ManifestPath,
        [string]$TargetDir
    )

    $manifest = Get-Content $ManifestPath -Raw
    $match = [regex]::Match($manifest, '(?m)^\[package\]\s*(?:\r?\n(?!\[).*)*?\r?\nname = "([^"]+)"')
    if (-not $match.Success) {
        throw "Unable to resolve package name from $ManifestPath"
    }

    $packageName = $match.Groups[1].Value
    return Join-Path $repoRoot "$TargetDir\debug\$packageName.exe"
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

# 脚本入口：这里只负责准备运行环境，启动语义真相应由 Rust 子进程输出。
Push-Location $repoRoot
try {
    if ($DryRun) {
        # -DryRun：只预演准备动作，不再伪造首页地址、管理入口或管理员口令。
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
        if ($PSBoundParameters.ContainsKey("AdminToken")) {
            Write-Host "==> Set KOKO_ADMIN_TOKEN"
        }
        Write-Host "==> Set KOKO_BIND_ADDR"
        Write-Host "==> cargo build --target-dir $runTargetDir"
        exit 0
    }

    # stdout/stderr 处理：只消费 Rust 子进程的输出，不再重播任何部署提示。
    if ($TestChildScript) {
        & $TestChildScript
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }

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
    if ($PSBoundParameters.ContainsKey("AdminToken")) {
        $env:KOKO_ADMIN_TOKEN = $AdminToken
    }
    else {
        Remove-Item Env:KOKO_ADMIN_TOKEN -ErrorAction SilentlyContinue
    }
    $env:KOKO_BIND_ADDR = $BindAddr
    $serverBinaryPath = Get-BinaryPath -ManifestPath $cargoManifestPath -TargetDir $runTargetDir

    Invoke-Step "cargo build --target-dir $runTargetDir" {
        & cargo build --target-dir $runTargetDir
    }

    if (-not (Test-Path $serverBinaryPath)) {
        throw "Koko 构建已完成，但找不到可执行文件：$serverBinaryPath"
    }

    $port = $BindAddr.Substring($BindAddr.LastIndexOf(":") + 1)
    $hostName = $BindAddr.Substring(0, $BindAddr.Length - $port.Length - 1).Trim()
    if ([string]::IsNullOrWhiteSpace($hostName) -or $hostName -eq "0.0.0.0") {
        $hostName = "127.0.0.1"
    }

    if ($hostName.Contains(":") -and -not $hostName.StartsWith("[")) {
        $appUrl = "http://[$hostName]:$port/"
    }
    else {
        $appUrl = "http://$hostName`:$port/"
    }

    $serverProcess = Start-Process $serverBinaryPath `
        -WorkingDirectory $repoRoot `
        -NoNewWindow `
        -PassThru

    if (-not (Wait-ForServerReady -Url $appUrl -Process $serverProcess)) {
        throw "Koko 没能成功启动。请先检查 Rust 子进程的输出，再确认数据库连接和端口占用。"
    }

    # auto-open：仅在需要时打开浏览器，不再输出部署提示。
    if (-not $NoBrowser) {
        Start-Process $appUrl | Out-Null
    }

    Wait-Process -Id $serverProcess.Id
}
finally {
    if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
    Pop-Location
}

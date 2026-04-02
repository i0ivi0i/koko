[CmdletBinding()]
param(
    [string]$DatabaseUrl = "postgres://postgres:postgres@127.0.0.1:5432/koko_dev_chat",
    [string]$AdminToken,
    [string]$BindAddr = "0.0.0.0:8080",
    [switch]$SkipBundle,
    [switch]$DryRun,
    [object]$NoBrowser = $false,
    # 仅供测试夹具替换子进程入口使用，不是第二套启动协议。
    [string]$TestChildScript,
    # 仅供测试切换 stdout 采集方式，正常启动链仍以 Rust 输出为准。
    [ValidateSet("Replay", "Tee")]
    [string]$TestChildMode = "Replay",
    # 仅供测试记录浏览器打开请求，避免真的拉起系统浏览器。
    [string]$TestBrowserLogPath
)

$ErrorActionPreference = "Stop"
$serverProcess = $null
$scriptExitCode = $null

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
            & psql $config.AdminUrl -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE ""$databaseNameIdentifier""" > $null
        }
    }

    $migrations = Get-ChildItem $MigrationsPath -Filter "*.sql" | Sort-Object Name
    if ($migrations.Count -eq 0) {
        throw "No SQL migrations found in $MigrationsPath"
    }

    Invoke-Step "准备数据库结构" {
        foreach ($migration in $migrations) {
            & psql $Url -v ON_ERROR_STOP=1 -q -f $migration.FullName > $null
            if ($LASTEXITCODE -ne 0) {
                throw "Migration failed: $($migration.Name) (exit code $LASTEXITCODE)"
            }
        }
    }
}

function New-ChildProcessSpec {
    param(
        [string]$ServerBinaryPath,
        [string]$TestChildScript,
        [string]$TestChildMode
    )

    $logDir = Join-Path $env:TEMP "koko-run"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $runId = [guid]::NewGuid().ToString("N")
    $powershellExe = Join-Path $PSHOME "powershell.exe"

    if ($TestChildScript) {
        $stdoutLog = Join-Path $logDir "server-$runId.out.log"
        $stderrLog = Join-Path $logDir "server-$runId.err.log"
        Remove-Item $stdoutLog, $stderrLog -ErrorAction SilentlyContinue

        if ($TestChildMode -eq "Tee") {
            $command = '& "{0}" -ExecutionPolicy Bypass -File "{1}" *>&1 | Tee-Object -FilePath "{2}"; exit $LASTEXITCODE' -f $powershellExe, $TestChildScript, $stdoutLog
            return [pscustomobject]@{
                FilePath = $powershellExe
                ArgumentList = @(
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    $command
                )
                StdoutLog = $stdoutLog
                StderrLog = $null
                ReplayOutput = $false
            }
        }

        return [pscustomobject]@{
            FilePath = $powershellExe
            ArgumentList = @(
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                $TestChildScript
            )
            StdoutLog = $stdoutLog
            StderrLog = $stderrLog
            ReplayOutput = $true
        }
    }

    $stdoutLog = Join-Path $logDir "server-$runId.out.log"
    Remove-Item $stdoutLog -ErrorAction SilentlyContinue

    # 正常启动分支只负责把 Rust stdout 落盘，供 auto-open best-effort 消费。
    $command = '& "{0}" *>&1 | Tee-Object -FilePath "{1}"; exit $LASTEXITCODE' -f $ServerBinaryPath, $stdoutLog

    return [pscustomobject]@{
        FilePath = $powershellExe
        ArgumentList = @(
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            $command
        )
        StdoutLog = $stdoutLog
        StderrLog = $null
        ReplayOutput = $false
    }
}

function Write-ChildProcessOutput {
    param(
        [string]$StdoutLog,
        [string]$StderrLog
    )

    foreach ($path in @($StdoutLog, $StderrLog)) {
        if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path $path)) {
            continue
        }

        $lines = Get-Content $path
        foreach ($line in $lines) {
            Write-Host $line
        }
    }
}

function Test-TruthyValue {
    param(
        [object]$Value
    )

    if ($Value -is [bool]) {
        return [bool]$Value
    }

    if ($null -eq $Value) {
        return $false
    }

    $normalized = $Value.ToString().Trim().ToLowerInvariant()
    return $normalized -in @("true", "1", "yes", "on")
}

function Get-StartupHomepageUrlFromLines {
    param(
        [string[]]$Lines
    )

    $prefix = "==> 首页地址: "
    foreach ($line in $Lines) {
        if ($line.StartsWith($prefix)) {
            return $line.Substring($prefix.Length).Trim()
        }
    }

    return $null
}

function Wait-ForStartupHomepageUrl {
    param(
        [string]$StdoutLog,
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 5
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $StdoutLog) {
            $homepageUrl = Get-StartupHomepageUrlFromLines -Lines (Get-Content $StdoutLog)
            if (-not [string]::IsNullOrWhiteSpace($homepageUrl)) {
                return $homepageUrl
            }
        }

        if ($Process.HasExited) {
            break
        }

        Start-Sleep -Milliseconds 200
    }

    if (Test-Path $StdoutLog) {
        return Get-StartupHomepageUrlFromLines -Lines (Get-Content $StdoutLog)
    }

    return $null
}

function Open-StartupHomepage {
    param(
        [string]$Url,
        [string]$TestBrowserLogPath
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($TestBrowserLogPath)) {
        Set-Content -Path $TestBrowserLogPath -Value $Url -Encoding Ascii
        return
    }

    Start-Process $Url | Out-Null
}

function Start-ChildProcess {
    param(
        [pscustomobject]$Spec,
        [hashtable]$StartProcessArgs
    )

    if ($Spec.ReplayOutput) {
        return Start-Process $Spec.FilePath @StartProcessArgs -Wait
    }

    return Start-Process $Spec.FilePath @StartProcessArgs
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

    $childProcessSpec = New-ChildProcessSpec `
        -ServerBinaryPath $serverBinaryPath `
        -TestChildScript $TestChildScript `
        -TestChildMode $TestChildMode

    $startProcessArgs = @{
        WorkingDirectory = $repoRoot
        NoNewWindow = $true
        PassThru = $true
    }
    if ($childProcessSpec.ArgumentList.Count -gt 0) {
        $startProcessArgs.ArgumentList = $childProcessSpec.ArgumentList
    }
    if ($childProcessSpec.ReplayOutput) {
        $startProcessArgs.RedirectStandardOutput = $childProcessSpec.StdoutLog
        $startProcessArgs.RedirectStandardError = $childProcessSpec.StderrLog
    }

    $serverProcess = Start-ChildProcess -Spec $childProcessSpec -StartProcessArgs $startProcessArgs
    $allowBrowser = -not (Test-TruthyValue -Value $NoBrowser)

    if ($childProcessSpec.ReplayOutput) {
        Write-ChildProcessOutput -StdoutLog $childProcessSpec.StdoutLog -StderrLog $childProcessSpec.StderrLog
        if ($serverProcess.ExitCode -eq 0) {
            [void](Get-StartupHomepageUrlFromLines -Lines (Get-Content $childProcessSpec.StdoutLog))
        }
        exit [int]$serverProcess.ExitCode
    }
    else {
        # auto-open 只是消费 Rust 已经打印出来的首页地址；解析不到就直接跳过，不能反客为主定义 ready。
        if ($allowBrowser) {
            $startupHomepageUrl = Wait-ForStartupHomepageUrl -StdoutLog $childProcessSpec.StdoutLog -Process $serverProcess
            Open-StartupHomepage -Url $startupHomepageUrl -TestBrowserLogPath $TestBrowserLogPath
        }

        if (-not $serverProcess.HasExited) {
            Wait-Process -Id $serverProcess.Id
        }
    }
}
finally {
    if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
    Pop-Location
}

if ($null -ne $scriptExitCode) {
    exit $scriptExitCode
}

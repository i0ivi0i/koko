param(
    [int]$Port = 0,
    [switch]$SkipAppBootstrap,
    [switch]$LauncherMode,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-AppPortFromEnvContent {
    param(
        [string]$EnvContent,
        [int]$DefaultPort = 8080
    )

    if ([string]::IsNullOrWhiteSpace($EnvContent)) {
        return $DefaultPort
    }

    foreach ($rawLine in ($EnvContent -split "(`r`n|`n|`r)")) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }

        if (-not $line.StartsWith("APP_PORT=")) {
            continue
        }

        $value = $line.Substring("APP_PORT=".Length).Trim()
        $parsed = 0
        if ([int]::TryParse($value, [ref]$parsed) -and $parsed -gt 0 -and $parsed -le 65535) {
            return $parsed
        }
    }

    return $DefaultPort
}

function Resolve-AppPortFromEnvFile {
    param(
        [Parameter(Mandatory = $true)][string]$EnvFilePath,
        [int]$DefaultPort = 8080
    )

    if (-not (Test-Path -LiteralPath $EnvFilePath)) {
        return $DefaultPort
    }

    $content = Get-Content -LiteralPath $EnvFilePath -Raw
    return (Resolve-AppPortFromEnvContent -EnvContent $content -DefaultPort $DefaultPort)
}

function Resolve-PwshPath {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        return $pwsh.Source
    }

    $windowsPowerShell = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($windowsPowerShell) {
        return $windowsPowerShell.Source
    }

    throw "未找到可用 PowerShell（pwsh / powershell.exe）。"
}

function Resolve-HttpsBootstrapLogDirectory {
    $override = [Environment]::GetEnvironmentVariable("KOKO_HTTPS_BOOTSTRAP_LOG_HOME")
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return [System.IO.Path]::GetFullPath($override)
    }

    $localAppData = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        return [System.IO.Path]::GetFullPath((Join-Path $localAppData "koko\\https-bootstrap"))
    }

    return [System.IO.Path]::GetFullPath((Join-Path $env:TEMP "koko-https-bootstrap"))
}

function Test-LoopbackPortOpen {
    param(
        [Parameter(Mandatory = $true)][int]$TargetPort,
        [int]$TimeoutMs = 300
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connectTask = $client.ConnectAsync("127.0.0.1", $TargetPort)
        if (-not $connectTask.Wait($TimeoutMs)) {
            return $false
        }
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-LoopbackPortOpen {
    param(
        [Parameter(Mandatory = $true)][int]$TargetPort,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-LoopbackPortOpen -TargetPort $TargetPort) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Start-AppViaRunScriptIfNeeded {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][int]$AppPort
    )

    if (Test-LoopbackPortOpen -TargetPort $AppPort) {
        Write-Host "检测到后端已在 127.0.0.1:$AppPort 监听，跳过 run.ps1 启动。"
        return
    }

    $runScriptPath = Join-Path $RepoRoot "run.ps1"
    if (-not (Test-Path -LiteralPath $runScriptPath)) {
        throw "找不到 run.ps1：$runScriptPath"
    }

    $pwshPath = Resolve-PwshPath
    $sessionId = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    # https.ps1 只负责 bootstrap 协调；日志也应落在运行时目录，而不是在仓库里再长一套脚本状态。
    $logRoot = Resolve-HttpsBootstrapLogDirectory
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $stdoutPath = Join-Path $logRoot ("run-$sessionId.stdout.log")
    $stderrPath = Join-Path $logRoot ("run-$sessionId.stderr.log")

    Write-Host "run.ps1 未启动，自动拉起开发链路..."
    $null = Start-Process `
        -FilePath $pwshPath `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runScriptPath) `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    if (-not (Wait-LoopbackPortOpen -TargetPort $AppPort -TimeoutSeconds 180)) {
        throw "run.ps1 已启动但端口 $AppPort 在 180 秒内未就绪。日志：$stdoutPath / $stderrPath"
    }

    Write-Host "run.ps1 启动完成，日志：$stdoutPath"
}

function Ensure-CaddyBinary {
    $existing = Get-Command caddy -ErrorAction SilentlyContinue
    if ($existing) {
        return $existing.Source
    }

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "未找到 Caddy 且本机缺少 winget。请先安装 Caddy。"
    }

    Write-Host "未检测到 Caddy，开始自动安装..."
    & $winget.Source install --id CaddyServer.Caddy -e --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) {
        throw "winget 安装 Caddy 失败，退出码: $LASTEXITCODE"
    }

    $existing = Get-Command caddy -ErrorAction SilentlyContinue
    if ($existing) {
        return $existing.Source
    }

    $wingetLink = Join-Path ([Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)) "Microsoft\\WinGet\\Links\\caddy.exe"
    if (Test-Path -LiteralPath $wingetLink) {
        return $wingetLink
    }

    throw "Caddy 安装后仍未找到可执行文件。"
}

function Get-LanIPv4Addresses {
    $all = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
            $_.IPAddress -notlike "169.254.*" -and
            $_.IPAddress -ne "127.0.0.1" -and
            $_.ValidLifetime -gt [TimeSpan]::Zero
        } | Select-Object -ExpandProperty IPAddress -Unique)
    return @($all | Sort-Object)
}

function Build-CaddyfileContent {
    param(
        [Parameter(Mandatory = $true)][int]$AppPort,
        [string[]]$LanIPv4Addresses = @()
    )

    $hosts = @("https://localhost", "https://127.0.0.1")
    foreach ($ip in $LanIPv4Addresses) {
        if (-not [string]::IsNullOrWhiteSpace($ip)) {
            $hosts += "https://$ip"
        }
    }
    $siteAddressLine = ($hosts | Select-Object -Unique) -join ", "

    return @"
{
    auto_https disable_redirects
}

$siteAddressLine {
    tls internal

    # Tus 上传必须直达 tusd sidecar；否则会落到后端 8080 导致一直上传中。
    @tus path /files*
    reverse_proxy @tus 127.0.0.1:1081

    # tracker announce 走 wss://<host>/（无路径）时，
    # 只把“非 socket.io 的 websocket upgrade”分流到 tracker。
    @tracker_ws {
        header Connection *Upgrade*
        header Upgrade websocket
        not path /socket.io*
    }
    reverse_proxy @tracker_ws 127.0.0.1:7072

    reverse_proxy 127.0.0.1:$AppPort
}
"@
}

function Resolve-HttpsRuntimeDirectory {
    $override = [Environment]::GetEnvironmentVariable("KOKO_HTTPS_RUNTIME_HOME")
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return [System.IO.Path]::GetFullPath($override)
    }

    $localAppData = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        return [System.IO.Path]::GetFullPath((Join-Path $localAppData "koko\\https-runtime"))
    }

    throw "无法解析 HTTPS 运行时目录。"
}

function Build-CaddyAutoStartCommand {
    param(
        [Parameter(Mandatory = $true)][string]$CaddyPath,
        [Parameter(Mandatory = $true)][string]$CaddyfilePath
    )

    return "`"$CaddyPath`" start --config `"$CaddyfilePath`" --adapter caddyfile"
}

function Start-OrReload-Caddy {
    param(
        [Parameter(Mandatory = $true)][string]$CaddyPath,
        [Parameter(Mandatory = $true)][string]$CaddyfilePath
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $CaddyPath validate --config $CaddyfilePath --adapter caddyfile 1>$null 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Caddyfile 校验失败，退出码: $LASTEXITCODE"
        }

        & $CaddyPath reload --config $CaddyfilePath --adapter caddyfile 1>$null 2>$null
        if ($LASTEXITCODE -eq 0) {
            return "reloaded"
        }

        & $CaddyPath start --config $CaddyfilePath --adapter caddyfile 1>$null 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Caddy 启动失败，退出码: $LASTEXITCODE"
        }
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return "started"
}

function Ensure-CaddyAutoStartTask {
    param(
        [Parameter(Mandatory = $true)][string]$CaddyPath,
        [Parameter(Mandatory = $true)][string]$CaddyfilePath
    )

    $taskName = "koko-caddy-https-autostart"
    $taskCommand = Build-CaddyAutoStartCommand -CaddyPath $CaddyPath -CaddyfilePath $CaddyfilePath

    & schtasks.exe /Query /TN $taskName *> $null
    $exists = ($LASTEXITCODE -eq 0)
    if ($exists) {
        & schtasks.exe /Delete /TN $taskName /F *> $null
    }

    & schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $taskCommand /F *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "创建开机自启任务失败：$taskName"
    }

    return $taskName
}

function Resolve-CaddyRootCertificatePath {
    $candidates = @(
        (Join-Path $env:APPDATA "Caddy\\pki\\authorities\\local\\root.crt"),
        (Join-Path $env:LOCALAPPDATA "Caddy\\pki\\authorities\\local\\root.crt"),
        (Join-Path $env:PROGRAMDATA "Caddy\\pki\\authorities\\local\\root.crt")
    )

    foreach ($path in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
            return $path
        }
    }

    return $null
}

function Invoke-HttpsBootstrap {
    param(
        [int]$RequestedPort = 0,
        [switch]$SkipApp,
        [switch]$IsLauncherMode,
        [switch]$PreviewOnly
    )

    $repoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
    $envPath = Join-Path $repoRoot ".env"
    $appPort = if ($RequestedPort -gt 0) { $RequestedPort } else { Resolve-AppPortFromEnvFile -EnvFilePath $envPath }

    if (-not $SkipApp -and -not $PreviewOnly) {
        Start-AppViaRunScriptIfNeeded -RepoRoot $repoRoot -AppPort $appPort
    }
    elseif ($SkipApp) {
        Write-Host "已跳过 run.ps1 自动启动。"
    }

    $runtimeDir = Resolve-HttpsRuntimeDirectory
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $caddyfilePath = Join-Path $runtimeDir "Caddyfile"

    $lanIps = Get-LanIPv4Addresses
    $content = Build-CaddyfileContent -AppPort $appPort -LanIPv4Addresses $lanIps
    Set-Content -LiteralPath $caddyfilePath -Value $content -Encoding UTF8

    $displayUrls = @("https://localhost", "https://127.0.0.1") + ($lanIps | ForEach-Object { "https://$_" })
    $displayUrls = @($displayUrls | Select-Object -Unique)

    Write-Host "后端端口: $appPort"
    Write-Host "Caddyfile: $caddyfilePath"
    Write-Host "HTTPS 地址："
    foreach ($url in $displayUrls) {
        Write-Host "  - $url"
    }
    Write-Host "注意：不要访问 https://127.0.0.1:$appPort/ （该端口是后端明文 HTTP 端口）。"
    Write-Host "注意：不要访问 https://0.0.0.0:$appPort/ （0.0.0.0 仅用于监听绑定，不是可访问主机名）。"

    if ($PreviewOnly) {
        Write-Host "DryRun 模式：仅展示动作，不执行。"
        return
    }

    $caddyPath = Ensure-CaddyBinary
    Write-Host "使用 Caddy: $caddyPath"

    $result = Start-OrReload-Caddy -CaddyPath $caddyPath -CaddyfilePath $caddyfilePath
    Write-Host "Caddy 已$result。"

    if ($IsLauncherMode) {
        Write-Host "Launcher 模式：跳过 caddy trust 与开机自启任务。"
        return
    }

    # 证书信任是 best-effort，不阻断主链。
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $caddyPath trust --config $caddyfilePath --adapter caddyfile 1>$null 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "自动写入本机证书信任失败（常见于权限不足）。"
        }
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    $taskName = Ensure-CaddyAutoStartTask -CaddyPath $caddyPath -CaddyfilePath $caddyfilePath
    Write-Host "已写入开机自启任务: $taskName"

    $rootCertPath = Resolve-CaddyRootCertificatePath
    if (-not [string]::IsNullOrWhiteSpace($rootCertPath)) {
        Write-Host "局域网设备若提示证书不受信任，请导入此根证书: $rootCertPath"
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    Invoke-HttpsBootstrap `
        -RequestedPort $Port `
        -SkipApp:$SkipAppBootstrap `
        -IsLauncherMode:$LauncherMode `
        -PreviewOnly:$DryRun
}

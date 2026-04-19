param(
    [int]$Port = 0,
    [switch]$SkipAppBootstrap,
    [switch]$NoAutoInstall,
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

function Resolve-PwshPath {
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        return $pwsh.Source
    }

    $windowsPowerShell = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($windowsPowerShell) {
        return $windowsPowerShell.Source
    }

    throw "未找到可用 PowerShell 解释器（pwsh / powershell.exe）。"
}

function Resolve-CloudflaredDownloadUrl {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    $fileName = switch ($arch) {
        "x64" { "cloudflared-windows-amd64.exe"; break }
        "arm64" { "cloudflared-windows-arm64.exe"; break }
        "x86" { "cloudflared-windows-386.exe"; break }
        default { throw "当前架构暂不支持自动下载 cloudflared：$arch" }
    }

    return "https://github.com/cloudflare/cloudflared/releases/latest/download/$fileName"
}

function Resolve-CloudflaredInstallDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot
    )

    $override = [Environment]::GetEnvironmentVariable("KOKO_CLOUDFLARED_HOME")
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return [System.IO.Path]::GetFullPath($override)
    }

    $localAppData = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        return [System.IO.Path]::GetFullPath((Join-Path $localAppData "koko\\cloudflared"))
    }

    $tempDir = [Environment]::GetEnvironmentVariable("TEMP")
    if (-not [string]::IsNullOrWhiteSpace($tempDir)) {
        return [System.IO.Path]::GetFullPath((Join-Path $tempDir "koko\\cloudflared"))
    }

    throw "无法解析 cloudflared 安装目录。请设置环境变量 KOKO_CLOUDFLARED_HOME。"
}

function Ensure-CloudflaredBinary {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [switch]$DisallowInstall
    )

    $existing = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($existing) {
        return $existing.Source
    }

    if ($DisallowInstall) {
        throw "未找到 cloudflared，且当前禁止自动安装。请先手动安装 cloudflared。"
    }

    $toolsDir = Resolve-CloudflaredInstallDirectory -RepoRoot $RepoRoot
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null

    $targetPath = Join-Path $toolsDir "cloudflared.exe"
    if (Test-Path -LiteralPath $targetPath) {
        return $targetPath
    }
    $downloadUrl = Resolve-CloudflaredDownloadUrl

    Write-Host "下载 cloudflared: $downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $targetPath

    if (-not (Test-Path -LiteralPath $targetPath)) {
        throw "cloudflared 下载失败，文件不存在：$targetPath"
    }

    return $targetPath
}

function Build-QuickTunnelArgumentList {
    param(
        [Parameter(Mandatory = $true)][int]$AppPort
    )

    return @(
        "tunnel",
        "--url", "http://127.0.0.1:$AppPort",
        "--no-autoupdate",
        "--protocol", "http2"
    )
}

function Start-AppViaRunScriptIfNeeded {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][int]$AppPort
    )

    if (Test-LoopbackPortOpen -TargetPort $AppPort) {
        Write-Host "检测到后端已在 127.0.0.1:$AppPort 监听，跳过 run.ps1 启动。"
        return $null
    }

    $runScriptPath = Join-Path $RepoRoot "run.ps1"
    if (-not (Test-Path -LiteralPath $runScriptPath)) {
        throw "找不到 run.ps1：$runScriptPath"
    }

    $pwshPath = Resolve-PwshPath
    $sessionId = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $logRoot = Join-Path $RepoRoot "tmp\\https-bootstrap"
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $stdoutPath = Join-Path $logRoot ("run-$sessionId.stdout.log")
    $stderrPath = Join-Path $logRoot ("run-$sessionId.stderr.log")

    Write-Host "run.ps1 未启动，自动拉起开发链路..."
    $process = Start-Process `
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
    return $process
}

function Invoke-CloudflareQuickTunnel {
    param(
        [Parameter(Mandatory = $true)][string]$CloudflaredPath,
        [Parameter(Mandatory = $true)][int]$AppPort,
        [Parameter(Mandatory = $true)][string]$RepoRoot
    )

    $args = Build-QuickTunnelArgumentList -AppPort $AppPort

    # Quick Tunnel 在用户主目录存在 config.yaml 时会报不支持。
    # 这里把 cloudflared 的 HOME/USERPROFILE 临时指向独立目录，避免和本机已有 named tunnel 配置互相影响。
    $isolatedHome = Join-Path $RepoRoot "tmp\\cloudflared-quick-home"
    New-Item -ItemType Directory -Path $isolatedHome -Force | Out-Null

    $oldHome = $env:HOME
    $oldUserProfile = $env:USERPROFILE
    $oldAppData = $env:APPDATA
    $oldLocalAppData = $env:LOCALAPPDATA

    try {
        $env:HOME = $isolatedHome
        $env:USERPROFILE = $isolatedHome
        $env:APPDATA = (Join-Path $isolatedHome "AppData\\Roaming")
        $env:LOCALAPPDATA = (Join-Path $isolatedHome "AppData\\Local")

        New-Item -ItemType Directory -Path $env:APPDATA -Force | Out-Null
        New-Item -ItemType Directory -Path $env:LOCALAPPDATA -Force | Out-Null

        Write-Host "启动 HTTPS 隧道（按 Ctrl+C 可停止）..."
        Write-Host "cloudflared $($args -join ' ')"
        & $CloudflaredPath @args
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "cloudflared 退出码异常：$exitCode"
        }
    }
    finally {
        $env:HOME = $oldHome
        $env:USERPROFILE = $oldUserProfile
        $env:APPDATA = $oldAppData
        $env:LOCALAPPDATA = $oldLocalAppData
    }
}

function Invoke-HttpsBootstrap {
    param(
        [int]$RequestedPort = 0,
        [switch]$SkipApp,
        [switch]$DisallowInstall,
        [switch]$PreviewOnly
    )

    $repoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
    $envPath = Join-Path $repoRoot ".env"
    $appPort = if ($RequestedPort -gt 0) { $RequestedPort } else { Resolve-AppPortFromEnvFile -EnvFilePath $envPath }
    $quickTunnelArgs = Build-QuickTunnelArgumentList -AppPort $appPort

    Write-Host "目标后端端口: $appPort"
    Write-Host "Quick Tunnel 命令: cloudflared $($quickTunnelArgs -join ' ')"

    if ($PreviewOnly) {
        Write-Host "DryRun 模式：仅展示动作，不执行。"
        return
    }

    if (-not $SkipApp) {
        $null = Start-AppViaRunScriptIfNeeded -RepoRoot $repoRoot -AppPort $appPort
    }
    else {
        Write-Host "已跳过 run.ps1 自动启动。"
    }

    $cloudflaredPath = Ensure-CloudflaredBinary -RepoRoot $repoRoot -DisallowInstall:$DisallowInstall
    Write-Host "使用 cloudflared: $cloudflaredPath"
    Invoke-CloudflareQuickTunnel -CloudflaredPath $cloudflaredPath -AppPort $appPort -RepoRoot $repoRoot
}

if ($MyInvocation.InvocationName -ne ".") {
    Invoke-HttpsBootstrap `
        -RequestedPort $Port `
        -SkipApp:$SkipAppBootstrap `
        -DisallowInstall:$NoAutoInstall `
        -PreviewOnly:$DryRun
}

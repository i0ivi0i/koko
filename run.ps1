param(
    [switch]$UpgradeDependencies,
    [switch]$DisableCloudflareTunnel,
    [switch]$DisableLocalHttpsBootstrap
)

$ErrorActionPreference = "Stop"

function Assert-PowerShellVersion {
    $version = $PSVersionTable.PSVersion
    if ($version.Major -lt 5 -or ($version.Major -eq 5 -and $version.Minor -lt 1)) {
        throw "run.ps1 至少需要 Windows PowerShell 5.1；当前版本是 $version。"
    }
}

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

function New-LauncherLogDirectory {
    param(
        [string]$RootDirectory,
        [string]$SessionName
    )

    $rootPath = Join-Path $RootDirectory $SessionName
    if (-not (Test-Path -LiteralPath $rootPath)) {
        New-Item -ItemType Directory -Path $rootPath | Out-Null
    }

    # 每次启动都分配独立会话目录，避免上一次异常中断后残留的 watcher 继续占用固定日志文件，
    # 导致新一轮 launcher 还没真正起业务就先因为文件句柄冲突失败。
    $sessionId = "{0}-{1}-{2}" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff"), $PID, ([Guid]::NewGuid().ToString("N").Substring(0, 8))
    $path = Join-Path $rootPath $sessionId
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

function New-StreamState {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType File -Path $Path -Force | Out-Null
    }

    return [PSCustomObject]@{
        Path = $Path
        Offset = 0L
        Pending = ""
    }
}

function New-ManagedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [string]$LogDirectory
    )

    $stdoutPath = Join-Path $LogDirectory ("{0}.stdout.log" -f $Name)
    $stderrPath = Join-Path $LogDirectory ("{0}.stderr.log" -f $Name)

    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    New-Item -ItemType File -Path $stdoutPath -Force | Out-Null
    New-Item -ItemType File -Path $stderrPath -Force | Out-Null

    # 前端 watcher 仍然保持“隐藏子进程 + 日志文件重定向 + 主线程轮询输出”的稳定方案。
    # 它们不是服务真相，不必为开发收尾去引入额外 console signal 复杂度。
    $process = Start-Process -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    return [PSCustomObject]@{
        Name = $Name
        Process = $process
        ProcessGroupId = $null
        Stdout = New-StreamState -Path $stdoutPath
        Stderr = New-StreamState -Path $stderrPath
    }
}

function Parse-CloudflareTunnelPublicUrlFromLogLine {
    param([string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return $null
    }

    $match = [Regex]::Match($Line, '(https://[a-z0-9-]+\.trycloudflare\.com)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        return $null
    }
    return $match.Groups[1].Value
}

function Test-AnsiOutputEnabled {
    try {
        if ($null -ne $Host.UI -and $Host.UI.SupportsVirtualTerminal) {
            return $true
        }
    }
    catch {
        # Windows PowerShell 5.1 没有 SupportsVirtualTerminal 属性，按降级路径继续。
    }

    try {
        if ($null -ne $PSStyle -and $PSStyle.OutputRendering -ne "PlainText") {
            return $true
        }
    }
    catch {
        # 某些 host 不支持 PSStyle，按降级路径继续。
    }

    return $false
}

function Write-HighlightedAccessBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return
    }

    $titleLine = " $Title "
    $urlLine = " $Url "
    $innerWidth = [Math]::Max([Math]::Max($titleLine.Length, $urlLine.Length), 72)
    $frame = ("=" * $innerWidth)
    $titleContent = $titleLine.PadRight($innerWidth)
    $urlContent = $urlLine.PadRight($innerWidth)

    if (Test-AnsiOutputEnabled) {
        $orange = [char]27 + "[38;5;208m"
        $orangeBold = [char]27 + "[1;38;5;208m"
        $reset = [char]27 + "[0m"
        [Console]::Out.WriteLine("$orange+$frame+$reset")
        [Console]::Out.WriteLine("$orangeBold|$titleContent|$reset")
        [Console]::Out.WriteLine("$orange|$urlContent|$reset")
        [Console]::Out.WriteLine("$orange+$frame+$reset")
        return
    }

    Write-Host ("+" + $frame + "+") -ForegroundColor DarkYellow
    Write-Host ("|" + $titleContent + "|") -ForegroundColor DarkYellow
    Write-Host ("|" + $urlContent + "|") -ForegroundColor Yellow
    Write-Host ("+" + $frame + "+") -ForegroundColor DarkYellow
}

function Resolve-CloudflaredBinaryPath {
    $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        $command = Get-Command cloudflared -ErrorAction SilentlyContinue
    }
    if ($null -ne $command) {
        return $command.Source
    }

    $runtimeRoot = Join-Path $env:LOCALAPPDATA "koko\\tools\\cloudflared"
    $cloudflaredPath = Join-Path $runtimeRoot "cloudflared.exe"
    if (Test-Path -LiteralPath $cloudflaredPath) {
        return $cloudflaredPath
    }

    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Write-Host "未检测到 cloudflared，开始自动下载：$downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $cloudflaredPath -UseBasicParsing

    if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
        throw "下载 cloudflared 失败：$cloudflaredPath"
    }

    return $cloudflaredPath
}

function Resolve-CloudflareEdgeBindAddress {
    $override = [Environment]::GetEnvironmentVariable("CLOUDFLARE_TUNNEL_EDGE_BIND_ADDRESS")
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        return $override.Trim()
    }

    $physicalAdapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
            $_.Status -eq "Up" -and $_.HardwareInterface
        })
    if ($physicalAdapters.Count -eq 0) {
        return $null
    }

    $physicalAdapterIndexes = @($physicalAdapters | ForEach-Object { $_.InterfaceIndex })
    $candidateIps = @(
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
            $_.InterfaceIndex -in $physicalAdapterIndexes -and
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*"
        } | Sort-Object InterfaceMetric, SkipAsSource
    )

    if ($candidateIps.Count -eq 0) {
        return $null
    }

    return $candidateIps[0].IPAddress
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

function Start-LocalHttpsBootstrap {
    param(
        [string]$RepoRoot,
        [int]$AppPort,
        [string]$LauncherLogDirectory,
        [switch]$DisableBootstrap
    )

    if ($DisableBootstrap) {
        Write-Host "已禁用本地 HTTPS 引导（DisableLocalHttpsBootstrap）。"
        return $null
    }

    $httpsScriptPath = Join-Path $RepoRoot "https.ps1"
    if (-not (Test-Path -LiteralPath $httpsScriptPath)) {
        Write-Warning "未找到 https.ps1，跳过本地 HTTPS 引导。"
        return $null
    }

    $pwshPath = Resolve-PwshPath
    Write-Host "启动本地 HTTPS 引导: https.ps1 -SkipAppBootstrap -Port $AppPort"
    $managedProcess = New-ManagedProcess `
        -Name "https-bootstrap" `
        -FilePath $pwshPath `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $httpsScriptPath, "-SkipAppBootstrap", "-LauncherMode", "-Port", $AppPort) `
        -WorkingDirectory $RepoRoot `
        -LogDirectory $LauncherLogDirectory
    $managedProcess | Add-Member -NotePropertyName StartedAt -NotePropertyValue (Get-Date)
    $managedProcess | Add-Member -NotePropertyName TimeoutSeconds -NotePropertyValue 25
    return $managedProcess
}

function Read-NewLogLines {
    param($StreamState)

    if ($null -eq $StreamState -or -not (Test-Path -LiteralPath $StreamState.Path)) {
        return @()
    }

    $stream = $null
    $reader = $null
    $chunk = ""

    try {
        $stream = [System.IO.File]::Open($StreamState.Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        if ($stream.Length -lt $StreamState.Offset) {
            $StreamState.Offset = 0L
            $StreamState.Pending = ""
        }

        [void]$stream.Seek($StreamState.Offset, [System.IO.SeekOrigin]::Begin)
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true, 1024, $true)
        $chunk = $reader.ReadToEnd()
        $StreamState.Offset = $stream.Position
    }
    finally {
        if ($reader) {
            $reader.Dispose()
        }
        elseif ($stream) {
            $stream.Dispose()
        }
    }

    if ([string]::IsNullOrEmpty($chunk)) {
        return @()
    }

    $text = $StreamState.Pending + $chunk
    $hasTrailingNewline = $text.EndsWith("`r`n") -or $text.EndsWith("`n")
    $parts = [System.Text.RegularExpressions.Regex]::Split($text, "\r?\n")

    if ($hasTrailingNewline) {
        $StreamState.Pending = ""
        if ($parts.Length -gt 0 -and $parts[$parts.Length - 1] -eq "") {
            if ($parts.Length -eq 1) {
                return @()
            }
            return $parts[0..($parts.Length - 2)]
        }
        return $parts
    }

    if ($parts.Length -eq 1) {
        $StreamState.Pending = $parts[0]
        return @()
    }

    $StreamState.Pending = $parts[$parts.Length - 1]
    return $parts[0..($parts.Length - 2)]
}

function Write-ManagedProcessLogs {
    param($ManagedProcess)

    if ($null -eq $ManagedProcess) {
        return
    }

    # 这里按“读取新增日志 -> 立刻写回当前控制台”的真实语义命名，
    # 避免继续用 PowerShell 未批准的 Flush 动词，同时也让维护者一眼看出它不是在清空日志文件。
    foreach ($line in (Read-NewLogLines -StreamState $ManagedProcess.Stdout)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        [Console]::Out.WriteLine(("[{0}] {1}" -f $ManagedProcess.Name, $line))
        if ($ManagedProcess.Name -eq "tunnel") {
            $publicUrl = Parse-CloudflareTunnelPublicUrlFromLogLine -Line $line
            if (-not [string]::IsNullOrWhiteSpace($publicUrl)) {
                $script:CloudflareTunnelPublicUrl = $publicUrl
            }
            if ($line -match "Registered tunnel connection") {
                $script:CloudflareTunnelConnected = $true
            }
            if (
                -not $script:CloudflareTunnelFailureAnnounced -and
                (
                    $line -match "TLS handshake with edge error" -or
                    $line -match "failed to verify certificate"
                )
            ) {
                Write-Warning "Cloudflare Tunnel 未连通：TLS 握手失败。请检查本机时间、网络 HTTPS 检查策略，或尝试关闭代理后重试。"
                $script:CloudflareTunnelFailureAnnounced = $true
            }
        }
    }

    foreach ($line in (Read-NewLogLines -StreamState $ManagedProcess.Stderr)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        [Console]::Error.WriteLine(("[{0}] {1}" -f $ManagedProcess.Name, $line))
        if ($ManagedProcess.Name -eq "tunnel") {
            $publicUrl = Parse-CloudflareTunnelPublicUrlFromLogLine -Line $line
            if (-not [string]::IsNullOrWhiteSpace($publicUrl)) {
                $script:CloudflareTunnelPublicUrl = $publicUrl
            }
            if ($line -match "Registered tunnel connection") {
                $script:CloudflareTunnelConnected = $true
            }
            if (
                -not $script:CloudflareTunnelFailureAnnounced -and
                (
                    $line -match "TLS handshake with edge error" -or
                    $line -match "failed to verify certificate"
                )
            ) {
                Write-Warning "Cloudflare Tunnel 未连通：TLS 握手失败。请检查本机时间、网络 HTTPS 检查策略，或尝试关闭代理后重试。"
                $script:CloudflareTunnelFailureAnnounced = $true
            }
        }
    }

    if (
        -not $script:CloudflareTunnelPublicUrlAnnounced -and
        $script:CloudflareTunnelConnected -and
        -not [string]::IsNullOrWhiteSpace($script:CloudflareTunnelPublicUrl)
    ) {
        Write-HighlightedAccessBlock `
            -Title "Cloudflare Tunnel HTTPS 地址（复制到手机或其他设备）" `
            -Url $script:CloudflareTunnelPublicUrl
        $script:CloudflareTunnelPublicUrlAnnounced = $true
    }
}

function Stop-StaleLauncherBackend {
    param(
        [string]$BackendTargetDir
    )

    # run.ps1 只是开发态启动器，所以只收自己留下的 launcher-run 后端残进程，
    # 不去替项目源码定义“真正的关机协议”，也不碰任何生产部署语义。
    $launcherTargetPattern = [Regex]::Escape($BackendTargetDir)
    $staleProcesses = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -in @("cargo.exe", "koko.exe") -and (
            $_.ExecutablePath -like "*target\\launcher-run\\debug\\koko.exe" -or
            $_.CommandLine -match $launcherTargetPattern
        )
    }

    foreach ($staleProcess in $staleProcesses) {
        try {
            Write-Host "清理上一轮 launcher 残留后端进程: [$($staleProcess.ProcessId)] $($staleProcess.Name)"
            & taskkill.exe /PID $staleProcess.ProcessId /T /F 2>$null | Out-Null
        }
        catch {
            Write-Warning "清理残留后端进程失败 [$($staleProcess.ProcessId)]: $($_.Exception.Message)"
        }
    }
}

function Get-ListeningPortProcessRecords {
    param([int[]]$Ports)

    $targetPorts = @($Ports | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
    if ($targetPorts.Count -eq 0) {
        return @()
    }

    $connections = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
            $targetPorts -contains $_.LocalPort
        })
    if ($connections.Count -eq 0) {
        return @()
    }

    $records = @()
    foreach ($group in ($connections | Group-Object LocalPort, OwningProcess)) {
        $connection = $group.Group[0]
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
        $records += [pscustomobject]@{
            Port           = [int]$connection.LocalPort
            ProcessId      = [int]$connection.OwningProcess
            Name           = if ($process) { $process.Name } else { "" }
            ExecutablePath = if ($process) { $process.ExecutablePath } else { "" }
            CommandLine    = if ($process) { $process.CommandLine } else { "" }
        }
    }

    return $records
}

function Resolve-StaleLauncherSidecar {
    param(
        $PortRecord,
        [int]$AppPort,
        [int]$TrackerPort,
        [int]$SeederPort,
        [int]$TusPort,
        [string]$TusUploadDir
    )

    $tusUploadDirPattern = [Regex]::Escape($TusUploadDir)
    $tusHookUrlPattern = [Regex]::Escape("http://127.0.0.1:$AppPort/internal/tus/hooks")

    if (
        $PortRecord.Port -eq $TrackerPort -and
        $PortRecord.Name -match '^node(?:\.exe)?$' -and
        $PortRecord.CommandLine -match 'dev-tracker\.mjs' -and
        $PortRecord.CommandLine -match ("--port\s+$TrackerPort(\s|$)")
    ) {
        return [pscustomobject]@{
            Role      = "tracker"
            Port      = $PortRecord.Port
            ProcessId = $PortRecord.ProcessId
            Name      = $PortRecord.Name
        }
    }

    if (
        $PortRecord.Port -eq $SeederPort -and
        $PortRecord.Name -match '^node(?:\.exe)?$' -and
        $PortRecord.CommandLine -match 'dev-seeder\.mjs' -and
        $PortRecord.CommandLine -match ("--port\s+$SeederPort(\s|$)")
    ) {
        return [pscustomobject]@{
            Role      = "webtorrent-seeder"
            Port      = $PortRecord.Port
            ProcessId = $PortRecord.ProcessId
            Name      = $PortRecord.Name
        }
    }

    if (
        $PortRecord.Port -eq $TusPort -and
        $PortRecord.Name -match '^tusd(?:\.exe)?$' -and
        $PortRecord.CommandLine -match ("-port\s+$TusPort(\s|$)") -and
        (
            $PortRecord.CommandLine -match $tusHookUrlPattern -or
            $PortRecord.CommandLine -match $tusUploadDirPattern
        )
    ) {
        return [pscustomobject]@{
            Role      = "tusd"
            Port      = $PortRecord.Port
            ProcessId = $PortRecord.ProcessId
            Name      = $PortRecord.Name
        }
    }

    return $null
}

function Stop-StaleLauncherSidecars {
    param(
        [int]$AppPort,
        [int]$TrackerPort,
        [int]$SeederPort,
        [int]$TusPort,
        [string]$TusUploadDir
    )

    $listeningRecords = Get-ListeningPortProcessRecords -Ports @($TrackerPort, $SeederPort, $TusPort)
    if ($listeningRecords.Count -eq 0) {
        return
    }

    $stoppedCount = 0
    foreach ($record in $listeningRecords) {
        $recognized = Resolve-StaleLauncherSidecar `
            -PortRecord $record `
            -AppPort $AppPort `
            -TrackerPort $TrackerPort `
            -SeederPort $SeederPort `
            -TusPort $TusPort `
            -TusUploadDir $TusUploadDir
        if ($null -eq $recognized) {
            continue
        }

        try {
            Write-Host "清理上一轮 launcher 残留 sidecar [$($recognized.Role)]：端口 $($recognized.Port) -> PID $($recognized.ProcessId) ($($recognized.Name))"
            & taskkill.exe /PID $recognized.ProcessId /T /F 2>$null | Out-Null
            $stoppedCount++
        }
        catch {
            Write-Warning "清理残留 sidecar 失败 [$($recognized.Role)][$($recognized.ProcessId)]: $($_.Exception.Message)"
        }
    }

    if ($stoppedCount -gt 0) {
        Start-Sleep -Milliseconds 800
    }
}

function Resolve-TusdBinaryPath {
    # tusd 是独立 sidecar，不属于主服务二进制；这里只负责确认它存在，
    # 缺失时直接让启动失败，避免开发脚本偷偷改机器状态。
    $command = Get-Command tusd.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        $command = Get-Command tusd -ErrorAction Stop
    }
    return $command.Source
}

function Test-TruthyEnvironmentFlag {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    switch ($Value.Trim().ToLowerInvariant()) {
        { $_ -in @("0", "false", "no", "off") } { return $false }
        default { return $true }
    }
}

function Stop-ManagedProcess {
    param($ManagedProcess)

    if ($null -eq $ManagedProcess -or $null -eq $ManagedProcess.Process) {
        return
    }

    $process = $ManagedProcess.Process
    if ($process.HasExited) {
        return
    }

    try {
        Write-Host "停止托管进程 [$($ManagedProcess.Name)]..."
        # 这里刻意保持“best effort + 强杀兜底”：
        # run.ps1 只是 Win11 开发启动器，不负责发明项目的退出真相；真相仍在 Rust 服务和正式部署器里。
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    }
    catch {
        Write-Warning "停止 [$($ManagedProcess.Name)] 失败: $($_.Exception.Message)"
    }
}

function Invoke-LauncherCleanup {
    param([string]$Reason = "")

    if ($script:LauncherCleanupStarted) {
        return
    }
    $script:LauncherCleanupStarted = $true

    if (-not [string]::IsNullOrWhiteSpace($Reason)) {
        Write-Host "启动器收尾: $Reason"
    }

    Write-ManagedProcessLogs $trackerProcess
    Write-ManagedProcessLogs $seederProcess
    Write-ManagedProcessLogs $tusdProcess
    Write-ManagedProcessLogs $backendProcess
    Write-ManagedProcessLogs $httpsBootstrapProcess
    Write-ManagedProcessLogs $cloudflareTunnelProcess
    Write-ManagedProcessLogs $frontendTypeWatch
    Write-ManagedProcessLogs $frontendWatch
    Stop-ManagedProcess $trackerProcess
    Stop-ManagedProcess $seederProcess
    Stop-ManagedProcess $tusdProcess
    Stop-ManagedProcess $backendProcess
    Stop-ManagedProcess $httpsBootstrapProcess
    Stop-ManagedProcess $cloudflareTunnelProcess
    Stop-ManagedProcess $frontendTypeWatch
    Stop-ManagedProcess $frontendWatch
}

Assert-PowerShellVersion
Import-DotEnv

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoPath = (Get-Command cargo.exe -ErrorAction Stop).Source
$pnpmPath = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction Stop
}
$nodePath = $nodeCommand.Source
$tusdPath = Resolve-TusdBinaryPath
$logDirectory = New-LauncherLogDirectory -RootDirectory $env:TEMP -SessionName "koko-runner"
$backendTargetDir = Join-Path $repoRoot "target\\launcher-run"
$frontendRoot = Join-Path $repoRoot "frontend"
$frontendWatch = $null
$frontendTypeWatch = $null
$backendProcess = $null
$tusdProcess = $null
$trackerProcess = $null
$seederProcess = $null
$httpsBootstrapProcess = $null
$cloudflareTunnelProcess = $null
$script:CloudflareTunnelPublicUrl = $null
$script:CloudflareTunnelPublicUrlAnnounced = $false
$script:CloudflareTunnelConnected = $false
$script:CloudflareTunnelFailureAnnounced = $false
$script:LauncherCleanupStarted = $false
$launcherCleanupSubscription = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -SupportEvent -Action {
    Invoke-LauncherCleanup -Reason "PowerShell.Exiting"
}

try {
    # run.ps1 只是 Win11 开发启动器，不是源码真相；
    # 真相仍然在 Cargo、TypeScript 与 esbuild 的官方命令里，脚本只负责以更稳的方式编排它们。
    # 默认启动路径不应该偷偷升级依赖；
    # 只有显式进入升级模式时，才允许刷新 Cargo.lock / pnpm-lock.yaml，
    # 这样日常“改代码 -> 跑项目 -> 模拟真实用户”不会混入依赖漂移噪音。
    if ($UpgradeDependencies) {
        Write-Host "刷新 Rust 依赖锁: cargo update"
        & $cargoPath update
        if ($LASTEXITCODE -ne 0) {
            throw "cargo update 失败，已停止启动。"
        }

        Write-Host "刷新前端依赖锁: pnpm --dir frontend up"
        & $pnpmPath --dir frontend up
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm up 失败，已停止启动。"
        }
    }

    Stop-StaleLauncherBackend -BackendTargetDir $backendTargetDir

    Write-Host "前端首轮构建: pnpm --dir frontend build"
    & $pnpmPath --dir frontend build
    if ($LASTEXITCODE -ne 0) {
        throw "前端首轮构建失败，已停止启动。"
    }

    Write-Host "前端增量编译: pnpm --dir frontend run dev:watch:supervised"
    $frontendWatch = New-ManagedProcess `
        -Name "build" `
        -FilePath $pnpmPath `
        -ArgumentList @("--dir", "frontend", "run", "dev:watch:supervised") `
        -WorkingDirectory $repoRoot `
        -LogDirectory $logDirectory

    Write-Host "前端类型守卫: pnpm --dir frontend run typecheck:watch"
    $frontendTypeWatch = New-ManagedProcess `
        -Name "typecheck" `
        -FilePath $pnpmPath `
        -ArgumentList @("--dir", "frontend", "run", "typecheck:watch") `
        -WorkingDirectory $repoRoot `
        -LogDirectory $logDirectory

    Write-Host "启动后端: cargo run --target-dir target\\launcher-run"
    $appPort = [Environment]::GetEnvironmentVariable("APP_PORT")
    if ([string]::IsNullOrWhiteSpace($appPort)) {
        $appPort = "8080"
    }
    $mediaTusBasePath = [Environment]::GetEnvironmentVariable("MEDIA_TUS_BASE_PATH")
    if ([string]::IsNullOrWhiteSpace($mediaTusBasePath)) {
        $mediaTusBasePath = "/files"
    }
    if (-not $mediaTusBasePath.StartsWith("/")) {
        $mediaTusBasePath = "/$mediaTusBasePath"
    }
    $mediaTusUploadDir = [Environment]::GetEnvironmentVariable("MEDIA_TUS_UPLOAD_DIR")
    if ([string]::IsNullOrWhiteSpace($mediaTusUploadDir)) {
        $mediaTusUploadDir = "data/tus"
    }
    $tusdPort = [Environment]::GetEnvironmentVariable("TUSD_PORT")
    if ([string]::IsNullOrWhiteSpace($tusdPort)) {
        $tusdPort = [Environment]::GetEnvironmentVariable("MEDIA_TUS_SERVER_PORT")
    }
    if ([string]::IsNullOrWhiteSpace($tusdPort)) {
        $tusdPort = "1081"
    }
    $tusdHost = [Environment]::GetEnvironmentVariable("TUSD_HOST")
    if ([string]::IsNullOrWhiteSpace($tusdHost)) {
        $tusdHost = "0.0.0.0"
    }
    $tusdMaxSize = [Environment]::GetEnvironmentVariable("TUSD_MAX_SIZE")
    if ([string]::IsNullOrWhiteSpace($tusdMaxSize)) {
        $tusdMaxSize = (200 * 1024 * 1024).ToString()
    }
    $tusdBehindProxy = [Environment]::GetEnvironmentVariable("TUSD_BEHIND_PROXY")
    $tusdHooksEnabledEvents = [Environment]::GetEnvironmentVariable("TUSD_HOOKS_ENABLED_EVENTS")
    if ([string]::IsNullOrWhiteSpace($tusdHooksEnabledEvents)) {
        $tusdHooksEnabledEvents = "pre-create,post-finish,pre-terminate,post-terminate"
    }
    $tusdHooksHttpForwardHeaders = [Environment]::GetEnvironmentVariable("TUSD_HOOKS_HTTP_FORWARD_HEADERS")
    if ([string]::IsNullOrWhiteSpace($tusdHooksHttpForwardHeaders)) {
        $tusdHooksHttpForwardHeaders = "Authorization,X-Request-ID,X-Koko-Internal-Termination"
    }
    $mediaTusInternalTerminationToken = [Environment]::GetEnvironmentVariable("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN")
    if ([string]::IsNullOrWhiteSpace($mediaTusInternalTerminationToken)) {
        # 当前阶段只有 run.ps1 同时掌握“后端进程 + tusd sidecar”两端编排；
        # 因此开发态默认直接生成一份内部 guard，避免把 termination 功能退化回“脚本没配好就永远没启用”。
        $mediaTusInternalTerminationToken = [Guid]::NewGuid().ToString("N")
    }
    $mediaTusInternalBaseUrl = [Environment]::GetEnvironmentVariable("MEDIA_TUS_INTERNAL_BASE_URL")
    if ([string]::IsNullOrWhiteSpace($mediaTusInternalBaseUrl)) {
        $mediaTusInternalBaseUrl = "http://127.0.0.1:$tusdPort"
    }
    # app 读 generic MEDIA_TUS_*，sidecar 读 TUSD_*。
    # launcher 在这里把双方最终解析后的值写回同一批环境变量，避免“准备返回的 tus_endpoint”和真正监听的 tusd 参数各自漂一套。
    [Environment]::SetEnvironmentVariable("MEDIA_TUS_SERVER_PORT", $tusdPort)
    [Environment]::SetEnvironmentVariable("MEDIA_TUS_BASE_PATH", $mediaTusBasePath)
    [Environment]::SetEnvironmentVariable("MEDIA_TUS_UPLOAD_DIR", $mediaTusUploadDir)
    [Environment]::SetEnvironmentVariable("MEDIA_TUS_INTERNAL_BASE_URL", $mediaTusInternalBaseUrl)
    [Environment]::SetEnvironmentVariable("MEDIA_TUS_INTERNAL_TERMINATION_TOKEN", $mediaTusInternalTerminationToken)
    $trackerPort = [Environment]::GetEnvironmentVariable("SWARM_TRACKER_PORT")
    if ([string]::IsNullOrWhiteSpace($trackerPort)) {
        $trackerPort = "7072"
    }
    $seederPort = [Environment]::GetEnvironmentVariable("SWARM_SEEDER_PORT")
    if ([string]::IsNullOrWhiteSpace($seederPort)) {
        $seederPort = "7073"
    }
    $trackerPublicUrl = [Environment]::GetEnvironmentVariable("SWARM_TRACKER_PUBLIC_URL")
    if ([string]::IsNullOrWhiteSpace($trackerPublicUrl)) {
        $trackerPublicUrl = "ws://127.0.0.1:$trackerPort"
    }
    $swarmTicketSecret = [Environment]::GetEnvironmentVariable("SWARM_TICKET_SECRET")
    if ([string]::IsNullOrWhiteSpace($swarmTicketSecret)) {
        # join ticket secret 只属于“本轮开发态后端 + tracker”共识，不需要开发者每次手工预置。
        # 这里缺省自动生成，保证 locator 签票与 tracker 验票始终站在同一份受控 secret 上。
        $swarmTicketSecret = [Guid]::NewGuid().ToString("N")
    }
    $tusHookUrl = "http://127.0.0.1:$appPort/internal/tus/hooks"
    $resolvedTusUploadDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $mediaTusUploadDir))
    New-Item -ItemType Directory -Path $resolvedTusUploadDir -Force | Out-Null
    [Environment]::SetEnvironmentVariable("SWARM_TRACKER_PORT", $trackerPort)
    [Environment]::SetEnvironmentVariable("SWARM_SEEDER_PORT", $seederPort)
    [Environment]::SetEnvironmentVariable("SWARM_TRACKER_PUBLIC_URL", $trackerPublicUrl)
    [Environment]::SetEnvironmentVariable("SWARM_TICKET_SECRET", $swarmTicketSecret)
    Stop-StaleLauncherSidecars `
        -AppPort ([int]$appPort) `
        -TrackerPort ([int]$trackerPort) `
        -SeederPort ([int]$seederPort) `
        -TusPort ([int]$tusdPort) `
        -TusUploadDir $resolvedTusUploadDir
    $localAccessUrl = "http://127.0.0.1:$appPort/"
    Write-HighlightedAccessBlock `
        -Title "本机访问入口（日志再多也先看这里）" `
        -Url $localAccessUrl
    Write-Host "访问入口: $localAccessUrl"
    Write-Host "tusd 监听: http://${tusdHost}:$tusdPort$mediaTusBasePath"
    Write-Host "WebTorrent tracker 对外 announce: $trackerPublicUrl"
    Write-Host "WebTorrent seeder 控制面: http://127.0.0.1:$seederPort/health"
    Write-Host "子进程日志目录: $logDirectory"
    # 启动器使用独立 target 目录：
    # 1. 不再和开发者手动执行的 `cargo run` 争抢默认 target\\debug\\koko.exe；
    # 2. 即使本地另有一个默认 target 的后端还活着，也不会把 launcher 自己卡死在编译阶段；
    # 3. 这不改变源码真相，仍然是 Cargo 官方命令，只是把开发启动器的构建产物隔离开。
    $backendProcess = New-ManagedProcess `
        -Name "backend" `
        -FilePath $cargoPath `
        -ArgumentList @("run", "--target-dir", $backendTargetDir) `
        -WorkingDirectory $repoRoot `
        -LogDirectory $logDirectory

    # tusd 只负责官方 resumable upload / concatenation / termination / local disk：
    # 1. `-base-path` 明确固定前端真正要打的 Tus 路径；
    # 2. `-upload-dir` 继续和 complete / gc 共享同一个临时目录；
    # 3. `-hooks-http` + `-hooks-enabled-events` 只接当前主服务真正消费的事件，不让默认 hook 表面继续漂；
    # 4. `-hooks-http-forward-headers` 显式保留 Authorization / request id / 内部 termination guard，避免诊断和删除门禁各靠猜；
    # 5. `-max-size` 与 `-disable-download` 把协议能力收口到当前业务边界，不把调试默认值带进正式主链。
    $tusdArgumentList = @(
        "-host", $tusdHost,
        "-port", $tusdPort,
        "-base-path", $mediaTusBasePath,
        "-upload-dir", $resolvedTusUploadDir,
        "-max-size", $tusdMaxSize,
        "-disable-download",
        "-hooks-http", $tusHookUrl,
        "-hooks-enabled-events", $tusdHooksEnabledEvents,
        "-hooks-http-forward-headers", $tusdHooksHttpForwardHeaders
    )
    if (Test-TruthyEnvironmentFlag $tusdBehindProxy) {
        $tusdArgumentList += @("-behind-proxy")
    }
    Write-Host ("启动 tusd: tusd {0}" -f ($tusdArgumentList -join " "))
    $tusdProcess = New-ManagedProcess `
        -Name "tusd" `
        -FilePath $tusdPath `
        -ArgumentList $tusdArgumentList `
        -WorkingDirectory $repoRoot `
        -LogDirectory $logDirectory

    # 这里不用官方 `bittorrent-tracker` CLI：
    # 1. 当前 11.2.2 的 `bin/cmd.js` 会先 import 整个 index，再把 client/node-datachannel 一起拖进 Node 进程；
    # 2. 这台 Win11 + Node 25 开发机上会先炸在原生模块缺失，真正的 websocket tracker 还没开始监听；
    # 3. 我们仍然站在成熟轮子上，只调用官方 `bittorrent-tracker/server` 子入口，
    #    让 `frontend/dev-tracker.mjs` 负责极薄的端口、announce 地址、join ticket 门禁和日志胶水。
    Write-Host "启动 WebTorrent tracker: node dev-tracker.mjs --port $trackerPort --public-url $trackerPublicUrl --ticket-secret <hidden>"
    $trackerProcess = New-ManagedProcess `
        -Name "tracker" `
        -FilePath $nodePath `
        -ArgumentList @("dev-tracker.mjs", "--port", $trackerPort, "--public-url", $trackerPublicUrl, "--ticket-secret", $swarmTicketSecret) `
        -WorkingDirectory $frontendRoot `
        -LogDirectory $logDirectory

    # seeder sidecar 只承接协议执行：
    # 1. 后端继续做业务 owner，决定谁该 start/stop/reconcile；
    # 2. sidecar 只暴露本地控制面，不参与业务裁决；
    # 3. 进程由 launcher 托管，避免“另开一个终端手工跑”导致真相漂移。
    Write-Host "启动 WebTorrent seeder: node dev-seeder.mjs --port $seederPort"
    $seederProcess = New-ManagedProcess `
        -Name "webtorrent-seeder" `
        -FilePath $nodePath `
        -ArgumentList @("dev-seeder.mjs", "--port", $seederPort) `
        -WorkingDirectory $frontendRoot `
        -LogDirectory $logDirectory

    if (-not $DisableCloudflareTunnel) {
        try {
            $cloudflaredPath = Resolve-CloudflaredBinaryPath
            $cloudflareEdgeBindAddress = Resolve-CloudflareEdgeBindAddress
            $tunnelArgumentList = @("tunnel", "--url", "http://127.0.0.1:$appPort", "--protocol", "http2", "--no-autoupdate")
            if (-not [string]::IsNullOrWhiteSpace($cloudflareEdgeBindAddress)) {
                $tunnelArgumentList += @("--edge-bind-address", $cloudflareEdgeBindAddress)
                Write-Host "Cloudflare Tunnel 出站绑定地址: $cloudflareEdgeBindAddress"
            }
            Write-Host "启动 Cloudflare Tunnel: cloudflared tunnel --url http://127.0.0.1:$appPort"
            $cloudflareTunnelProcess = New-ManagedProcess `
                -Name "tunnel" `
                -FilePath $cloudflaredPath `
                -ArgumentList $tunnelArgumentList `
                -WorkingDirectory $repoRoot `
                -LogDirectory $logDirectory
            Write-Host "Cloudflare Tunnel 正在建立中，连通后会打印 https://*.trycloudflare.com"
        }
        catch {
            Write-Warning "Cloudflare Tunnel 启动失败：$($_.Exception.Message)"
            Write-Warning "本地开发主链继续运行；如需禁用该提示，可用 ./run.ps1 -DisableCloudflareTunnel"
            $cloudflareTunnelProcess = $null
        }
    }

    $httpsBootstrapProcess = Start-LocalHttpsBootstrap `
        -RepoRoot $repoRoot `
        -AppPort ([int]$appPort) `
        -LauncherLogDirectory $logDirectory `
        -DisableBootstrap:$DisableLocalHttpsBootstrap

    while ($true) {
        Write-ManagedProcessLogs $frontendWatch
        Write-ManagedProcessLogs $frontendTypeWatch
        Write-ManagedProcessLogs $backendProcess
        Write-ManagedProcessLogs $tusdProcess
        Write-ManagedProcessLogs $trackerProcess
        Write-ManagedProcessLogs $seederProcess
        Write-ManagedProcessLogs $httpsBootstrapProcess
        Write-ManagedProcessLogs $cloudflareTunnelProcess

        if ($frontendWatch.Process.HasExited) {
            Write-ManagedProcessLogs $frontendWatch
            throw "前端增量编译进程意外退出，退出码: $($frontendWatch.Process.ExitCode)"
        }
        if ($frontendTypeWatch.Process.HasExited) {
            Write-ManagedProcessLogs $frontendTypeWatch
            throw "前端类型守卫进程意外退出，退出码: $($frontendTypeWatch.Process.ExitCode)"
        }
        if ($backendProcess.Process.HasExited) {
            Write-ManagedProcessLogs $backendProcess
            $backendExitCode = $backendProcess.Process.ExitCode
            if ($backendExitCode -ne 0) {
                throw "后端进程异常退出，退出码: $backendExitCode"
            }
            break
        }
        # tusd 是当前开发态唯一活着的 Tus sidecar；
        # 一旦它退出，launcher 就必须立刻把异常暴露出来，避免前端继续命中一个“看似在跑、其实已断”的假上传路径。
        if ($tusdProcess.Process.HasExited) {
            Write-ManagedProcessLogs $tusdProcess
            $tusdExitCode = $tusdProcess.Process.ExitCode
            if ($tusdExitCode -ne 0) {
                throw "tusd 进程异常退出，退出码: $tusdExitCode"
            }
            break
        }
        if ($trackerProcess.Process.HasExited) {
            Write-ManagedProcessLogs $trackerProcess
            throw "tracker 进程异常退出，退出码: $($trackerProcess.Process.ExitCode)"
        }
        if ($seederProcess.Process.HasExited) {
            Write-ManagedProcessLogs $seederProcess
            throw "webtorrent-seeder 进程异常退出，退出码: $($seederProcess.Process.ExitCode)"
        }
        if ($null -ne $cloudflareTunnelProcess -and $cloudflareTunnelProcess.Process.HasExited) {
            Write-ManagedProcessLogs $cloudflareTunnelProcess
            Write-Warning "Cloudflare Tunnel 已退出，退出码: $($cloudflareTunnelProcess.Process.ExitCode)"
            $cloudflareTunnelProcess = $null
        }
        if ($null -ne $httpsBootstrapProcess -and $httpsBootstrapProcess.Process.HasExited) {
            Write-ManagedProcessLogs $httpsBootstrapProcess
            if ($httpsBootstrapProcess.Process.ExitCode -ne 0) {
                Write-Warning "本地 HTTPS 引导进程异常退出，退出码: $($httpsBootstrapProcess.Process.ExitCode)"
            }
            $httpsBootstrapProcess = $null
        }
        if (
            $null -ne $httpsBootstrapProcess -and
            -not $httpsBootstrapProcess.Process.HasExited -and
            ($null -ne $httpsBootstrapProcess.StartedAt) -and
            (((Get-Date) - $httpsBootstrapProcess.StartedAt).TotalSeconds -gt $httpsBootstrapProcess.TimeoutSeconds)
        ) {
            Write-Host "本地 HTTPS 引导进程超过 $($httpsBootstrapProcess.TimeoutSeconds) 秒未退出，已结束该引导进程；HTTPS 主服务不受影响。"
            Stop-ManagedProcess $httpsBootstrapProcess
            $httpsBootstrapProcess = $null
        }

        Start-Sleep -Milliseconds 200
    }
}
finally {
    if ($null -ne $launcherCleanupSubscription) {
        Unregister-Event -SubscriptionId $launcherCleanupSubscription.Id -ErrorAction SilentlyContinue
        Remove-Job -Id $launcherCleanupSubscription.Id -Force -ErrorAction SilentlyContinue
    }
    Invoke-LauncherCleanup -Reason "finally"
}

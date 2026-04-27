param(
    [switch]$UpgradeDependencies,
    [switch]$DisableLocalHttpsBootstrap,
    [switch]$DisableAutoOptimizeCleanup,
    [switch]$ForceInitialFrontendBuild
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

function Resolve-CleanupScriptHostPath {
    $pwshCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($null -eq $pwshCommand) {
        $pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
    }
    if ($null -ne $pwshCommand) {
        return $pwshCommand.Source
    }

    $fallbackCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -ne $fallbackCommand) {
        return $fallbackCommand.Source
    }

    throw "未找到可用于调用 qingli.ps1 的 PowerShell 宿主。"
}

function Invoke-StartupArtifactOptimization {
    param(
        [string]$RepoRoot,
        [string]$ScriptHostPath
    )

    $cleanScriptPath = Join-Path $RepoRoot "qingli.ps1"
    if (-not (Test-Path -LiteralPath $cleanScriptPath)) {
        throw "缺少 qingli.ps1；无法执行启动前自动优化。"
    }

    Write-Host "启动前自动优化本地产物: qingli.ps1 -Apply -Force -SkipDatabase -SkipFiles -OptimizeStartupArtifacts"
    & $ScriptHostPath `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $cleanScriptPath `
        -Apply `
        -Force `
        -SkipDatabase `
        -SkipFiles `
        -OptimizeStartupArtifacts
    if ($LASTEXITCODE -ne 0) {
        throw "启动前自动优化失败，已停止启动。"
    }
}

function Invoke-WorkspaceStorageReclaim {
    param(
        [string]$RepoRoot,
        [string]$ScriptHostPath
    )

    $cleanScriptPath = Join-Path $RepoRoot "qingli.ps1"
    if (-not (Test-Path -LiteralPath $cleanScriptPath)) {
        throw "缺少 qingli.ps1；无法执行工作区重清理。"
    }

    Write-Host "启动前工作区重清理: qingli.ps1 -Apply -Force -SkipDatabase -SkipFiles -ReclaimWorkspaceStorage"
    & $ScriptHostPath `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $cleanScriptPath `
        -Apply `
        -Force `
        -SkipDatabase `
        -SkipFiles `
        -ReclaimWorkspaceStorage
    if ($LASTEXITCODE -ne 0) {
        throw "启动前工作区重清理失败，已停止启动。"
    }
}

function Show-StartupCleanupMenu {
    $choices = @(
        [pscustomobject]@{
            Value = "optimize"
            Label = "继续启动（只做默认轻清理）"
        }
        [pscustomobject]@{
            Value = "reclaim"
            Label = "重清理后启动（cargo clean + node_modules / dist / .tsbuildinfo / tmp）"
        }
        [pscustomobject]@{
            Value = "cancel"
            Label = "取消"
        }
    )

    $selectedIndex = 0

    while ($true) {
        Clear-Host
        Write-Host "启动前清理模式（上下箭头选择，回车确认）"
        Write-Host ""
        for ($i = 0; $i -lt $choices.Count; $i++) {
            $prefix = if ($i -eq $selectedIndex) { "> " } else { "  " }
            Write-Host ($prefix + $choices[$i].Label)
        }

        $keyInfo = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        if ($keyInfo.VirtualKeyCode -eq 38) {
            $selectedIndex = ($selectedIndex - 1 + $choices.Count) % $choices.Count
            continue
        }
        if ($keyInfo.VirtualKeyCode -eq 40) {
            $selectedIndex = ($selectedIndex + 1) % $choices.Count
            continue
        }
        if ($keyInfo.VirtualKeyCode -eq 13) {
            Clear-Host
            return $choices[$selectedIndex].Value
        }
    }
}

function Test-FrontendDependenciesInstalled {
    param([string]$FrontendRoot)

    $requiredPaths = @(
        (Join-Path $FrontendRoot "node_modules\\.modules.yaml"),
        (Join-Path $FrontendRoot "node_modules\\typescript"),
        (Join-Path $FrontendRoot "node_modules\\vitest"),
        (Join-Path $FrontendRoot "node_modules\\@types\\node")
    )

    foreach ($path in $requiredPaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            return $false
        }
    }

    return $true
}

function Ensure-FrontendDependenciesInstalled {
    param(
        [string]$FrontendRoot,
        [string]$PnpmPath
    )

    if (Test-FrontendDependenciesInstalled -FrontendRoot $FrontendRoot) {
        return
    }

    # 重清理会明确删掉 frontend/node_modules；
    # 启动器这里用 frozen lockfile 只恢复当前锁定依赖，不把“重清理后启动”偷换成依赖升级入口。
    Write-Host "前端依赖缺失，执行: pnpm --dir frontend install --frozen-lockfile"
    & $PnpmPath --dir frontend install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        throw "前端依赖安装失败，已停止启动。"
    }

    if (-not (Test-FrontendDependenciesInstalled -FrontendRoot $FrontendRoot)) {
        throw "前端依赖安装后仍不完整，已停止启动。"
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

function Write-ManagedStreamLines {
    param(
        [Parameter(Mandatory = $true)][string]$ManagedProcessName,
        [Parameter(Mandatory = $true)]$StreamState,
        [switch]$StdErr
    )

    foreach ($line in (Read-NewLogLines -StreamState $StreamState)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        if ($StdErr) {
            [Console]::Error.WriteLine(("[{0}] {1}" -f $ManagedProcessName, $line))
        }
        else {
            [Console]::Out.WriteLine(("[{0}] {1}" -f $ManagedProcessName, $line))
        }
    }
}

function Write-ManagedProcessLogs {
    param($ManagedProcess)

    if ($null -eq $ManagedProcess) {
        return
    }

    Write-ManagedStreamLines -ManagedProcessName $ManagedProcess.Name -StreamState $ManagedProcess.Stdout
    Write-ManagedStreamLines -ManagedProcessName $ManagedProcess.Name -StreamState $ManagedProcess.Stderr -StdErr
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
            LocalAddresses = @($group.Group | Select-Object -ExpandProperty LocalAddress -Unique)
            Name           = if ($process) { $process.Name } else { "" }
            ExecutablePath = if ($process) { $process.ExecutablePath } else { "" }
            CommandLine    = if ($process) { $process.CommandLine } else { "" }
        }
    }

    return $records
}

function Test-NonLoopbackListenAddress {
    param([string]$Address)

    if ([string]::IsNullOrWhiteSpace($Address)) {
        return $false
    }

    return $Address -notin @("127.0.0.1", "::1")
}

function Format-PortRecordSummary {
    param($PortRecords)

    $records = @($PortRecords)
    if ($records.Count -eq 0) {
        return "无监听进程"
    }

    return (($records | ForEach-Object {
                $addresses = @($_.LocalAddresses | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
                $addressSummary = if ($addresses.Count -gt 0) { $addresses -join "/" } else { "unknown" }
                "端口 $($_.Port) -> PID $($_.ProcessId) ($($_.Name)) 地址 $addressSummary"
            }) -join "; ")
}

function Test-TcpPortBindable {
    param(
        [int]$Port,
        [string]$BindAddress = "127.0.0.1"
    )

    if ($Port -le 0 -or [string]::IsNullOrWhiteSpace($BindAddress)) {
        return $false
    }

    $listener = $null
    try {
        $ipAddress = [System.Net.IPAddress]::Parse($BindAddress)
        $listener = [System.Net.Sockets.TcpListener]::new($ipAddress, $Port)
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
        return $true
    }
    catch [System.Net.Sockets.SocketException] {
        return $false
    }
    finally {
        if ($listener) {
            try {
                $listener.Stop()
            }
            catch {
                # 这里只做启动前探针，不让 Stop 失败反过来污染主链。
            }
        }
    }
}

function Wait-PortsBindable {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$PortBindings,
        [int]$TimeoutSeconds = 20
    )

    $bindings = @($PortBindings | Where-Object {
            $null -ne $_ -and
            $_.PSObject.Properties.Name -contains "Port" -and
            [int]$_.Port -gt 0
        })
    if ($bindings.Count -eq 0) {
        return
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $blocked = @()
    while ((Get-Date) -lt $deadline) {
        $blocked = @()
        foreach ($binding in $bindings) {
            $bindAddress = if (
                $binding.PSObject.Properties.Name -contains "BindAddress" -and
                -not [string]::IsNullOrWhiteSpace($binding.BindAddress)
            ) {
                [string]$binding.BindAddress
            }
            else {
                "127.0.0.1"
            }

            if (-not (Test-TcpPortBindable -Port ([int]$binding.Port) -BindAddress $bindAddress)) {
                $blocked += [pscustomobject]@{
                    Label       = if ($binding.PSObject.Properties.Name -contains "Label") { [string]$binding.Label } else { "" }
                    Port        = [int]$binding.Port
                    BindAddress = $bindAddress
                }
            }
        }

        if ($blocked.Count -eq 0) {
            return
        }

        Start-Sleep -Milliseconds 300
    }

    $blockedMessages = foreach ($blockedBinding in $blocked) {
        $records = @(Get-ListeningPortProcessRecords -Ports @($blockedBinding.Port))
        $labelPrefix = if ([string]::IsNullOrWhiteSpace($blockedBinding.Label)) {
            "端口 $($blockedBinding.Port)"
        }
        else {
            "$($blockedBinding.Label) 端口 $($blockedBinding.Port)"
        }

        if ($records.Count -gt 0) {
            "$labelPrefix 仍被占用（目标绑定 $($blockedBinding.BindAddress)）：$(Format-PortRecordSummary -PortRecords $records)"
        }
        else {
            "$labelPrefix 在 $TimeoutSeconds 秒后仍不可绑定（目标绑定 $($blockedBinding.BindAddress)），但当前未发现活跃监听；通常是上一轮强杀后 socket 还没真正释放"
        }
    }
    throw ($blockedMessages -join "；")
}

function Get-ManagedProcessFamilyProcessIds {
    param([int]$RootProcessId)

    if ($RootProcessId -le 0) {
        return @()
    }

    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $seen = New-Object 'System.Collections.Generic.HashSet[int]'
    $pending = New-Object 'System.Collections.Generic.Queue[int]'
    [void]$seen.Add($RootProcessId)
    $pending.Enqueue($RootProcessId)

    while ($pending.Count -gt 0) {
        $current = $pending.Dequeue()
        foreach ($process in $processes) {
            if ([int]$process.ParentProcessId -ne $current) {
                continue
            }

            $childId = [int]$process.ProcessId
            if ($seen.Add($childId)) {
                $pending.Enqueue($childId)
            }
        }
    }

    return @($seen | Sort-Object)
}

function Wait-ManagedProcessPortReady {
    param(
        [Parameter(Mandatory = $true)]$ManagedProcess,
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutSeconds = 20,
        [switch]$RequireNonLoopback
    )

    if ($null -eq $ManagedProcess -or $null -eq $ManagedProcess.Process) {
        throw "缺少托管进程上下文，无法等待端口 $Port 就绪。"
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        Write-ManagedProcessLogs $ManagedProcess

        $processFamilyIds = @(Get-ManagedProcessFamilyProcessIds -RootProcessId $ManagedProcess.Process.Id)
        $records = @(Get-ListeningPortProcessRecords -Ports @($Port) | Where-Object {
                $processFamilyIds -contains $_.ProcessId
            })
        if ($records.Count -gt 0) {
            if (-not $RequireNonLoopback) {
                return
            }

            $hasNonLoopback = $false
            foreach ($record in $records) {
                foreach ($address in @($record.LocalAddresses)) {
                    if (Test-NonLoopbackListenAddress -Address $address) {
                        $hasNonLoopback = $true
                        break
                    }
                }
                if ($hasNonLoopback) {
                    return
                }
            }
        }

        if ($ManagedProcess.Process.HasExited) {
            throw "托管进程 [$($ManagedProcess.Name)] 在端口 $Port 就绪前已退出，退出码: $($ManagedProcess.Process.ExitCode)"
        }

        Start-Sleep -Milliseconds 250
    }

    $allPortRecords = @(Get-ListeningPortProcessRecords -Ports @($Port))
    $summary = Format-PortRecordSummary -PortRecords $allPortRecords
    if ($RequireNonLoopback) {
        throw "托管进程 [$($ManagedProcess.Name)] 在 $TimeoutSeconds 秒内未拿到端口 $Port 的非回环监听；当前端口归属：$summary"
    }
    throw "托管进程 [$($ManagedProcess.Name)] 在 $TimeoutSeconds 秒内未拿到端口 $Port 监听；当前端口归属：$summary"
}

function Test-CommandLineFlagValue {
    param(
        [string]$CommandLine,
        [string[]]$Flags,
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine) -or [string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    $escapedFlags = @(
        $Flags |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object { [Regex]::Escape($_) }
    )
    if ($escapedFlags.Count -eq 0) {
        return $false
    }

    $flagAlternation = $escapedFlags -join "|"
    $valuePattern = [Regex]::Escape($Value)
    $pattern = '(?:^|\s)"?(?:' + $flagAlternation + ')"?\s+"?' + $valuePattern + '"?(?:\s|$)'
    return [Regex]::IsMatch($CommandLine, $pattern)
}

function Resolve-RecognizedLauncherService {
    param(
        $PortRecord,
        [string]$BackendTargetDir,
        [int]$AppPort,
        [int]$TrackerPort,
        [int]$SeederPort,
        [int]$TusPort,
        [string]$TusUploadDir
    )

    $backendTargetPattern = if ([string]::IsNullOrWhiteSpace($BackendTargetDir)) {
        $null
    }
    else {
        [Regex]::Escape($BackendTargetDir)
    }
    $tusUploadDirPattern = [Regex]::Escape($TusUploadDir)
    $tusHookUrlPattern = [Regex]::Escape("http://127.0.0.1:$AppPort/internal/tus/hooks")

    if (
        -not [string]::IsNullOrWhiteSpace($backendTargetPattern) -and
        $PortRecord.Port -eq $AppPort -and
        $PortRecord.Name -in @("cargo.exe", "koko.exe") -and (
            $PortRecord.ExecutablePath -like "*target\\launcher-run\\debug\\koko.exe" -or
            $PortRecord.CommandLine -match $backendTargetPattern -or
            $PortRecord.CommandLine -match 'target\\\\launcher-run\\debug\\koko\.exe'
        )
    ) {
        return [pscustomobject]@{
            Role      = "backend"
            Port      = $PortRecord.Port
            ProcessId = $PortRecord.ProcessId
            Name      = $PortRecord.Name
        }
    }

    if (
        $PortRecord.Port -eq $TrackerPort -and
        $PortRecord.Name -match '^node(?:\.exe)?$' -and
        (
            $PortRecord.CommandLine -match 'bittorrent-tracker' -or
            $PortRecord.CommandLine -match 'node_modules[\\/]+bittorrent-tracker[\\/]+bin[\\/]+cmd\.js'
        ) -and
        (Test-CommandLineFlagValue -CommandLine $PortRecord.CommandLine -Flags @("--port", "-p") -Value $TrackerPort)
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
        (Test-CommandLineFlagValue -CommandLine $PortRecord.CommandLine -Flags @("--port") -Value $SeederPort)
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
        (Test-CommandLineFlagValue -CommandLine $PortRecord.CommandLine -Flags @("-port") -Value $TusPort) -and
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

function Stop-RecognizedLauncherServices {
    param(
        [int[]]$Ports,
        [string]$BackendTargetDir,
        [int]$AppPort,
        [int]$TrackerPort,
        [int]$SeederPort,
        [int]$TusPort,
        [string]$TusUploadDir,
        [string]$ReasonLabel = "清理 launcher 残留服务"
    )

    $listeningRecords = Get-ListeningPortProcessRecords -Ports $Ports
    if ($listeningRecords.Count -eq 0) {
        return @()
    }

    $recognizedServices = @()
    foreach ($record in $listeningRecords) {
        $recognized = Resolve-RecognizedLauncherService `
            -PortRecord $record `
            -BackendTargetDir $BackendTargetDir `
            -AppPort $AppPort `
            -TrackerPort $TrackerPort `
            -SeederPort $SeederPort `
            -TusPort $TusPort `
            -TusUploadDir $TusUploadDir
        if ($null -eq $recognized) {
            continue
        }

        if ($recognizedServices.ProcessId -contains $recognized.ProcessId) {
            continue
        }

        $recognizedServices += $recognized
    }

    foreach ($recognized in $recognizedServices) {
        try {
            Write-Host "$ReasonLabel [$($recognized.Role)]：端口 $($recognized.Port) -> PID $($recognized.ProcessId) ($($recognized.Name))"
            & taskkill.exe /PID $recognized.ProcessId /T /F 2>$null | Out-Null
        }
        catch {
            Write-Warning "$ReasonLabel 失败 [$($recognized.Role)][$($recognized.ProcessId)]: $($_.Exception.Message)"
        }
    }

    if ($recognizedServices.Count -gt 0) {
        Start-Sleep -Milliseconds 800
    }

    return $recognizedServices
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
    Write-ManagedProcessLogs $frontendTypeWatch
    Write-ManagedProcessLogs $frontendWatch
    Stop-ManagedProcess $trackerProcess
    Stop-ManagedProcess $seederProcess
    Stop-ManagedProcess $tusdProcess
    Stop-ManagedProcess $backendProcess
    Stop-ManagedProcess $httpsBootstrapProcess
    Stop-ManagedProcess $frontendTypeWatch
    Stop-ManagedProcess $frontendWatch

    if ($null -ne $script:LauncherServiceSweepContext) {
        $cleanupContext = $script:LauncherServiceSweepContext
        $null = Stop-RecognizedLauncherServices `
            -Ports $cleanupContext.Ports `
            -BackendTargetDir $cleanupContext.BackendTargetDir `
            -AppPort $cleanupContext.AppPort `
            -TrackerPort $cleanupContext.TrackerPort `
            -SeederPort $cleanupContext.SeederPort `
            -TusPort $cleanupContext.TusPort `
            -TusUploadDir $cleanupContext.TusUploadDir `
            -ReasonLabel "回收 launcher 退出残留"
    }
}

Assert-PowerShellVersion
Import-DotEnv

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cleanupScriptHostPath = Resolve-CleanupScriptHostPath
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
$script:LauncherCleanupStarted = $false
$script:LauncherServiceSweepContext = $null
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

    if (-not $DisableAutoOptimizeCleanup) {
        # 每次启动都先给一个固定菜单：
        # 1. 默认继续启动只做轻清理；
        # 2. 磁盘告急时可直接进重清理；
        # 3. 交互仍然只发生在 run.ps1 入口层，不把清理真相复制到别的脚本。
        $startupCleanupMode = Show-StartupCleanupMenu
        if ($startupCleanupMode -eq "cancel") {
            Write-Host "已取消启动。"
            return
        }
        if ($startupCleanupMode -eq "reclaim") {
            Invoke-WorkspaceStorageReclaim -RepoRoot $repoRoot -ScriptHostPath $cleanupScriptHostPath
        }
        else {
            # 默认轻清理只清启动器/烟测 owner 明确的本地产物：
            # 1. 不碰数据库业务表；
            # 2. 不碰 data/attachments / data/tus 这类业务真相目录；
            # 3. 只在 qingli.ps1 这一处维护目录名单，避免 run.ps1 再长出第三套清理 owner。
            Invoke-StartupArtifactOptimization -RepoRoot $repoRoot -ScriptHostPath $cleanupScriptHostPath
        }
    }

    Ensure-FrontendDependenciesInstalled -FrontendRoot $frontendRoot -PnpmPath $pnpmPath

    if ($ForceInitialFrontendBuild) {
        Write-Host "前端完整首轮构建: pnpm --dir frontend build"
        & $pnpmPath --dir frontend build
        if ($LASTEXITCODE -ne 0) {
            throw "前端完整首轮构建失败，已停止启动。"
        }
    }
    else {
        Write-Host "跳过前端完整首轮构建；由 dev:watch:supervised 负责启动基线构建。需要完整门禁时加 -ForceInitialFrontendBuild。"
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
        $tusdHost = "127.0.0.1"
    }
    $mediaTusPublicEndpoint = [Environment]::GetEnvironmentVariable("MEDIA_TUS_PUBLIC_ENDPOINT")
    if ([string]::IsNullOrWhiteSpace($mediaTusPublicEndpoint)) {
        $mediaTusPublicEndpoint = $mediaTusBasePath
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
    [Environment]::SetEnvironmentVariable("MEDIA_TUS_PUBLIC_ENDPOINT", $mediaTusPublicEndpoint)
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
        $trackerPublicUrl = "/api/swarm/announce"
    }
    $trackerUpstreamUrl = [Environment]::GetEnvironmentVariable("SWARM_TRACKER_UPSTREAM_URL")
    if ([string]::IsNullOrWhiteSpace($trackerUpstreamUrl)) {
        $trackerUpstreamUrl = "ws://127.0.0.1:$trackerPort"
    }
    $seederTrackerUrl = [Environment]::GetEnvironmentVariable("SWARM_SEEDER_TRACKER_URL")
    if ([string]::IsNullOrWhiteSpace($seederTrackerUrl)) {
        # sidecar 虽然是本机进程，也必须走后端认证入口；裸 tracker upstream 只给后端代理使用。
        $seederTrackerUrl = "ws://127.0.0.1:$appPort/api/swarm/announce"
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
    [Environment]::SetEnvironmentVariable("SWARM_TRACKER_UPSTREAM_URL", $trackerUpstreamUrl)
    [Environment]::SetEnvironmentVariable("SWARM_SEEDER_TRACKER_URL", $seederTrackerUrl)
    [Environment]::SetEnvironmentVariable("SWARM_TICKET_SECRET", $swarmTicketSecret)
    $script:LauncherServiceSweepContext = [pscustomobject]@{
        Ports            = @([int]$appPort, [int]$trackerPort, [int]$seederPort, [int]$tusdPort)
        BackendTargetDir = $backendTargetDir
        AppPort          = [int]$appPort
        TrackerPort      = [int]$trackerPort
        SeederPort       = [int]$seederPort
        TusPort          = [int]$tusdPort
        TusUploadDir     = $resolvedTusUploadDir
    }
    $null = Stop-RecognizedLauncherServices `
        -Ports $script:LauncherServiceSweepContext.Ports `
        -BackendTargetDir $script:LauncherServiceSweepContext.BackendTargetDir `
        -AppPort $script:LauncherServiceSweepContext.AppPort `
        -TrackerPort $script:LauncherServiceSweepContext.TrackerPort `
        -SeederPort $script:LauncherServiceSweepContext.SeederPort `
        -TusPort $script:LauncherServiceSweepContext.TusPort `
        -TusUploadDir $script:LauncherServiceSweepContext.TusUploadDir `
        -ReasonLabel "清理上一轮 launcher 残留服务"
    Wait-PortsBindable -PortBindings @(
        [pscustomobject]@{ Label = "backend"; Port = [int]$appPort; BindAddress = "0.0.0.0" },
        [pscustomobject]@{ Label = "tusd"; Port = [int]$tusdPort; BindAddress = $tusdHost },
        [pscustomobject]@{ Label = "tracker"; Port = [int]$trackerPort; BindAddress = "127.0.0.1" },
        [pscustomobject]@{ Label = "webtorrent-seeder"; Port = [int]$seederPort; BindAddress = "127.0.0.1" }
    )
    $localAccessUrl = "http://127.0.0.1:$appPort/"
    Write-HighlightedAccessBlock `
        -Title "后端明文调试入口（不要拿它模拟公网用户）" `
        -Url $localAccessUrl
    Write-Host "后端明文调试入口: $localAccessUrl"
    Write-Host "浏览器 Tus 公开 contract: $mediaTusPublicEndpoint"
    Write-Host "tusd 内部监听: http://${tusdHost}:$tusdPort$mediaTusBasePath"
    Write-Host "WebTorrent tracker upstream: $trackerUpstreamUrl"
    Write-Host "WebTorrent tracker 浏览器公开 announce: $trackerPublicUrl"
    Write-Host "WebTorrent tracker stats: http://127.0.0.1:$trackerPort/stats"
    Write-Host "WebTorrent seeder 私有 announce: $seederTrackerUrl"
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
    # 后端首轮冷编译可能明显超过 30 秒：
    # 1. launcher 目标目录与默认 target 隔离后，第一次运行本来就会重新编译；
    # 2. 这里如果仍然只给 30 秒，会把“只是还在编译”的正常首启误判成启动失败；
    # 3. 把等待窗拉长到 180 秒，比让用户反复重跑脚本或误判网络问题更省心。
    Wait-ManagedProcessPortReady -ManagedProcess $backendProcess -Port ([int]$appPort) -TimeoutSeconds 180 -RequireNonLoopback

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
    Wait-ManagedProcessPortReady `
        -ManagedProcess $tusdProcess `
        -Port ([int]$tusdPort) `
        -TimeoutSeconds 20 `
        -RequireNonLoopback:(Test-NonLoopbackListenAddress -Address $tusdHost)

    # tracker 进程只运行成熟 WebTorrent tracker 轮子：
    # 1. 业务 join_ticket 门禁已经前移到 Rust /api/swarm/announce 同源代理；
    # 2. 这里不再传业务密钥，也不再维护私有 tracker 核心；
    # 3. HTTP 只用于官方 stats 页面，浏览器/sidecar 的 announce 仍必须先经过后端验票入口。
    $trackerArgumentList = @("--dir", "frontend", "exec", "bittorrent-tracker", "--port", $trackerPort, "--ws", "--http", "--stats", "--http-hostname", "127.0.0.1")
    Write-Host ("启动 WebTorrent tracker: pnpm {0}" -f ($trackerArgumentList -join " "))
    $trackerProcess = New-ManagedProcess `
        -Name "tracker" `
        -FilePath $pnpmPath `
        -ArgumentList $trackerArgumentList `
        -WorkingDirectory $repoRoot `
        -LogDirectory $logDirectory
    Wait-ManagedProcessPortReady -ManagedProcess $trackerProcess -Port ([int]$trackerPort) -TimeoutSeconds 20

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
    Wait-ManagedProcessPortReady -ManagedProcess $seederProcess -Port ([int]$seederPort) -TimeoutSeconds 20

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

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

    # 这里明确不用异步 DataReceivedEventHandler：
    # PowerShell 5.1/7 都可能在无 Runspace 的线程里调用脚本块，导致整个 launcher 崩掉。
    # 改为“隐藏子进程 + 日志文件重定向 + 主线程轮询输出”，牺牲一点实现长度，换来稳定性与兼容性。
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
        Stdout = New-StreamState -Path $stdoutPath
        Stderr = New-StreamState -Path $stderrPath
    }
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

function Flush-ManagedProcessLogs {
    param($ManagedProcess)

    if ($null -eq $ManagedProcess) {
        return
    }

    foreach ($line in (Read-NewLogLines -StreamState $ManagedProcess.Stdout)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        [Console]::Out.WriteLine(("[{0}] {1}" -f $ManagedProcess.Name, $line))
    }

    foreach ($line in (Read-NewLogLines -StreamState $ManagedProcess.Stderr)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        [Console]::Error.WriteLine(("[{0}] {1}" -f $ManagedProcess.Name, $line))
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
        # 这里只能按整棵进程树收尾：pnpm watcher 背后还会带 node 子进程，
        # 单杀父进程会留下孤儿 watcher 继续占用文件句柄与 CPU，开发体验会越来越脏。
        & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
    catch {
        Write-Warning "停止 [$($ManagedProcess.Name)] 失败: $($_.Exception.Message)"
    }
}

Assert-PowerShellVersion
Import-DotEnv

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoPath = (Get-Command cargo.exe -ErrorAction Stop).Source
$pnpmPath = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$logDirectory = New-LauncherLogDirectory -RootDirectory $env:TEMP -SessionName "koko-runner"
$backendTargetDir = Join-Path $repoRoot "target\\launcher-run"
$frontendWatch = $null
$frontendTypeWatch = $null
$backendProcess = $null

try {
    # run.ps1 只是 Win11 开发启动器，不是源码真相；
    # 真相仍然在 Cargo、TypeScript 与 esbuild 的官方命令里，脚本只负责以更稳的方式编排它们。
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
    Write-Host "访问入口: http://127.0.0.1:$appPort/"
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

    while ($true) {
        Flush-ManagedProcessLogs $frontendWatch
        Flush-ManagedProcessLogs $frontendTypeWatch
        Flush-ManagedProcessLogs $backendProcess

        if ($frontendWatch.Process.HasExited) {
            Flush-ManagedProcessLogs $frontendWatch
            throw "前端增量编译进程意外退出，退出码: $($frontendWatch.Process.ExitCode)"
        }
        if ($frontendTypeWatch.Process.HasExited) {
            Flush-ManagedProcessLogs $frontendTypeWatch
            throw "前端类型守卫进程意外退出，退出码: $($frontendTypeWatch.Process.ExitCode)"
        }
        if ($backendProcess.Process.HasExited) {
            Flush-ManagedProcessLogs $backendProcess
            $backendExitCode = $backendProcess.Process.ExitCode
            if ($backendExitCode -ne 0) {
                throw "后端进程异常退出，退出码: $backendExitCode"
            }
            break
        }

        Start-Sleep -Milliseconds 200
    }
}
finally {
    Flush-ManagedProcessLogs $backendProcess
    Flush-ManagedProcessLogs $frontendTypeWatch
    Flush-ManagedProcessLogs $frontendWatch
    Stop-ManagedProcess $backendProcess
    Stop-ManagedProcess $frontendTypeWatch
    Stop-ManagedProcess $frontendWatch
}

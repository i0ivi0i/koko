$ErrorActionPreference = "Stop"
$script:ConsoleWriteLock = [object]::new()

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

Import-DotEnv

function Write-PrefixedLine {
    param(
        [string]$Prefix,
        [string]$Message,
        [switch]$IsError
    )

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return
    }

    # 多个长期进程会并发往同一个控制台写日志；这里显式串行化，避免前后端输出互相打断成半行。
    [System.Threading.Monitor]::Enter($script:ConsoleWriteLock)
    try {
        $line = "[{0}] {1}" -f $Prefix, $Message
        if ($IsError) {
            [Console]::Error.WriteLine($line)
        }
        else {
            [Console]::Out.WriteLine($line)
        }
    }
    finally {
        [System.Threading.Monitor]::Exit($script:ConsoleWriteLock)
    }
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    foreach ($arg in $ArgumentList) {
        [void]$startInfo.ArgumentList.Add($arg)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $process.EnableRaisingEvents = $true

    # 这里不再用 Start-Process 默认开新窗口，而是直接接管子进程 stdout/stderr，
    # 让 TypeScript、esbuild、Rust 三条官方开发链路都汇总回当前 PowerShell 终端。
    $processName = $Name
    $stdoutHandler = [System.Diagnostics.DataReceivedEventHandler]{
        param($sender, $eventArgs)
        Write-PrefixedLine -Prefix $processName -Message $eventArgs.Data
    }
    $stderrHandler = [System.Diagnostics.DataReceivedEventHandler]{
        param($sender, $eventArgs)
        Write-PrefixedLine -Prefix $processName -Message $eventArgs.Data -IsError
    }

    $process.add_OutputDataReceived($stdoutHandler)
    $process.add_ErrorDataReceived($stderrHandler)

    if (-not $process.Start()) {
        throw "启动子进程失败: $Name"
    }

    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    Write-Host "已托管进程 [$Name]: $FilePath $($ArgumentList -join ' ')"

    return [PSCustomObject]@{
        Name = $Name
        Process = $process
        StdoutHandler = $stdoutHandler
        StderrHandler = $stderrHandler
    }
}

function Stop-ManagedProcess {
    param($ManagedProcess)

    if ($null -eq $ManagedProcess) {
        return
    }

    $process = $ManagedProcess.Process
    if ($null -eq $process) {
        return
    }

    try {
        if (-not $process.HasExited) {
            Write-Host "停止托管进程 [$($ManagedProcess.Name)]..."
            # watcher 与 cargo run 都是开发时的长跑子进程，没有 GUI 窗口可优雅关闭；
            # 这里直接结束整棵子进程树，避免残留孤儿进程继续占用终端、端口或文件句柄。
            $process.Kill($true)
            $process.WaitForExit()
        }
    }
    catch {
        Write-Warning "停止 [$($ManagedProcess.Name)] 失败: $($_.Exception.Message)"
    }
    finally {
        try { $process.remove_OutputDataReceived($ManagedProcess.StdoutHandler) } catch {}
        try { $process.remove_ErrorDataReceived($ManagedProcess.StderrHandler) } catch {}
        $process.Dispose()
    }
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cargoPath = (Get-Command cargo.exe -ErrorAction Stop).Source
$pnpmPath = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$frontendWatch = $null
$frontendTypeWatch = $null
$backendProcess = $null

try {
    # 每次启动前先把依赖锁文件刷新到“约束内最新”，避免长期开发发生版本漂移。
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

    # run.ps1 只做编排：先构建前端产物，再开 watch，最后拉起后端。
    Write-Host "前端首轮构建: pnpm --dir frontend build"
    & $pnpmPath --dir frontend build
    if ($LASTEXITCODE -ne 0) {
        throw "前端首轮构建失败，已停止启动。"
    }

    Write-Host "前端增量编译: pnpm --dir frontend run dev:watch"
    $frontendWatch = Start-ManagedProcess `
        -Name "build" `
        -FilePath $pnpmPath `
        -ArgumentList @("--dir", "frontend", "run", "dev:watch") `
        -WorkingDirectory $repoRoot

    Write-Host "前端类型守卫: pnpm --dir frontend run typecheck:watch"
    $frontendTypeWatch = Start-ManagedProcess `
        -Name "typecheck" `
        -FilePath $pnpmPath `
        -ArgumentList @("--dir", "frontend", "run", "typecheck:watch") `
        -WorkingDirectory $repoRoot

    Write-Host "启动后端: cargo run"
    $appPort = [Environment]::GetEnvironmentVariable("APP_PORT")
    if ([string]::IsNullOrWhiteSpace($appPort)) {
        $appPort = "8080"
    }
    Write-Host "访问入口: http://127.0.0.1:$appPort/"
    $backendProcess = Start-ManagedProcess `
        -Name "backend" `
        -FilePath $cargoPath `
        -ArgumentList @("run") `
        -WorkingDirectory $repoRoot

    # 这里把 run.ps1 明确定位成 Win11 开发启动器 supervisor：
    # - TypeScript 类型检查仍由 tsc 官方链路负责
    # - 前端产物仍由 esbuild 官方链路负责
    # - 后端运行仍由 cargo 官方链路负责
    # run.ps1 只负责把三条长期进程优雅托管到一个终端里，而不去改写源码真相。
    while ($true) {
        if ($frontendWatch.Process.HasExited) {
            throw "前端增量编译进程意外退出，退出码: $($frontendWatch.Process.ExitCode)"
        }
        if ($frontendTypeWatch.Process.HasExited) {
            throw "前端类型守卫进程意外退出，退出码: $($frontendTypeWatch.Process.ExitCode)"
        }
        if ($backendProcess.Process.HasExited) {
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
    Stop-ManagedProcess $backendProcess
    Stop-ManagedProcess $frontendTypeWatch
    Stop-ManagedProcess $frontendWatch
}

param(
    [switch]$Apply,
    [switch]$Preview,
    [switch]$Force,
    [switch]$OptimizeStartupArtifacts,
    [switch]$ReclaimWorkspaceStorage,
    [switch]$SkipDatabase,
    [switch]$SkipFiles,
    [string]$DatabaseUrl,
    [string]$DbPassword,
    [string]$AttachmentDir,
    [string]$RustusDataDir,
    [string]$RustusInfoDir,
    [string]$RustusVerifyDir,
    [string]$RustusInfoVerifyDir
)

$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot

function Read-DotEnvMap {
    param([string]$Path)

    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $map
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            return
        }
        $pair = $line.Split("=", 2)
        if ($pair.Count -ne 2) {
            return
        }
        $map[$pair[0].Trim()] = $pair[1].Trim()
    }

    return $map
}

function Get-ConfigValue {
    param(
        [hashtable]$DotEnv,
        [string]$Key,
        [string]$Fallback = ""
    )

    if ($DotEnv.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($DotEnv[$Key])) {
        return $DotEnv[$Key]
    }
    return $Fallback
}

function Resolve-ManagedPath {
    param([string]$RawPath)

    if ([string]::IsNullOrWhiteSpace($RawPath)) {
        throw "清理路径不能为空。"
    }

    $fullPath = if ([System.IO.Path]::IsPathRooted($RawPath)) {
        [System.IO.Path]::GetFullPath($RawPath)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $RawPath))
    }

    $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath -eq $rootPath) {
        throw "拒绝把磁盘根目录当成清理目标：$fullPath"
    }
    if ($fullPath -eq $RepoRoot) {
        throw "拒绝把仓库根目录当成清理目标：$fullPath"
    }

    return $fullPath
}

function Get-SafeDatabaseTargetDisplay {
    param([string]$DbUrl)

    try {
        $uri = [System.Uri]$DbUrl
        $databaseName = $uri.AbsolutePath.Trim("/")
        return "{0}://{1}:{2}/{3}" -f $uri.Scheme, $uri.Host, $uri.Port, $databaseName
    }
    catch {
        return "<configured>"
    }
}

function Get-DirectorySummary {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{
            Path   = $Path
            Exists = $false
            Files  = 0
            SizeMB = 0
        }
    }

    $files = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue
    $measure = $files | Measure-Object -Property Length -Sum
    return [pscustomobject]@{
        Path   = $Path
        Exists = $true
        Files  = $files.Count
        SizeMB = [math]::Round(($measure.Sum / 1MB), 2)
    }
}

function Get-CleanupTargetSummary {
    param($Target)

    $path = $Target.Path
    if (-not (Test-Path -LiteralPath $path)) {
        return [pscustomobject]@{
            Kind   = $Target.Kind
            Path   = $path
            Exists = $false
            Items  = 0
            SizeMB = 0
            Reason = $Target.Reason
        }
    }

    if ($Target.Kind -eq "File") {
        $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        $size = if ($null -ne $item) { [math]::Round(($item.Length / 1MB), 2) } else { 0 }
        return [pscustomobject]@{
            Kind   = $Target.Kind
            Path   = $path
            Exists = $true
            Items  = 1
            SizeMB = $size
            Reason = $Target.Reason
        }
    }

    $files = Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue
    $measure = $files | Measure-Object -Property Length -Sum
    return [pscustomobject]@{
        Kind   = $Target.Kind
        Path   = $path
        Exists = $true
        Items  = $files.Count
        SizeMB = [math]::Round(($measure.Sum / 1MB), 2)
        Reason = $Target.Reason
    }
}

function Test-TcpPortOpen {
    param([int]$Port)

    if ($Port -le 0) {
        return $false
    }

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(600)) {
            return $false
        }
        $client.EndConnect($async) | Out-Null
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Assert-ServicesStopped {
    param([int[]]$Ports)

    $listening = @($Ports | Where-Object { Test-TcpPortOpen $_ })
    if ($listening.Count -gt 0) {
        throw "检测到本地服务仍在运行，拒绝清理。请先停止这些端口对应的项目进程：$($listening -join ', ')；如需无人值守自动停服，请改用 .\qingli.ps1 -Apply -Force"
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

function Resolve-RecognizedProjectService {
    param(
        $PortRecord,
        [string]$RepoRoot,
        [int]$AppPort,
        [int]$TrackerPort,
        [int]$SeederPort,
        [int]$TusPort,
        [string]$TusUploadDir
    )

    $backendTargetDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "target\\launcher-run"))
    $backendTargetPattern = [Regex]::Escape($backendTargetDir)
    $tusUploadDirPattern = [Regex]::Escape($TusUploadDir)
    $tusHookUrlPattern = [Regex]::Escape("http://127.0.0.1:$AppPort/internal/tus/hooks")

    if (
        $PortRecord.Port -eq $AppPort -and
        $PortRecord.Name -in @("cargo.exe", "koko.exe") -and (
            $PortRecord.ExecutablePath -like "*target\launcher-run\debug\koko.exe" -or
            $PortRecord.CommandLine -match $backendTargetPattern -or
            $PortRecord.CommandLine -match 'target\\\\launcher-run\\debug\\koko\.exe'
        )
    ) {
        return [pscustomobject]@{
            Role      = "backend"
            Port       = $PortRecord.Port
            ProcessId  = $PortRecord.ProcessId
            Name       = $PortRecord.Name
            CommandLine = $PortRecord.CommandLine
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
            CommandLine = $PortRecord.CommandLine
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
            CommandLine = $PortRecord.CommandLine
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
            CommandLine = $PortRecord.CommandLine
        }
    }

    return $null
}

function Stop-RecognizedProjectServices {
    param(
        [int[]]$Ports,
        [string]$RepoRoot,
        [int]$AppPort,
        [int]$TrackerPort,
        [int]$SeederPort,
        [int]$TusPort,
        [string]$TusUploadDir
    )

    $listeningRecords = Get-ListeningPortProcessRecords -Ports $Ports
    if ($listeningRecords.Count -eq 0) {
        return @()
    }

    $recognizedServices = @()
    foreach ($record in $listeningRecords) {
        $recognized = Resolve-RecognizedProjectService `
            -PortRecord $record `
            -RepoRoot $RepoRoot `
            -AppPort $AppPort `
            -TrackerPort $TrackerPort `
            -SeederPort $SeederPort `
            -TusPort $TusPort `
            -TusUploadDir $TusUploadDir
        if ($null -ne $recognized) {
            $recognizedServices += $recognized
        }
    }

    foreach ($service in $recognizedServices) {
        $processId = $service.ProcessId
        Write-Host "自动停止项目服务 [$($service.Role)]：端口 $($service.Port) -> PID $processId ($($service.Name))"
        & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
    }

    return $recognizedServices
}

function Invoke-DatabaseCleanup {
    param(
        [string]$PsqlPath,
        [string]$DbUrl,
        [string]$Password
    )

    $sql = @"
TRUNCATE TABLE
  attachment_streaming_manifests,
  attachment_distribution_metadata,
  attachment_upload_transports,
  message_attachment_refs,
  attachments,
  room_read_anchors,
  messages,
  room_events,
  room_members,
  rooms,
  sessions,
  anonymous_identities
RESTART IDENTITY CASCADE;
"@

    $previousPassword = $env:PGPASSWORD
    try {
        if (-not [string]::IsNullOrWhiteSpace($Password)) {
            $env:PGPASSWORD = $Password
        }
        & $PsqlPath -v ON_ERROR_STOP=1 $DbUrl -c $sql
        if ($LASTEXITCODE -ne 0) {
            throw "psql 返回退出码 $LASTEXITCODE"
        }
    }
    finally {
        if ($null -eq $previousPassword) {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        }
        else {
            $env:PGPASSWORD = $previousPassword
        }
    }
}

function Clear-DirectoryContents {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        return
    }

    Get-ChildItem -LiteralPath $Path -Force | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

function Resolve-CommandPath {
    param(
        [string[]]$Candidates,
        [string]$ErrorMessage
    )

    foreach ($candidate in $Candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return $command.Source
        }
    }

    throw $ErrorMessage
}

function Get-StartupArtifactOptimizationTargets {
    param([string]$RepoRoot)

    $definitions = @(
        @{ Path = "target\realtime-tests"; Kind = "Directory"; Reason = "真实链路测试独享的 Cargo target 产物" }
        @{ Path = "target\tmp-investigate"; Kind = "Directory"; Reason = "临时调查 target 噪音" }
        @{ Path = "tmp\audit"; Kind = "Directory"; Reason = "审计/大附件抽样产物" }
        @{ Path = "tmp\smoke-run"; Kind = "Directory"; Reason = "烟测运行目录" }
        @{ Path = "tmp\smoke-logs"; Kind = "Directory"; Reason = "烟测日志目录" }
        @{ Path = "tmp\codex-smoke"; Kind = "Directory"; Reason = "Codex 烟测目录" }
        @{ Path = "tmp\https-bootstrap"; Kind = "Directory"; Reason = "本地 HTTPS 引导临时目录" }
    )

    return @($definitions | ForEach-Object {
            [pscustomobject]@{
                Kind   = $_.Kind
                Path   = Resolve-ManagedPath -RawPath $_.Path
                Reason = $_.Reason
            }
        } | Sort-Object Path -Unique)
}

function Get-WorkspaceStorageReclaimTargets {
    param([string]$RepoRoot)

    $definitions = @(
        @{ Path = "frontend\node_modules"; Kind = "Directory"; Reason = "前端依赖工作集；下次 pnpm install 会重建" }
        @{ Path = "frontend\dist"; Kind = "Directory"; Reason = "前端构建产物" }
        @{ Path = "frontend\.tsbuildinfo"; Kind = "File"; Reason = "TypeScript 增量缓存" }
        @{ Path = "tmp"; Kind = "Directory"; Reason = "本地烟测/审计/调试临时产物" }
    )

    return @($definitions | ForEach-Object {
            [pscustomobject]@{
                Kind   = $_.Kind
                Path   = Resolve-ManagedPath -RawPath $_.Path
                Reason = $_.Reason
            }
        } | Sort-Object Path -Unique)
}

function Clear-CleanupTarget {
    param($Target)

    if ($Target.Kind -eq "File") {
        if (Test-Path -LiteralPath $Target.Path) {
            Remove-Item -LiteralPath $Target.Path -Force
        }
        return
    }

    Clear-DirectoryContents -Path $Target.Path
}

function Invoke-CargoWorkspaceClean {
    param([string]$RepoRoot)

    $cargoPath = Resolve-CommandPath `
        -Candidates @("cargo.exe", "cargo") `
        -ErrorMessage "未找到 cargo；无法执行工作区重清理。"

    Push-Location $RepoRoot
    try {
        Write-Host "执行 cargo clean..."
        & $cargoPath clean
        if ($LASTEXITCODE -ne 0) {
            throw "cargo clean 返回退出码 $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

$dotEnv = Read-DotEnvMap -Path (Join-Path $RepoRoot ".env")

$DatabaseUrl = if ($PSBoundParameters.ContainsKey("DatabaseUrl")) {
    $DatabaseUrl
}
else {
    Get-ConfigValue -DotEnv $dotEnv -Key "DATABASE_URL"
}

$AttachmentDir = if ($PSBoundParameters.ContainsKey("AttachmentDir")) {
    $AttachmentDir
}
else {
    Get-ConfigValue -DotEnv $dotEnv -Key "ATTACHMENT_STORAGE_DIR" -Fallback "data/attachments"
}

$RustusDataDir = if ($PSBoundParameters.ContainsKey("RustusDataDir")) {
    $RustusDataDir
}
else {
    Get-ConfigValue -DotEnv $dotEnv -Key "RUSTUS_DATA_DIR" -Fallback "data/rustus"
}

$TusUploadDir = Get-ConfigValue `
    -DotEnv $dotEnv `
    -Key "MEDIA_TUS_UPLOAD_DIR" `
    -Fallback (Get-ConfigValue -DotEnv $dotEnv -Key "RUSTUS_DATA_DIR" -Fallback "data/tus")

$RustusInfoDir = if ($PSBoundParameters.ContainsKey("RustusInfoDir")) {
    $RustusInfoDir
}
else {
    Get-ConfigValue -DotEnv $dotEnv -Key "RUSTUS_INFO_DIR" -Fallback "data/rustus-info"
}

$RustusVerifyDir = if ($PSBoundParameters.ContainsKey("RustusVerifyDir")) {
    $RustusVerifyDir
}
else {
    "data/rustus-verify"
}

$RustusInfoVerifyDir = if ($PSBoundParameters.ContainsKey("RustusInfoVerifyDir")) {
    $RustusInfoVerifyDir
}
else {
    "data/rustus-info-verify"
}

$AppPort = [int](Get-ConfigValue -DotEnv $dotEnv -Key "APP_PORT" -Fallback "8080")
$TrackerPort = [int](Get-ConfigValue -DotEnv $dotEnv -Key "SWARM_TRACKER_PORT" -Fallback "7072")
$SeederPort = [int](Get-ConfigValue -DotEnv $dotEnv -Key "SWARM_SEEDER_PORT" -Fallback "7073")
$TusPort = [int](Get-ConfigValue `
    -DotEnv $dotEnv `
    -Key "TUSD_PORT" `
    -Fallback (Get-ConfigValue `
        -DotEnv $dotEnv `
        -Key "MEDIA_TUS_SERVER_PORT" `
        -Fallback (Get-ConfigValue -DotEnv $dotEnv -Key "RUSTUS_SERVER_PORT" -Fallback "1081")))

$managedDirectories = @(
    $AttachmentDir
    $TusUploadDir
    $RustusDataDir
    $RustusInfoDir
    $RustusVerifyDir
    $RustusInfoVerifyDir
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
    Resolve-ManagedPath -RawPath $_
} | Sort-Object -Unique

$directorySummaries = $managedDirectories | ForEach-Object { Get-DirectorySummary -Path $_ }
$startupOptimizationTargets = if ($OptimizeStartupArtifacts) {
    Get-StartupArtifactOptimizationTargets -RepoRoot $RepoRoot
}
else {
    @()
}
$startupOptimizationSummaries = $startupOptimizationTargets | ForEach-Object { Get-CleanupTargetSummary -Target $_ }
$workspaceStorageTargets = if ($ReclaimWorkspaceStorage) {
    Get-WorkspaceStorageReclaimTargets -RepoRoot $RepoRoot
}
else {
    @()
}
$workspaceStorageSummaries = $workspaceStorageTargets | ForEach-Object { Get-CleanupTargetSummary -Target $_ }

Write-Host ""
Write-Host "=== koko 本地测试数据清理脚本 ==="
Write-Host "仓库根目录: $RepoRoot"
if (-not $SkipDatabase) {
    if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
        throw "未找到 DATABASE_URL；请在 .env 中配置，或显式传入 -DatabaseUrl。"
    }
    Write-Host "数据库目标: $(Get-SafeDatabaseTargetDisplay -DbUrl $DatabaseUrl)"
}
else {
    Write-Host "数据库目标: 已跳过 (-SkipDatabase)"
}

Write-Host ""
if ($SkipFiles) {
    Write-Host "媒体/上传目录：已跳过 (-SkipFiles)"
}
else {
    Write-Host "将清理的目录："
    $directorySummaries | Format-Table -AutoSize
}

if ($OptimizeStartupArtifacts) {
    Write-Host ""
    Write-Host "将自动优化清理的本地产物："
    $startupOptimizationSummaries | Format-Table -AutoSize
}

if ($ReclaimWorkspaceStorage) {
    Write-Host ""
    Write-Host "将回收的工作区重缓存："
    Write-Host "- cargo clean（清空整个 target/）"
    $workspaceStorageSummaries | Format-Table -AutoSize
}

Write-Host ""
Write-Host "不会触碰的目录：src/ frontend/ docs/ migrations/ tests/ assets/"
Write-Host "不会触碰的数据库对象：迁移元数据表、schema、角色、扩展。"
if ($OptimizeStartupArtifacts) {
    Write-Host "自动优化不会触碰：target/debug、target/launcher-run、target/flycheck0、frontend/dist、frontend/node_modules、数据库业务表、data/attachments。"
}
if ($ReclaimWorkspaceStorage) {
    Write-Host "工作区重清理不会默认随 run.ps1 启动；它会导致下次 Rust 全量重编译、前端重新安装依赖。"
}

Write-Host ""
Write-Host "浏览器端如需彻底重置媒体/离线缓存，仍可手动清理："
Write-Host "- 房间锚点 koko_current_room_id / koko_current_room_code / koko_home_sessions 现在会在 room_not_found 时自动自愈，通常不用手清。"
Write-Host "- localStorage: koko_media_asset_records"
Write-Host "- IndexedDB: koko-offline-tasks"
Write-Host "- Cache Storage: koko-image-blob-assets"
Write-Host "- Chrome DevTools -> Application -> Clear storage -> http://127.0.0.1:$AppPort/"

if ($Preview -and $Apply) {
    throw "-Preview 与 -Apply 不能同时使用。"
}

if ($Preview) {
    Write-Host ""
    Write-Host "当前是预览模式；默认直接执行清理。"
    Write-Host "真正执行："
    if ($OptimizeStartupArtifacts) {
        Write-Host ".\\qingli.ps1 -Apply -OptimizeStartupArtifacts"
    }
    elseif ($ReclaimWorkspaceStorage) {
        Write-Host ".\\qingli.ps1 -Apply -ReclaimWorkspaceStorage"
    }
    else {
        Write-Host ".\\qingli.ps1 -Apply"
    }
    Write-Host "如需跳过确认："
    if ($OptimizeStartupArtifacts) {
        Write-Host ".\\qingli.ps1 -Apply -Force -OptimizeStartupArtifacts"
    }
    elseif ($ReclaimWorkspaceStorage) {
        Write-Host ".\\qingli.ps1 -Apply -Force -ReclaimWorkspaceStorage"
    }
    else {
        Write-Host ".\\qingli.ps1 -Apply -Force"
    }
    return
}

$servicePorts = @($AppPort, $TrackerPort, $SeederPort, $TusPort)
if ($Force) {
    Write-Host ""
    Write-Host "Force 模式：尝试自动停止已识别的项目开发服务..."
    $stoppedServices = Stop-RecognizedProjectServices `
        -Ports $servicePorts `
        -RepoRoot $RepoRoot `
        -AppPort $AppPort `
        -TrackerPort $TrackerPort `
        -SeederPort $SeederPort `
        -TusPort $TusPort `
        -TusUploadDir (Resolve-ManagedPath -RawPath $TusUploadDir)
    if ($stoppedServices.Count -eq 0) {
        Write-Host "未发现可自动停止的项目开发服务；继续检查端口占用。"
    }
    else {
        Start-Sleep -Milliseconds 800
    }
}

Assert-ServicesStopped -Ports $servicePorts

if (-not $Force) {
    $confirmationPrompt = if ($ReclaimWorkspaceStorage -and (-not $SkipDatabase -or -not $SkipFiles)) {
        "确认执行？这会回收工作区重缓存，并按当前开关处理数据库或媒体目录。输入 YES 继续"
    }
    elseif ($ReclaimWorkspaceStorage) {
        "确认执行？这会执行 cargo clean，并删除 node_modules / dist / .tsbuildinfo / tmp。输入 YES 继续"
    }
    elseif ($OptimizeStartupArtifacts -and (-not $SkipDatabase -or -not $SkipFiles)) {
        "确认执行？这会清理启动器/烟测本地产物，并按当前开关处理数据库或媒体目录。输入 YES 继续"
    }
    elseif ($OptimizeStartupArtifacts) {
        "确认执行？这会清理启动器/烟测本地产物。输入 YES 继续"
    }
    else {
        "确认执行？这会清空测试业务数据和媒体目录。输入 YES 继续"
    }
    $confirmation = Read-Host $confirmationPrompt
    if ($confirmation -ne "YES") {
        Write-Host "已取消。"
        return
    }
}

if (-not $SkipDatabase) {
    $psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
    if (-not $psqlCommand) {
        throw "未找到 psql.exe；无法执行数据库清理。"
    }
    $psqlPath = $psqlCommand.Source

    Write-Host ""
    Write-Host "清空数据库业务表..."
    Invoke-DatabaseCleanup -PsqlPath $psqlPath -DbUrl $DatabaseUrl -Password $DbPassword
}

if (-not $SkipFiles) {
    Write-Host ""
    Write-Host "清空媒体/上传目录..."
    foreach ($dir in $managedDirectories) {
        Write-Host "  -> $dir"
        Clear-DirectoryContents -Path $dir
    }
}

if ($OptimizeStartupArtifacts) {
    Write-Host ""
    Write-Host "清理启动器/烟测本地产物..."
    foreach ($target in $startupOptimizationTargets) {
        Write-Host "  -> $($target.Path)"
        Clear-CleanupTarget -Target $target
    }
}

if ($ReclaimWorkspaceStorage) {
    Write-Host ""
    Write-Host "回收工作区重缓存..."
    Invoke-CargoWorkspaceClean -RepoRoot $RepoRoot
    foreach ($target in $workspaceStorageTargets) {
        Write-Host "  -> $($target.Path)"
        Clear-CleanupTarget -Target $target
    }
}

Write-Host ""
Write-Host "清理完成。"
Write-Host "建议下一步："
Write-Host "1. 如需连浏览器媒体/离线缓存也一起归零，再打开 Chrome DevTools 清掉该站点的 localStorage / IndexedDB / Cache Storage。"
Write-Host "2. 重新启动项目，再开始新一轮群聊联测。"

param(
    [switch]$Apply,
    [switch]$Preview,
    [switch]$Force,
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
        $PortRecord.CommandLine -match 'dev-tracker\.mjs' -and
        $PortRecord.CommandLine -match ("--port\s+$TrackerPort(\s|$)")
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
        $PortRecord.CommandLine -match ("--port\s+$SeederPort(\s|$)")
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
Write-Host "将清理的目录："
$directorySummaries | Format-Table -AutoSize

Write-Host ""
Write-Host "不会触碰的目录：src/ frontend/ docs/ migrations/ tests/ assets/"
Write-Host "不会触碰的数据库对象：迁移元数据表、schema、角色、扩展。"

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
    Write-Host ".\\qingli.ps1 -Apply"
    Write-Host "如需跳过确认："
    Write-Host ".\\qingli.ps1 -Apply -Force"
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
    $confirmation = Read-Host "确认执行？这会清空测试业务数据和媒体目录。输入 YES 继续"
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

Write-Host ""
Write-Host "清理完成。"
Write-Host "建议下一步："
Write-Host "1. 如需连浏览器媒体/离线缓存也一起归零，再打开 Chrome DevTools 清掉该站点的 localStorage / IndexedDB / Cache Storage。"
Write-Host "2. 重新启动项目，再开始新一轮群聊联测。"

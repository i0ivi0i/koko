param(
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
        throw "检测到本地服务仍在运行，拒绝清理。请先停止这些端口对应的项目进程：$($listening -join ', ')"
    }
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
$RustusPort = [int](Get-ConfigValue -DotEnv $dotEnv -Key "RUSTUS_SERVER_PORT" -Fallback "1081")

$managedDirectories = @(
    Resolve-ManagedPath -RawPath $AttachmentDir
    Resolve-ManagedPath -RawPath $RustusDataDir
    Resolve-ManagedPath -RawPath $RustusInfoDir
    Resolve-ManagedPath -RawPath $RustusVerifyDir
    Resolve-ManagedPath -RawPath $RustusInfoVerifyDir
)

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
Write-Host "浏览器端仍建议手动清理："
Write-Host "- localStorage: koko_current_room_id / koko_current_room_code / koko_device_anonymous_token / koko_home_sessions / koko_media_asset_records"
Write-Host "- IndexedDB: koko-offline-tasks"
Write-Host "- Cache Storage: koko-image-blob-assets"
Write-Host "- Chrome DevTools -> Application -> Clear storage -> http://127.0.0.1:$AppPort/"

if ($Preview) {
    Write-Host ""
    Write-Host "当前是预览模式；默认直接执行清理。"
    Write-Host "真正执行："
    Write-Host ".\\qingli.ps1"
    Write-Host "如需跳过确认："
    Write-Host ".\\qingli.ps1 -Force"
    return
}

Assert-ServicesStopped -Ports @($AppPort, $TrackerPort, $RustusPort)

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
Write-Host "1. 打开 Chrome DevTools 清掉该站点的 localStorage / IndexedDB / Cache Storage。"
Write-Host "2. 重新启动项目，再开始新一轮群聊联测。"

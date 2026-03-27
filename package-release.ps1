param(
    [string]$Version = "dev",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Require-Path {
    param(
        [string]$Path,
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "缺少 ${Label}: ${Path}"
    }
}

function Ensure-CleanDir {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }

    New-Item -ItemType Directory -Path $Path | Out-Null
}

function New-TarGz {
    param(
        [string]$SourcePath,
        [string]$ArchivePath
    )

    $parent = Split-Path -Parent $ArchivePath
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent | Out-Null
    }

    tar -czf $ArchivePath -C $SourcePath .
}

function Resolve-FirstExistingPath {
    param(
        [string[]]$Candidates,
        [string]$Label
    )

    foreach ($candidate in $Candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $Candidates[0]
}

$repoRoot = Resolve-Path $PSScriptRoot
$releaseRoot = Join-Path $repoRoot "target\\release-artifacts\\$Version"
$stagingRoot = Join-Path $repoRoot "target\\release-staging\\$Version"

$serverBinary = Resolve-FirstExistingPath -Candidates @(
    (Join-Path $repoRoot "target\\release\\koko-server"),
    (Join-Path $repoRoot "target\\release\\koko-server.exe")
) -Label "后端发布二进制"
$webDist = Resolve-FirstExistingPath -Candidates @(
    (Join-Path $repoRoot "target\\dx\\koko-web\\release\\web\\public")
) -Label "聊天前台构建产物"
$adminDist = Resolve-FirstExistingPath -Candidates @(
    (Join-Path $repoRoot "target\\dx\\koko-admin\\release\\web\\public")
) -Label "后台前端构建产物"
$migrationsDir = Join-Path $repoRoot "migrations"

$serverStage = Join-Path $stagingRoot "server"
$webStage = Join-Path $stagingRoot "web"
$adminStage = Join-Path $stagingRoot "admin"
$migrationsStage = Join-Path $stagingRoot "migrations"

$serverArchive = Join-Path $releaseRoot "koko-server-linux-x86_64.tar.gz"
$webArchive = Join-Path $releaseRoot "koko-web.tar.gz"
$adminArchive = Join-Path $releaseRoot "koko-admin.tar.gz"
$migrationsArchive = Join-Path $releaseRoot "koko-migrations.tar.gz"

Write-Host "准备打包版本: $Version"
Write-Host "后端二进制: $serverBinary"
Write-Host "聊天前台: $webDist"
Write-Host "后台前端: $adminDist"
Write-Host "迁移目录: $migrationsDir"
Write-Host "输出目录: $releaseRoot"

if ($DryRun) {
    Write-Host "[dry-run] 将生成:"
    Write-Host "[dry-run] $serverArchive"
    Write-Host "[dry-run] $webArchive"
    Write-Host "[dry-run] $adminArchive"
    Write-Host "[dry-run] $migrationsArchive"
    exit 0
}

Require-Path -Path $serverBinary -Label "后端发布二进制"
Require-Path -Path $webDist -Label "聊天前台构建产物"
Require-Path -Path $adminDist -Label "后台前端构建产物"
Require-Path -Path $migrationsDir -Label "数据库迁移目录"

Ensure-CleanDir -Path $releaseRoot
Ensure-CleanDir -Path $stagingRoot
Ensure-CleanDir -Path $serverStage
Ensure-CleanDir -Path $webStage
Ensure-CleanDir -Path $adminStage
Ensure-CleanDir -Path $migrationsStage

Copy-Item -LiteralPath $serverBinary -Destination (Join-Path $serverStage "koko-server")
Copy-Item -Path (Join-Path $webDist "*") -Destination $webStage -Recurse
Copy-Item -Path (Join-Path $adminDist "*") -Destination $adminStage -Recurse
Copy-Item -Path (Join-Path $migrationsDir "*") -Destination $migrationsStage -Recurse

New-TarGz -SourcePath $serverStage -ArchivePath $serverArchive
New-TarGz -SourcePath $webStage -ArchivePath $webArchive
New-TarGz -SourcePath $adminStage -ArchivePath $adminArchive
New-TarGz -SourcePath $migrationsStage -ArchivePath $migrationsArchive

Write-Host "发布产物已生成。"

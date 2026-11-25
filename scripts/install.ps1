# SAF Kanban CLI installer for Windows (PowerShell 5.1+ / PowerShell 7+)
#
# Install or upgrade:
#   irm https://whlshy.github.io/SAF_Kanban/install.ps1 | iex
#
# Optional environment variables:
#   $env:SAF_KANBAN_VERSION      Specific version (e.g. "0.6.0" or "desktop-v0.6.0")
#   $env:SAF_KANBAN_INSTALL_DIR  Install directory (default: %LOCALAPPDATA%\saf-kanban-cli\bin)
#   $env:SAF_KANBAN_NO_PATH=1    Do not add install directory to user PATH
#   $env:SAF_KANBAN_UNINSTALL=1  Remove saf-kanban-cli and clean user PATH

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'whlshy/SAF_Kanban'
$InstallDir = if ($env:SAF_KANBAN_INSTALL_DIR) {
  $env:SAF_KANBAN_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA 'saf-kanban-cli\bin'
}
$ExePath = Join-Path $InstallDir 'saf-kanban-cli.exe'

function Remove-FromUserPath([string]$Dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $current) { return }
  $normalized = $Dir.TrimEnd('\')
  $parts = $current -split ';' | Where-Object {
    $_ -and ($_.TrimEnd('\') -ine $normalized)
  }
  $next = ($parts -join ';')
  if ($next -ne $current) {
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    Write-Host "Removed $Dir from user PATH."
  }
}

function Add-ToUserPath([string]$Dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $normalized = $Dir.TrimEnd('\')
  $entries = if ($current) { $current -split ';' | Where-Object { $_ } } else { @() }
  $exists = $entries | Where-Object { $_.TrimEnd('\') -ieq $normalized }
  if (-not $exists) {
    $next = if ($entries.Count -gt 0) { ($entries + $Dir) -join ';' } else { $Dir }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    Write-Host "Added $Dir to user PATH."
  }
  $sessionEntries = ($env:Path -split ';') | Where-Object { $_ }
  if (-not ($sessionEntries | Where-Object { $_.TrimEnd('\') -ieq $normalized })) {
    $env:Path = "$Dir;$env:Path"
  }
}

if ($env:SAF_KANBAN_UNINSTALL -eq '1') {
  if (Test-Path $ExePath) {
    Remove-Item -Force $ExePath
    Write-Host "Removed $ExePath"
  } else {
    Write-Host "saf-kanban-cli was not found at $ExePath"
  }
  Remove-FromUserPath $InstallDir
  if ((Test-Path $InstallDir) -and -not (Get-ChildItem -Force $InstallDir)) {
    Remove-Item -Force $InstallDir
  }
  Write-Host 'Done. Board files in %APPDATA%\SAF Kanban were kept.'
  return
}

if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'SAF Kanban CLI currently requires 64-bit Windows (x64).'
}

function Resolve-ReleaseTag([string]$Requested) {
  if ($Requested) {
    if ($Requested -match '^desktop-v') { return $Requested }
    $clean = $Requested.TrimStart('v')
    return "desktop-v$clean"
  }
  # Follow /releases/latest redirect to avoid unauthenticated GitHub API rate limits.
  $latestUrl = "https://github.com/$Repo/releases/latest"
  try {
    $req = [System.Net.HttpWebRequest]::Create($latestUrl)
    $req.AllowAutoRedirect = $true
    $req.UserAgent = 'saf-kanban-cli-installer'
    $resp = $req.GetResponse()
    $finalUri = $resp.ResponseUri.AbsoluteUri
    $resp.Close()
    if ($finalUri -match '/releases/tag/([^/?#]+)$') {
      return $Matches[1]
    }
  } catch {
    # Fall back to GitHub REST API below.
  }
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'saf-kanban-cli-installer' }
  if (-not $release.tag_name) {
    throw "Couldn't determine the latest SAF Kanban release."
  }
  return $release.tag_name
}

$Tag = Resolve-ReleaseTag $env:SAF_KANBAN_VERSION
$Version = $Tag -replace '^desktop-v', ''
$Asset = "saf-kanban-cli-$Version-windows-x64.zip"
$BaseUrl = "https://github.com/$Repo/releases/download/$Tag"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("saf-kanban-cli-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  $ZipPath = Join-Path $TempDir $Asset
  $SumsPath = Join-Path $TempDir 'SHA256SUMS.txt'

  Write-Host "Downloading SAF Kanban CLI $Version ($Asset)..."
  Invoke-WebRequest -Uri "$BaseUrl/$Asset" -OutFile $ZipPath -UseBasicParsing
  Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS.txt" -OutFile $SumsPath -UseBasicParsing

  $expectedLine = Get-Content $SumsPath | Where-Object { $_ -match "\s+\*?$([regex]::Escape($Asset))$" } | Select-Object -First 1
  if (-not $expectedLine) {
    throw "SHA256SUMS.txt does not contain an entry for $Asset."
  }
  $expectedHash = ($expectedLine -split '\s+')[0].ToLowerInvariant()
  $actualHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "SHA-256 checksum mismatch for $Asset (expected $expectedHash, got $actualHash)."
  }

  Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force
  $Extracted = Join-Path $TempDir 'saf-kanban-cli.exe'
  if (-not (Test-Path $Extracted)) {
    throw "saf-kanban-cli.exe was not found inside $Asset."
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Force $Extracted $ExePath

  if ($env:SAF_KANBAN_NO_PATH -ne '1') {
    Add-ToUserPath $InstallDir
  }

  $InstalledVersion = (& $ExePath --version)
  Write-Host ""
  Write-Host "Installed $InstalledVersion to $ExePath" -ForegroundColor Green
  Write-Host "Next steps:"
  Write-Host "  saf-kanban-cli boards           # List your boards"
  Write-Host "  saf-kanban-cli skill --install  # Install the AI agent skill (Claude Code, Codex, Cursor, Antigravity, ...)"
  if ($env:SAF_KANBAN_NO_PATH -ne '1') {
    Write-Host ""
    Write-Host "Open a new terminal if `saf-kanban-cli` is not recognized in other windows."
  }
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
  }
}

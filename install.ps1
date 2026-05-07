# graphify-fleet installer — one-line install (Windows / PowerShell)
#
# Usage:
#   irm https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.ps1 | iex
#
# Or with options:
#   $args = @{ Branch = 'main' }
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.ps1))) @args
#
# What it does:
#   1. Verifies prerequisites (git, node 18.19+, uv, python 3.10+) and installs missing ones via winget when possible
#   2. Clones graphify-fleet to %USERPROFILE%\.graphify-fleet (or pulls if it already exists)
#   3. Runs `npm install`
#   4. Adds bin\ to user PATH and creates a gfleet.cmd shim
#   5. Runs `gfleet doctor`
#   6. Prints next steps

#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [string]$RepoUrl = 'https://github.com/cajasmota/graphify-fleet.git',
    [string]$InstallDir = (Join-Path $env:USERPROFILE '.graphify-fleet'),
    [string]$BinDir = (Join-Path $env:USERPROFILE '.local\bin')
)

$ErrorActionPreference = 'Stop'

function Say($m)   { Write-Host $m }
function Ok($m)    { Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m)  { Write-Host "! $m" -ForegroundColor Yellow }
function Err($m)   { Write-Host "✗ $m" -ForegroundColor Red }
function Info($m)  { Write-Host "  $m" }
function Hr        { Write-Host ('─' * 45) -ForegroundColor DarkGray }

Say ''
Write-Host 'graphify-fleet installer (Windows)' -ForegroundColor Green
Hr
Say "install to:  $InstallDir"
Say "bin dir:     $BinDir"
Say "branch:      $Branch"
Say ''

# ----- helpers -----
function Test-Cmd($name) {
    return [bool] (Get-Command $name -ErrorAction SilentlyContinue)
}

# Microsoft Store ships a "python.exe" stub at %LOCALAPPDATA%\Microsoft\WindowsApps
# that, when executed, opens the Store. Detect and skip it so we don't accidentally
# launch the Store mid-install.
function Test-RealPython {
    $cmd = Get-Command 'python' -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    $src = $cmd.Source
    if ($src -and $src -match '\\WindowsApps\\') { return $null }  # Store stub
    return $src
}

function Install-ViaWinget($id, $friendlyName) {
    if (-not (Test-Cmd 'winget')) {
        Err "$friendlyName not installed and winget is unavailable. Install $friendlyName manually and re-run this script."
        Info "  Without winget, the easiest install path is via Microsoft Store."
        return $false
    }
    Info "Installing $friendlyName via winget..."
    & winget install --id $id --silent --accept-package-agreements --accept-source-agreements
    return $?
}

# ----- prerequisites -----

# git
if (Test-Cmd 'git') {
    Ok "git: $((git --version) -split ' ' | Select-Object -Last 1)"
} else {
    Warn 'git not found'
    if (-not (Install-ViaWinget 'Git.Git' 'Git')) { exit 1 }
    # Refresh PATH for this session
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    if (-not (Test-Cmd 'git')) { Err 'git install completed but PATH not refreshed. Restart PowerShell and re-run.'; exit 1 }
    Ok 'git installed'
}

# node 18.19+
$needNode = $true
if (Test-Cmd 'node') {
    $nodeVer = (node -v).TrimStart('v')
    $nodeMajor = [int]($nodeVer -split '\.')[0]
    if ($nodeMajor -ge 18) {
        Ok "node: v$nodeVer"
        $needNode = $false
    } else {
        Warn "node v$nodeVer is too old (need 18.19+)"
    }
}

if ($needNode) {
    if (-not (Install-ViaWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS')) { exit 1 }
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    if (-not (Test-Cmd 'node')) { Err 'node install completed but PATH not refreshed. Restart PowerShell and re-run.'; exit 1 }
    Ok "node installed: $(node -v)"
}

# uv
if (Test-Cmd 'uv') {
    Ok "uv: $(uv --version)"
} else {
    Warn 'uv not found; installing via official PowerShell installer'
    try {
        Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
        $env:Path = (Join-Path $env:USERPROFILE '.local\bin') + ';' + $env:Path
        if (Test-Cmd 'uv') {
            Ok "uv installed: $(uv --version)"
        } else {
            Warn 'uv install completed but binary not on PATH. Restart PowerShell, then re-run this installer or run: gfleet doctor'
        }
    } catch {
        Err "uv install failed: $_"
        Info '  Install manually:  https://docs.astral.sh/uv/getting-started/installation/'
        exit 1
    }
}

# python 3.10+ (uv can install Python on demand for graphify)
# Prefer the Windows 'py' launcher when present; otherwise check 'python'
# but skip the Microsoft Store stub at %LOCALAPPDATA%\Microsoft\WindowsApps.
$realPython = Test-RealPython
$pyCheckCmd = $null
if (Test-Cmd 'py') {
    $pyCheckCmd = 'py'
} elseif ($realPython) {
    $pyCheckCmd = 'python'
}

if ($pyCheckCmd) {
    try {
        $pyVer = (& $pyCheckCmd --version 2>&1) -replace 'Python ',''
        $parts = $pyVer -split '\.'
        $pyMajor = [int]$parts[0]
        $pyMinor = if ($parts.Count -ge 2) { [int]($parts[1] -replace '\D','') } else { 0 }
        if ($pyMajor -ge 3 -and $pyMinor -ge 10) {
            Ok "python: $pyVer (via $pyCheckCmd)"
        } else {
            Warn "python $pyVer is too old (need 3.10+); uv will provision one for graphify"
        }
    } catch {
        Warn 'python version unclear; uv will provision one for graphify on first use'
    }
} else {
    Warn 'python not found (or only the Microsoft Store stub is present); uv will provision one for graphify on first use'
}

Say ''
Hr

# ----- clone or pull -----
if (Test-Path (Join-Path $InstallDir '.git')) {
    Info "Updating existing install at $InstallDir..."
    Push-Location $InstallDir
    try {
        git fetch --quiet origin $Branch
        git checkout --quiet $Branch
        try {
            git pull --quiet --ff-only origin $Branch
            Ok 'repo updated'
        } catch {
            Warn 'git pull failed (probably uncommitted changes); skipping update'
        }
    } finally { Pop-Location }
} else {
    if (Test-Path $InstallDir) {
        Err "$InstallDir exists but isn't a git repo. Move/remove it and re-run."
        exit 1
    }
    Info "Cloning $RepoUrl → $InstallDir..."
    git clone --quiet --branch $Branch $RepoUrl $InstallDir
    Ok 'repo cloned'
}

# ----- npm install -----
Say ''
Info "Running npm install in $InstallDir..."
Push-Location $InstallDir
try {
    npm install --silent --no-audit --no-fund | Out-Null
    Ok 'node deps installed'
} finally { Pop-Location }

# ----- create gfleet.cmd shim and add bin to PATH -----
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Force -Path $BinDir | Out-Null }
$gfleetTarget = Join-Path $InstallDir 'bin\gfleet'
$gfleetCmd = Join-Path $BinDir 'gfleet.cmd'

# Windows .cmd shim that invokes node on the JS shim.
# Note: bin/gfleet has no .js extension but Node treats it as ESM via the
# repo's package.json "type":"module". The .cmd verifies node is on PATH at
# invocation time so we get a clear error rather than a cryptic one.
@"
@echo off
where node >NUL 2>NUL
if errorlevel 1 (
    echo gfleet: 'node' not found on PATH. Install Node 18.19+ or open a fresh shell. 1>&2
    exit /b 1
)
node "$gfleetTarget" %*
"@ | Set-Content -Path $gfleetCmd -Encoding ascii

Ok "shim written: $gfleetCmd"

# Add BinDir to user PATH if missing.
# Re-read the User PATH at write time to minimize the read/write race window
# with other processes mutating user PATH.
function Normalize-PathEntry($p) {
    if (-not $p) { return '' }
    return ($p.TrimEnd('\','/').ToLowerInvariant())
}
$binNorm = Normalize-PathEntry $BinDir
$userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @()
if ($userPath) { $entries = $userPath -split ';' }
$alreadyPresent = $false
foreach ($e in $entries) {
    if ((Normalize-PathEntry $e) -eq $binNorm) { $alreadyPresent = $true; break }
}
if (-not $alreadyPresent) {
    # Re-read just before write to shrink the race window.
    $userPathLatest = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $sep = if ($userPathLatest -and -not $userPathLatest.EndsWith(';')) { ';' } else { '' }
    $newPath = "$userPathLatest$sep$BinDir"
    [System.Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Ok "added $BinDir to user PATH"
    Warn 'Open a new PowerShell window to use the new PATH (current session has been updated)'
    $env:Path = "$env:Path;$BinDir"
} else {
    Ok "$BinDir already on PATH"
}

# ----- run doctor -----
Say ''
Hr
Info 'Running gfleet doctor...'
Say ''
try {
    & node $gfleetTarget doctor
} catch {
    Warn "gfleet doctor failed in this session — try a fresh PowerShell window: gfleet doctor"
}

# ----- next steps -----
Say ''
Hr
Ok 'graphify-fleet installed'
Say ''
Say 'Next steps:'
Say ''
Say '  • First time setting up?  Run the wizard:'
Say '      gfleet wizard'
Say ''
Say '  • Joining a team that already uses gfleet?'
Say '      cd <some-cloned-repo>'
Say '      gfleet onboard'
Say ''
Say '  • Update later:'
Say '      irm https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.ps1 | iex'
Say ''
Say "Docs: $InstallDir\README.md"

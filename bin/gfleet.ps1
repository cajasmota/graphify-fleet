# gfleet — graphify-fleet (Windows / PowerShell 7+)
# Mirror of the bash entrypoint. Usage: pwsh gfleet.ps1 <command> <args>
#   gfleet.ps1 doctor
#   gfleet.ps1 install   <config.json>
#   gfleet.ps1 uninstall <config.json>
#   gfleet.ps1 status    <config.json>
#   gfleet.ps1 rebuild   <config.json> [slug]
#   gfleet.ps1 remerge   <config.json>
#   gfleet.ps1 start|stop|restart <config.json>
#
# Implementation notes:
# - Watchers run as Scheduled Tasks (one per repo, "ai.graphify.fleet.<group>.<slug>").
# - graphify is installed via uv with mcp+watchdog extras.
# - Per-repo .mcp.json + .windsurfrules are written the same way as on POSIX.

#requires -Version 7
[CmdletBinding()]
param([Parameter(Mandatory=$true,Position=0)][string]$Command,
      [Parameter(Position=1)][string]$ConfigPath,
      [Parameter(Position=2)][string]$Target)

$ErrorActionPreference = 'Stop'
$Version = '0.1.0'
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootDir     = Split-Path -Parent $ScriptDir
$Templates   = Join-Path $RootDir 'templates'
$GraphifyDir = if ($env:GRAPHIFY_DIR) { $env:GRAPHIFY_DIR } else { Join-Path $env:USERPROFILE '.graphify' }
$GroupsDir   = Join-Path $GraphifyDir 'groups'
$LocalBin    = Join-Path $env:USERPROFILE '.local\bin'
New-Item -ItemType Directory -Force -Path $GroupsDir, $LocalBin | Out-Null

function Say($msg)   { Write-Host $msg }
function Ok($msg)    { Write-Host "✓ $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "! $msg" -ForegroundColor Yellow }
function Err($msg)   { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }
function Info($msg)  { Write-Host "  $msg" }
function Hr           { Write-Host ('─' * 45) -ForegroundColor DarkGray }

function Need-Cmd($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { Err "missing required command: $name" }
}

function Expand-Path([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return $p }
    if ($p.StartsWith('~')) { return Join-Path $env:USERPROFILE $p.Substring(1).TrimStart('/','\') }
    return $p
}

function Get-GraphifyPython {
    $bin = (Get-Command graphify -ErrorAction Stop).Path
    # uv tool installs put graphify.exe alongside python.exe
    $py = Join-Path (Split-Path $bin -Parent) 'python.exe'
    if (Test-Path $py) { return $py } else { return 'python' }
}

function Ensure-Graphify {
    if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) {
        Info "installing graphifyy via uv (with mcp + watchdog extras)..."
        uv tool install graphifyy --with mcp --with watchdog | Out-Null
    } else {
        $py = Get-GraphifyPython
        & $py -c "import mcp, watchdog" 2>$null
        if ($LASTEXITCODE -ne 0) {
            Info "adding mcp + watchdog extras..."
            uv tool install graphifyy --with mcp --with watchdog --reinstall | Out-Null
        }
    }
}

function Load-Config([string]$path) {
    if (-not (Test-Path $path)) { Err "config not found: $path" }
    $json = Get-Content $path -Raw | ConvertFrom-Json
    if (-not $json.group)  { Err "config missing 'group'"    }
    if (-not $json.repos)  { Err "config has no repos"        }
    $script:Group       = $json.group
    $script:GroupGraph  = Join-Path $GroupsDir "$($json.group).json"
    $script:Repos       = @($json.repos | ForEach-Object {
        [pscustomobject]@{
            Path  = Expand-Path $_.path
            Slug  = $_.slug
            Stack = if ($_.stack) { $_.stack } else { 'generic' }
        }
    })
    $script:OptWiki      = if ($null -ne $json.options.wiki_gitignored) { $json.options.wiki_gitignored } else { $true }
    $script:OptWatchers  = if ($null -ne $json.options.watchers)        { $json.options.watchers        } else { $true }
    $script:OptWindsurf  = if ($null -ne $json.options.windsurf)        { $json.options.windsurf        } else { $true }
    $script:OptClaude    = if ($null -ne $json.options.claude_code)     { $json.options.claude_code     } else { $true }
}

function Watcher-Name([string]$slug) { "ai.graphify.fleet.$Group.$slug" }

# --- per-repo install pieces ---
function Write-Graphifyignore($repo, $stack) {
    $tpl = Join-Path $Templates "graphifyignore-$stack.txt"
    if (-not (Test-Path $tpl)) { $tpl = Join-Path $Templates 'graphifyignore-generic.txt' }
    $dst = Join-Path $repo '.graphifyignore'
    if (-not (Test-Path $dst)) { Copy-Item $tpl $dst; Info ".graphifyignore written ($stack template)" }
    else { Info ".graphifyignore already exists, leaving as-is" }
}

function Update-Gitignore($repo) {
    $f = Join-Path $repo '.gitignore'
    if (-not (Test-Path $f)) { New-Item $f -ItemType File | Out-Null }
    if (Select-String -Path $f -Pattern '^graphify-out/wiki/' -Quiet) { return }
    Add-Content $f "`n# graphify-fleet`ngraphify-out/wiki/`ngraphify-out/manifest.json`ngraphify-out/cost.json`ngraphify-out/cache/"
    Info ".gitignore updated"
}

function Write-McpJson($repo) {
    $f = Join-Path $repo '.mcp.json'
    $py = Get-GraphifyPython
    $server = [pscustomobject]@{ command = $py; args = @('-m','graphify.serve',$GroupGraph) }
    if (Test-Path $f) {
        $obj = Get-Content $f -Raw | ConvertFrom-Json -AsHashtable
        if (-not $obj.mcpServers) { $obj.mcpServers = @{} }
        $obj.mcpServers.graphify = $server
        $obj | ConvertTo-Json -Depth 8 | Set-Content $f
    } else {
        @{ mcpServers = @{ graphify = $server } } | ConvertTo-Json -Depth 8 | Set-Content $f
    }
    Info ".mcp.json: graphify -> $GroupGraph"
}

function Write-WindsurfFiles($repo) {
    $wfDir = Join-Path $repo '.windsurf\workflows'
    New-Item -ItemType Directory -Force -Path $wfDir | Out-Null
    Copy-Item (Join-Path $Templates 'windsurf-workflow.md') (Join-Path $wfDir 'graphify.md') -Force

    $rules = Join-Path $repo '.windsurfrules'
    if (Test-Path $rules) {
        if (Select-String -Path $rules -Pattern '^## graphify' -Quiet) { return }
    }
    $block = @"

## graphify

This project is part of the **$Group** group, with a merged knowledge graph at $GroupGraph.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-repo questions, query the graphify MCP server (group: $Group) which exposes the merged graph
- After modifying code in this session, run ``graphify update .`` to keep the graph current
"@
    Add-Content $rules $block
    Info "windsurf workflow + rules written"
}

function Install-ClaudeSkill($repo) {
    Push-Location $repo
    try { graphify claude install | Out-Null; Info "claude skill installed" }
    catch { Warn "graphify claude install failed (continuing)" }
    finally { Pop-Location }
}

function Build-InitialGraph($repo) {
    if (-not (Test-Path (Join-Path $repo 'graphify-out\graph.json'))) {
        Info "building initial AST graph (this can take 30-90s)..."
        Push-Location $repo
        try { graphify update . | Out-Null } catch { Warn "initial graphify update failed" }
        finally { Pop-Location }
    }
}

function Write-RemergeHelper {
    $helper = Join-Path $LocalBin "graphify-fleet-merge-$Group.ps1"
    $graphs = $Repos | ForEach-Object { "'" + (Join-Path $_.Path 'graphify-out\graph.json') + "'" }
    $script = @"
# auto-generated by gfleet — re-merge group '$Group'
`$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Seconds 3
`$graphs = @($($graphs -join ','))
`$existing = `$graphs | Where-Object { Test-Path `$_ }
if (`$existing.Count -ge 2) {
    & graphify merge-graphs `$existing --out '$GroupGraph' | Out-Null
} elseif (`$existing.Count -eq 1) {
    Copy-Item `$existing[0] '$GroupGraph' -Force
}
"@
    Set-Content -Path $helper -Value $script -Encoding utf8
}

function Install-GitHooks($repo, $slug) {
    Push-Location $repo
    try { graphify hook install | Out-Null } catch { Warn "graphify hook install failed" }
    finally { Pop-Location }

    $helper = Join-Path $LocalBin "graphify-fleet-merge-$Group.ps1"
    foreach ($hook in @('post-commit','post-checkout')) {
        $f = Join-Path $repo ".git\hooks\$hook"
        if (-not (Test-Path $f)) { continue }
        if (Select-String -Path $f -Pattern "graphify-fleet-merge-$Group" -Quiet) { continue }
        Add-Content $f "`n# gfleet-start ($Group)`npwsh -NoProfile -File `"$helper`" 2>$null &`n# gfleet-end ($Group)"
    }
    Info "git hooks installed (+ group remerge)"
}

# --- watchers (Scheduled Tasks) ---
function Install-WatcherWindows($repo, $slug) {
    $name = Watcher-Name $slug
    $graphifyBin = (Get-Command graphify).Path
    $logDir = Join-Path $env:USERPROFILE ".cache\graphify-fleet\$Group"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null

    $action  = New-ScheduledTaskAction -Execute $graphifyBin -Argument "watch `"$repo`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Info "watcher loaded: $name"
}

function Uninstall-WatcherWindows($slug) {
    $name = Watcher-Name $slug
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
}

function Watcher-Status($slug) {
    $name = Watcher-Name $slug
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if (-not $task) { '{0,-50} {1}' -f $name,'not registered'; return }
    $info = Get-ScheduledTaskInfo $name
    '{0,-50} state={1} last={2}' -f $name, $task.State, $info.LastTaskResult
}

# === COMMANDS ===
function Cmd-Doctor {
    Say "graphify-fleet $Version — doctor"
    Hr
    Say "platform: windows"
    foreach ($c in @('git','uv')) {
        if (Get-Command $c -ErrorAction SilentlyContinue) { Ok "$c found" } else { Warn "$c missing" }
    }
    if (Get-Command graphify -ErrorAction SilentlyContinue) {
        Ok "graphify found"
        $py = Get-GraphifyPython
        & $py -c "import mcp, watchdog" 2>$null
        if ($LASTEXITCODE -eq 0) { Ok "graphify extras: mcp + watchdog" } else { Warn "missing extras (install will fix)" }
    } else { Warn "graphify not installed (install will fix)" }
}

function Cmd-Install($cfg) {
    Need-Cmd git; Need-Cmd uv
    Load-Config $cfg
    Ensure-Graphify
    Say "installing fleet group: $Group"
    Say "merged graph -> $GroupGraph"
    Hr
    Write-RemergeHelper
    foreach ($r in $Repos) {
        Say ""
        Write-Host "▸ $($r.Slug)  [$($r.Stack)]" -ForegroundColor Green
        Info $r.Path
        if (-not (Test-Path (Join-Path $r.Path '.git'))) { Warn "not a git repo, skipping"; continue }
        Write-Graphifyignore $r.Path $r.Stack
        Update-Gitignore     $r.Path
        Build-InitialGraph   $r.Path
        Write-McpJson        $r.Path
        if ($OptClaude)   { Install-ClaudeSkill $r.Path }
        if ($OptWindsurf) { Write-WindsurfFiles $r.Path }
        Install-GitHooks     $r.Path $r.Slug
        if ($OptWatchers) { Install-WatcherWindows $r.Path $r.Slug }
        graphify global remove $r.Slug 2>$null | Out-Null
    }
    Say ""; Info "running initial group merge..."
    & (Join-Path $LocalBin "graphify-fleet-merge-$Group.ps1")
    Ok "group '$Group' installed."
}

function Cmd-Uninstall($cfg) {
    Load-Config $cfg
    Say "uninstalling fleet group: $Group"
    Hr
    foreach ($r in $Repos) {
        Write-Host "▸ $($r.Slug)" -ForegroundColor Yellow
        foreach ($hook in @('post-commit','post-checkout')) {
            $f = Join-Path $r.Path ".git\hooks\$hook"
            if (Test-Path $f) {
                $content = Get-Content $f -Raw
                $cleaned = [regex]::Replace($content, "`n# gfleet-start \($Group\)[\s\S]*?# gfleet-end \($Group\)", '')
                Set-Content $f $cleaned
            }
        }
        $mcp = Join-Path $r.Path '.mcp.json'
        if (Test-Path $mcp) {
            $obj = Get-Content $mcp -Raw | ConvertFrom-Json -AsHashtable
            if ($obj.mcpServers -and $obj.mcpServers.graphify) {
                $obj.mcpServers.Remove('graphify')
                if ($obj.mcpServers.Count -eq 0) { Remove-Item $mcp } else { $obj | ConvertTo-Json -Depth 8 | Set-Content $mcp }
            }
        }
        Remove-Item (Join-Path $r.Path '.windsurf\workflows\graphify.md') -ErrorAction SilentlyContinue
        Uninstall-WatcherWindows $r.Slug
    }
    Remove-Item (Join-Path $LocalBin "graphify-fleet-merge-$Group.ps1") -ErrorAction SilentlyContinue
    Remove-Item $GroupGraph -ErrorAction SilentlyContinue
    Ok "group '$Group' uninstalled."
}

function Cmd-Status($cfg) {
    Load-Config $cfg
    Say "group: $Group"; Say "merged graph: $GroupGraph"
    if (Test-Path $GroupGraph) {
        $g = Get-Content $GroupGraph -Raw | ConvertFrom-Json
        Info "nodes: $($g.nodes.Count)  edges: $($g.links.Count)"
    }
    Hr
    foreach ($r in $Repos) { Watcher-Status $r.Slug }
}

function Cmd-Rebuild($cfg, $tgt) {
    Load-Config $cfg
    foreach ($r in $Repos) {
        if ($tgt -and $tgt -ne 'all' -and $tgt -ne $r.Slug) { continue }
        Say "rebuilding $($r.Slug)..."
        Push-Location $r.Path
        try { $env:GRAPHIFY_FORCE='1'; graphify update . } finally { $env:GRAPHIFY_FORCE=$null; Pop-Location }
    }
    & (Join-Path $LocalBin "graphify-fleet-merge-$Group.ps1")
    Ok "rebuild complete"
}

function Cmd-Remerge($cfg) { Load-Config $cfg; & (Join-Path $LocalBin "graphify-fleet-merge-$Group.ps1"); Ok "merged" }
function Cmd-Start($cfg)   { Load-Config $cfg; foreach ($r in $Repos) { Install-WatcherWindows $r.Path $r.Slug }; Ok "watchers loaded" }
function Cmd-Stop($cfg)    { Load-Config $cfg; foreach ($r in $Repos) { Uninstall-WatcherWindows $r.Slug; Info "stopped $($r.Slug)" }; Ok "watchers stopped" }
function Cmd-Restart($cfg) { Cmd-Stop $cfg; Cmd-Start $cfg }

switch ($Command) {
    'doctor'    { Cmd-Doctor }
    'install'   { if (-not $ConfigPath) { Err "usage: gfleet.ps1 install <config.json>" };    Cmd-Install   $ConfigPath }
    'uninstall' { if (-not $ConfigPath) { Err "usage: gfleet.ps1 uninstall <config.json>" }; Cmd-Uninstall $ConfigPath }
    'status'    { if (-not $ConfigPath) { Err "usage: gfleet.ps1 status <config.json>" };     Cmd-Status    $ConfigPath }
    'rebuild'   { if (-not $ConfigPath) { Err "usage: gfleet.ps1 rebuild <config.json> [slug]" }; Cmd-Rebuild $ConfigPath $Target }
    'remerge'   { if (-not $ConfigPath) { Err "usage: gfleet.ps1 remerge <config.json>" };    Cmd-Remerge   $ConfigPath }
    'start'     { if (-not $ConfigPath) { Err "usage: gfleet.ps1 start <config.json>" };      Cmd-Start     $ConfigPath }
    'stop'      { if (-not $ConfigPath) { Err "usage: gfleet.ps1 stop <config.json>" };       Cmd-Stop      $ConfigPath }
    'restart'   { if (-not $ConfigPath) { Err "usage: gfleet.ps1 restart <config.json>" };    Cmd-Restart   $ConfigPath }
    default     { Say "gfleet $Version — see README.md for usage" }
}

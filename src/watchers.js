// Per-platform file watcher install/uninstall.
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, IS_DARWIN, IS_LINUX, IS_WIN, run, log, ensureDir, graphifyBin } from './util.js';

export function watcherLabel(group, slug) { return `ai.graphify.fleet.${group}.${slug}`; }
// Per-group merge daemon label (one per group, not per repo).
export function mergeDaemonLabel(group) { return `ai.graphify.fleet.${group}.merge-daemon`; }

// Install/uninstall the per-group merge daemon as a second platform service.
// scriptPath must be the absolute path to the daemon script written by
// writeMergeDaemonScript().
export function installMergeDaemon(group, scriptPath) {
    if (IS_DARWIN) return installMergeDaemonDarwin(group, scriptPath);
    if (IS_LINUX)  return installMergeDaemonLinux(group, scriptPath);
    if (IS_WIN)    return installMergeDaemonWindows(group, scriptPath);
    log.warn(`unsupported platform for merge daemon: ${process.platform}`);
}
export function uninstallMergeDaemon(group) {
    if (IS_DARWIN) return uninstallMergeDaemonDarwin(group);
    if (IS_LINUX)  return uninstallMergeDaemonLinux(group);
    if (IS_WIN)    return uninstallMergeDaemonWindows(group);
}

export function installWatcher(group, repoPath, slug) {
    if (IS_DARWIN) return installDarwin(group, repoPath, slug);
    if (IS_LINUX)  return installLinux(group, repoPath, slug);
    if (IS_WIN)    return installWindows(group, repoPath, slug);
    log.warn(`unsupported platform for watchers: ${process.platform}`);
}
export function uninstallWatcher(group, slug) {
    if (IS_DARWIN) return uninstallDarwin(group, slug);
    if (IS_LINUX)  return uninstallLinux(group, slug);
    if (IS_WIN)    return uninstallWindows(group, slug);
}

// Normalized state values across platforms:
//   'running'       — process active
//   'idle'          — registered/loaded but not currently running (e.g. exited cleanly)
//   'failed'        — registered but in a failed/error state
//   'not-installed' — no entry registered for this label
//   'unsupported'   — platform without a watcher backend
export function watcherStatus(group, slug) {
    const label = watcherLabel(group, slug);
    if (IS_DARWIN) {
        const r = run('launchctl', ['list']);
        const line = r.stdout.split('\n').find(l => l.endsWith(label));
        if (!line) return { label, pid: '-', state: 'not-installed' };
        const [pid, code] = line.split(/\s+/);
        if (pid === '-') {
            const exited = parseInt(code, 10);
            return { label, pid: '-', state: exited && exited !== 0 ? 'failed' : 'idle' };
        }
        return { label, pid, state: 'running' };
    }
    if (IS_LINUX) {
        const r = run('systemctl', ['--user', 'is-active', `${label}.service`]);
        const raw = (r.stdout || '').trim();
        if (raw === 'active')        return { label, pid: '-', state: 'running' };
        if (raw === 'inactive')      return { label, pid: '-', state: 'not-installed' };
        if (raw === 'failed')        return { label, pid: '-', state: 'failed' };
        if (raw === 'activating')    return { label, pid: '-', state: 'running' };
        if (raw === 'deactivating')  return { label, pid: '-', state: 'idle' };
        return { label, pid: '-', state: raw || 'not-installed' };
    }
    if (IS_WIN) {
        const r = run('powershell', ['-NoProfile', '-Command', `(Get-ScheduledTask -TaskName '${label}' -ErrorAction SilentlyContinue).State`]);
        const raw = (r.stdout || '').trim();
        if (!raw)                    return { label, pid: '-', state: 'not-installed' };
        if (raw === 'Running')       return { label, pid: '-', state: 'running' };
        if (raw === 'Ready')         return { label, pid: '-', state: 'idle' };
        if (raw === 'Disabled')      return { label, pid: '-', state: 'idle' };
        if (raw === 'Queued')        return { label, pid: '-', state: 'idle' };
        return { label, pid: '-', state: raw };
    }
    return { label, pid: '-', state: 'unsupported' };
}

// ---------- darwin (launchd) ----------
function plistPath(label) { return join(HOME, 'Library', 'LaunchAgents', `${label}.plist`); }

function installDarwin(group, repoPath, slug) {
    const label = watcherLabel(group, slug);
    const plist = plistPath(label);
    const logDir = join(HOME, '.cache', 'graphify-fleet', group);
    ensureDir(logDir);
    ensureDir(join(HOME, 'Library', 'LaunchAgents'));
    const bin = graphifyBin();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bin}</string>
        <string>watch</string>
        <string>${repoPath}</string>
    </array>
    <key>WorkingDirectory</key><string>${repoPath}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${logDir}/${slug}.log</string>
    <key>StandardErrorPath</key><string>${logDir}/${slug}.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
`;
    writeFileSync(plist, xml);
    run('launchctl', ['unload', plist]);
    run('launchctl', ['load', plist]);
    log.info(`watcher loaded: ${label}`);
}
function uninstallDarwin(group, slug) {
    const label = watcherLabel(group, slug);
    const plist = plistPath(label);
    if (!existsSync(plist)) return;
    run('launchctl', ['unload', plist]);
    try { unlinkSync(plist); } catch {}
}

// ---------- linux (systemd --user) ----------
function unitPath(label) { return join(HOME, '.config', 'systemd', 'user', `${label}.service`); }

function installLinux(group, repoPath, slug) {
    const label = watcherLabel(group, slug);
    ensureDir(join(HOME, '.config', 'systemd', 'user'));
    const unit = `[Unit]
Description=graphify watcher (${group}/${slug})
After=default.target

[Service]
Type=simple
ExecStart=${graphifyBin()} watch ${repoPath}
WorkingDirectory=${repoPath}
Restart=always
RestartSec=10
Environment=PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
    writeFileSync(unitPath(label), unit);
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', `${label}.service`]);
    log.info(`watcher loaded: ${label} (systemd --user)`);
}
function uninstallLinux(group, slug) {
    const label = watcherLabel(group, slug);
    run('systemctl', ['--user', 'disable', '--now', `${label}.service`]);
    try { unlinkSync(unitPath(label)); } catch {}
    run('systemctl', ['--user', 'daemon-reload']);
}

// ---------- windows (Scheduled Tasks) ----------
function installWindows(group, repoPath, slug) {
    const label = watcherLabel(group, slug);
    const bin = graphifyBin();
    // Run as the current user with limited privileges so the watcher only
    // fires when the user is logged in and stays out of SYSTEM-level scope.
    const ps = `
$action  = New-ScheduledTaskAction -Execute '${bin}' -Argument 'watch "${repoPath}"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName '${label}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName '${label}' -ErrorAction SilentlyContinue
`;
    run('powershell', ['-NoProfile', '-Command', ps]);
    log.info(`watcher loaded: ${label}`);
}
function uninstallWindows(group, slug) {
    const label = watcherLabel(group, slug);
    run('powershell', ['-NoProfile', '-Command',
        `if (Get-ScheduledTask -TaskName '${label}' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '${label}' -Confirm:$false }`]);
}

// ---------- merge daemon: darwin (launchd) ----------
function installMergeDaemonDarwin(group, scriptPath) {
    const label = mergeDaemonLabel(group);
    const plist = join(HOME, 'Library', 'LaunchAgents', `${label}.plist`);
    const logDir = join(HOME, '.cache', 'graphify-fleet', group);
    ensureDir(logDir);
    ensureDir(join(HOME, 'Library', 'LaunchAgents'));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${scriptPath}</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${logDir}/merge-daemon.log</string>
    <key>StandardErrorPath</key><string>${logDir}/merge-daemon.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
`;
    writeFileSync(plist, xml);
    run('launchctl', ['unload', plist]);
    run('launchctl', ['load', plist]);
    log.info(`merge daemon loaded: ${label}`);
}
function uninstallMergeDaemonDarwin(group) {
    const label = mergeDaemonLabel(group);
    const plist = join(HOME, 'Library', 'LaunchAgents', `${label}.plist`);
    if (!existsSync(plist)) return;
    run('launchctl', ['unload', plist]);
    try { unlinkSync(plist); } catch {}
}

// ---------- merge daemon: linux (systemd --user) ----------
function installMergeDaemonLinux(group, scriptPath) {
    const label = mergeDaemonLabel(group);
    ensureDir(join(HOME, '.config', 'systemd', 'user'));
    const unit = `[Unit]
Description=graphify merge daemon (${group})
After=default.target

[Service]
Type=simple
ExecStart=/bin/bash ${scriptPath}
Restart=always
RestartSec=10
Environment=PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
    writeFileSync(join(HOME, '.config', 'systemd', 'user', `${label}.service`), unit);
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', `${label}.service`]);
    log.info(`merge daemon loaded: ${label} (systemd --user)`);
}
function uninstallMergeDaemonLinux(group) {
    const label = mergeDaemonLabel(group);
    run('systemctl', ['--user', 'disable', '--now', `${label}.service`]);
    try { unlinkSync(join(HOME, '.config', 'systemd', 'user', `${label}.service`)); } catch {}
    run('systemctl', ['--user', 'daemon-reload']);
}

// ---------- merge daemon: windows (Scheduled Tasks) ----------
function installMergeDaemonWindows(group, scriptPath) {
    const label = mergeDaemonLabel(group);
    const ps = `
$action  = New-ScheduledTaskAction -Execute 'powershell' -Argument '-NoProfile -File "${scriptPath}"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName '${label}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName '${label}' -ErrorAction SilentlyContinue
`;
    run('powershell', ['-NoProfile', '-Command', ps]);
    log.info(`merge daemon loaded: ${label}`);
}
function uninstallMergeDaemonWindows(group) {
    const label = mergeDaemonLabel(group);
    run('powershell', ['-NoProfile', '-Command',
        `if (Get-ScheduledTask -TaskName '${label}' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '${label}' -Confirm:$false }`]);
}

// Per-platform file watcher install/uninstall.
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, IS_DARWIN, IS_LINUX, IS_WIN, run, log, ensureDir, graphifyBin } from './util.js';

export function watcherLabel(group, slug) { return `ai.graphify.fleet.${group}.${slug}`; }

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

export function watcherStatus(group, slug) {
    const label = watcherLabel(group, slug);
    if (IS_DARWIN) {
        const r = run('launchctl', ['list']);
        const line = r.stdout.split('\n').find(l => l.endsWith(label));
        if (!line) return { label, pid: '-', state: 'not loaded' };
        const [pid, code] = line.split(/\s+/);
        if (pid === '-') return { label, pid: '-', state: `loaded (last exit ${code})` };
        return { label, pid, state: 'running' };
    }
    if (IS_LINUX) {
        const r = run('systemctl', ['--user', 'is-active', `${label}.service`]);
        return { label, pid: '-', state: r.stdout || 'inactive' };
    }
    if (IS_WIN) {
        const r = run('powershell', ['-NoProfile', '-Command', `(Get-ScheduledTask -TaskName '${label}' -ErrorAction SilentlyContinue).State`]);
        return { label, pid: '-', state: r.stdout || 'not registered' };
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
    const ps = `
$action  = New-ScheduledTaskAction -Execute '${bin}' -Argument 'watch "${repoPath}"'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName '${label}' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
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

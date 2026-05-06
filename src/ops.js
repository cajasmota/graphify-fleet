import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, log, run, readJson, listRegistered, GROUPS_DIR, LOCAL_BIN, IS_WIN } from './util.js';
import { installWatcher, uninstallWatcher, watcherStatus } from './watchers.js';

function nodeEdgeCounts(graphPath) {
    if (!existsSync(graphPath)) return null;
    try {
        const g = readJson(graphPath);
        return { nodes: g.nodes?.length ?? 0, edges: g.links?.length ?? g.edges?.length ?? 0 };
    } catch { return null; }
}

function helperPath(group) {
    return IS_WIN
        ? join(LOCAL_BIN, `graphify-fleet-merge-${group}.ps1`)
        : join(LOCAL_BIN, `graphify-fleet-merge-${group}`);
}
function runHelper(group) {
    const p = helperPath(group);
    if (!existsSync(p)) { log.warn(`remerge helper not found: ${p}`); return; }
    if (IS_WIN) run('powershell', ['-NoProfile', '-File', p]);
    else run(p);
}

export function list() {
    const groups = listRegistered();
    const names = Object.keys(groups);
    if (names.length === 0) {
        log.say('no groups registered yet. run: gfleet install <config.json>');
        return;
    }
    console.log('GROUP                NODES        CONFIG');
    log.hr();
    for (const name of names) {
        const cfg = groups[name].config;
        const counts = nodeEdgeCounts(join(GROUPS_DIR, `${name}.json`));
        const nodes = counts ? counts.nodes : '-';
        const mark = existsSync(cfg) ? ' ' : '!';
        console.log(`${name.padEnd(20)} ${String(nodes).padEnd(12)} ${mark}${cfg}`);
    }
    log.dim('  ! = config file no longer at registered path');
}

export function status(configPath) {
    const cfg = loadConfig(configPath);
    log.say(`group: ${cfg.group}`);
    log.say(`merged graph: ${cfg.groupGraph}`);
    const c = nodeEdgeCounts(cfg.groupGraph);
    if (c) log.info(`nodes: ${c.nodes}  edges: ${c.edges}`);
    else   log.warn('merged graph not found yet');
    log.hr();
    console.log(`${'WATCHER'.padEnd(40)} ${'PID'.padEnd(8)} STATUS`);
    for (const r of cfg.repos) {
        const w = watcherStatus(cfg.group, r.slug);
        console.log(`${w.label.padEnd(40)} ${String(w.pid).padEnd(8)} ${w.state}`);
    }
}

export function rebuild(configPath, target = 'all') {
    const cfg = loadConfig(configPath);
    for (const r of cfg.repos) {
        if (target !== 'all' && target !== r.slug) continue;
        log.say(`rebuilding ${r.slug} (${r.path})...`);
        run('graphify', ['update', '.'], { cwd: r.path, env: { ...process.env, GRAPHIFY_FORCE: '1' }, stdio: 'inherit' });
    }
    runHelper(cfg.group);
    log.ok('rebuild complete');
}

export function reset(configPath, target = 'all') {
    const cfg = loadConfig(configPath);
    for (const r of cfg.repos) {
        if (target !== 'all' && target !== r.slug) continue;
        log.info(`wiping ${r.path}/graphify-out/`);
        try { rmSync(join(r.path, 'graphify-out'), { recursive: true, force: true }); } catch {}
        log.say(`rebuilding ${r.slug}...`);
        run('graphify', ['update', '.'], { cwd: r.path, stdio: 'inherit' });
    }
    runHelper(cfg.group);
    log.ok(`reset complete — group '${cfg.group}' regenerated from scratch`);
    log.info('for full LLM extraction (docs, wiki, "why" comments) run /graphify . in Claude Code or Windsurf per repo');
}

export function remerge(configPath) {
    const cfg = loadConfig(configPath);
    runHelper(cfg.group);
    log.ok(`merged ${cfg.groupGraph}`);
}

export function start(configPath) {
    const cfg = loadConfig(configPath);
    for (const r of cfg.repos) installWatcher(cfg.group, r.path, r.slug);
    log.ok('watchers loaded');
}
export function stop(configPath) {
    const cfg = loadConfig(configPath);
    for (const r of cfg.repos) { uninstallWatcher(cfg.group, r.slug); log.info(`stopped ${r.slug}`); }
    log.ok('watchers stopped');
}
export function restart(configPath) { stop(configPath); start(configPath); }

import { existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, log, run, readJson, listRegistered, GROUPS_DIR } from './util.js';
import { installWatcher, uninstallWatcher, watcherStatus } from './watchers.js';
import { ensureGroupGraphsDir, groupGraphsDir } from './integrations.js';
import { runImportLinkPass, runLabelLinkPass, runStringLinkPass, clearStringCache } from './links.js';

function nodeEdgeCounts(graphPath) {
    if (!existsSync(graphPath)) return null;
    try {
        const g = readJson(graphPath);
        return { nodes: g.nodes?.length ?? 0, edges: g.links?.length ?? g.edges?.length ?? 0 };
    } catch { return null; }
}

// Aggregate node/edge counts across every per-repo graph in the graphs-dir.
function aggregateGraphsDir(group) {
    const dir = groupGraphsDir(group);
    if (!existsSync(dir)) return { repos: 0, nodes: 0, edges: 0 };
    let repos = 0, nodes = 0, edges = 0;
    for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        repos++;
        const c = nodeEdgeCounts(join(dir, f));
        if (c) { nodes += c.nodes; edges += c.edges; }
    }
    return { repos, nodes, edges };
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
        const agg = aggregateGraphsDir(name);
        const nodes = agg.repos > 0 ? agg.nodes : '-';
        const mark = existsSync(cfg) ? ' ' : '!';
        console.log(`${name.padEnd(20)} ${String(nodes).padEnd(12)} ${mark}${cfg}`);
    }
    log.dim('  ! = config file no longer at registered path');
}

export function status(configPath) {
    const cfg = loadConfig(configPath);
    log.say(`group: ${cfg.group}`);
    const dir = groupGraphsDir(cfg.group);
    log.say(`graphs-dir: ${dir}`);
    const agg = aggregateGraphsDir(cfg.group);
    if (agg.repos > 0) log.info(`repos: ${agg.repos}  nodes(sum): ${agg.nodes}  edges(sum): ${agg.edges}`);
    else log.warn('graphs-dir empty (per-repo graphs not built yet)');
    const linksFile = join(GROUPS_DIR, `${cfg.group}-links.json`);
    if (existsSync(linksFile)) {
        try {
            const obj = readJson(linksFile);
            log.info(`cross-repo links: ${(obj.links || []).length}`);
        } catch {}
    } else {
        log.info('cross-repo links: (none yet — run rebuild to seed)');
    }
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
    const dir = ensureGroupGraphsDir(cfg.group, cfg.repos);
    // rebuild invalidates the string-cache so we re-scan from clean state.
    try { clearStringCache(cfg.group); } catch {}
    try {
        const n = runImportLinkPass(cfg.group, dir);
        const m = runLabelLinkPass(cfg.group, dir);
        const s = runStringLinkPass(cfg.group, dir);
        log.info(`links: ${n} import + ${m.links} label_match + ${s.links} string`);
    } catch (e) { log.warn(`links pass failed: ${e.message}`); }
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
    const dir = ensureGroupGraphsDir(cfg.group, cfg.repos);
    try { clearStringCache(cfg.group); } catch {}
    try {
        runImportLinkPass(cfg.group, dir);
        runLabelLinkPass(cfg.group, dir);
        runStringLinkPass(cfg.group, dir);
    } catch {}
    log.ok(`reset complete — group '${cfg.group}' regenerated from scratch`);
    log.info('for full LLM extraction (docs, wiki, "why" comments) run /graphify . in Claude Code or Windsurf per repo');
}

// `remerge` is retained for backward compatibility with existing scripts.
// Under the gfleet-owned MCP server there is no merged graph file — the
// server walks per-repo graphs directly. We re-run the cross-repo link
// pass instead so the command still has a useful effect.
export function remerge(configPath) {
    const cfg = loadConfig(configPath);
    log.warn('remerge: deprecated — the MCP server now serves per-repo graphs directly.');
    log.info('Re-running cross-repo link pass instead.');
    const dir = ensureGroupGraphsDir(cfg.group, cfg.repos);
    try {
        const n = runImportLinkPass(cfg.group, dir);
        const m = runLabelLinkPass(cfg.group, dir);
        const s = runStringLinkPass(cfg.group, dir);
        log.ok(`links pass: ${n} import + ${m.links} label_match + ${s.links} string`);
    } catch (e) { log.warn(`links pass failed: ${e.message}`); }
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

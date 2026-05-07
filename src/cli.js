import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    log, die, which, graphifyBin, graphifyPython, run,
    listRegistered, resolveConfigArg, REGISTRY, GRAPHIFY_PIN, getGraphifyVersion,
    ROOT_DIR, loadConfig, expandPath,
} from './util.js';
import { install, uninstall } from './install.js';
import * as ops from './ops.js';
import { wizard } from './wizard.js';
import { skillsInstall, skillsUninstall, skillsUpdate, skillsStatus } from './skills.js';
import { docsInit, docsStatus, docsRun, docsPath, marksStale, docsSilence, docsUnsilence, docsClearStale } from './docs.js';
import { monorepoAdd, monorepoRemove, monorepoList } from './monorepo.js';
import { onboard } from './onboard.js';
import { readdirSync } from 'node:fs';
import { groupGraphsDir, mcpServerPath } from './integrations.js';
import { GROUPS_DIR } from './util.js';
import { update } from './update.js';
import { conventionsList, conventionsAdd, conventionsRemove } from './conventions.js';

// Read VERSION from package.json so it can't drift from the package metadata.
let VERSION = '0.0.0';
try {
    const pkg = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'));
    VERSION = pkg.version || VERSION;
} catch {}

function help() {
    log.say(`gfleet ${VERSION} — install once. The agent in your IDE handles the rest.`);
    log.say('');
    log.say('SETUP (run once)');
    log.say('  wizard                         interactive first-time setup');
    log.say('  onboard      [path]            join an existing group after git clone');
    log.say('');
    log.say('OPERATE (rarely needed)');
    log.say('  update       [--refresh-rules] pull latest gfleet, redeploy skills, repatch graphify');
    log.say('  doctor                         verify everything is wired correctly');
    log.say('  status       [group]           show what is running');
    log.say('  list                           show registered groups (alias: ls)');
    log.say('  start | stop | restart [group] watcher control (auto-loaded at login; rarely needed)');
    log.say('');
    log.say('REPAIR (when things misbehave)');
    log.say('  rebuild | reset | remerge      force regenerate per-repo or group graphs');
    log.say('  uninstall    [group] [--purge] remove gfleet from a group');
    log.say('');
    log.say('For all commands: gfleet help advanced');
}

function helpAdvanced() {
    log.say(`gfleet ${VERSION} — advanced reference.`);
    log.say('');
    log.say('Most of the commands below normally run automatically (wizard / update / hooks / agent).');
    log.say('Only use them if you know why.');
    log.say('');
    log.say('USAGE');
    log.say('  gfleet <command> [<group-name> | <config.json>] [slug]');
    log.say('  After install, commands accept the group NAME (e.g. upvate) instead of the config path.');
    log.say('  Omit the argument entirely to fan out across all registered groups.');
    log.say('');
    log.say('SETUP');
    log.say('  wizard                              interactive first-time setup');
    log.say('  onboard   [path]                    join an existing group after git clone');
    log.say('  update    [--refresh-rules]         pull latest gfleet, redeploy skills, repatch graphify');
    log.say('  update    [--refresh-rules-lite]    fast: only rewrite rules/manifests/MCP — no graph rebuilds, no watcher reinstalls');
    log.say('  doctor                              verify everything is wired correctly');
    log.say('  install   <config.json>             [auto via wizard/onboard] install fleet group + register');
    log.say('  uninstall [group|config] [--purge]  remove watchers, hooks, configs');
    log.say('');
    log.say('SKILLS (generate-docs)  [auto via wizard / update]');
    log.say('  skills install                      install /generate-docs skill (Claude Code + Windsurf)');
    log.say('  skills uninstall');
    log.say('  skills update                       re-copy from local graphify-fleet repo');
    log.say('  skills status                       show what is installed where');
    log.say('');
    log.say('DOCS  [agent-driven; surface in your IDE, not here]');
    log.say('  docs status   [group]               show generated docs + stale sections');
    log.say('  docs run      <group>               instructions for /generate-docs in IDE');
    log.say('  docs path     <group>               print the group docs path');
    log.say('  docs init-cli <group>               headless CLI Q&A — prefer /generate-docs --setup-only');
    log.say('  docs silence    <group> [--ttl 4h]  suppress stale-doc prompts for current workspace');
    log.say('  docs unsilence  <group>             remove silenced-session entries for current workspace');
    log.say('  docs clear-stale <group>            wipe .stale.md + stale.json (mark all up-to-date)');
    log.say('  (docs mark-stale --stdin            internal hook entry point — not for direct use)');
    log.say('');
    log.say('CONVENTIONS  [power user — usually only one ever needs this]');
    log.say('  conventions list                show built-in + user-added stack conventions');
    log.say('  conventions add [--name X]      stub a new stack, fill via /extend-convention in IDE');
    log.say('  conventions remove              remove a user-added convention');
    log.say('');
    log.say('GRAPHIFY PATCH  [DEPRECATED — the MCP server is now gfleet-owned]');
    log.say('  patch <anything>            no-op; prints a deprecation note');
    log.say('');
    log.say('MONOREPO  [agent surfaces this when modules drift]');
    log.say('  monorepo add    [group] [path]      pick monorepo + select modules');
    log.say('  monorepo remove [group] [path]      deselect modules');
    log.say('  monorepo list                       show indexed monorepo modules across all groups');
    log.say('');
    log.say('INSPECT');
    log.say('  list  (or: ls)                      show all registered groups + node counts');
    log.say('  status    [group|config]            watcher state + node/edge counts (no arg = all)');
    log.say('  help [advanced]                     show help (default = primary; advanced = full)');
    log.say('');
    log.say('REPAIR / REBUILD');
    log.say('  rebuild   [group|config] [slug]     force AST rebuild (after deletions)');
    log.say('  reset     [group|config] [slug]     wipe graphify-out/ and rebuild from scratch');
    log.say('  remerge   [group|config]            DEPRECATED — re-runs cross-repo links pass instead');
    log.say('');
    log.say('WATCHERS  [self-healing via launchd KeepAlive / systemd Restart=always]');
    log.say('  start     [group|config]            load watchers');
    log.say('  stop      [group|config]            unload watchers');
    log.say('  restart   [group|config]');
    log.say('');
    log.say('EXAMPLES');
    log.say('  gfleet wizard');
    log.say('  gfleet status                       # all registered groups');
    log.say('  gfleet status upvate                # by name');
    log.say('  gfleet reset upvate upvate-core     # one repo in upvate group');
    log.say('  gfleet uninstall upvate --purge');
}

function doctor() {
    log.say(`graphify-fleet ${VERSION} — doctor`);
    log.hr();
    log.say(`platform: ${process.platform}`);
    log.say(`node:     ${process.version}`);
    for (const c of ['git', 'uv']) {
        if (which(c)) log.ok(`${c} found`);
        else          log.warn(`${c} missing`);
    }
    if (graphifyBin()) {
        log.ok(`graphify found (${graphifyBin()})`);
        const v = getGraphifyVersion();
        if (v === GRAPHIFY_PIN)        log.ok(`graphify version: ${v} (matches gfleet pin)`);
        else if (v)                    log.warn(`graphify version: ${v}  — gfleet pins to ${GRAPHIFY_PIN}. Run gfleet install to repin (will re-apply patch).`);
        else                           log.warn('graphify version unknown');
        const py = graphifyPython();
        const r = run(py, ['-c', 'import mcp, watchdog']);
        if (r.code === 0) log.ok('graphify extras: mcp + watchdog');
        else              log.warn('graphify is missing mcp / watchdog extras (gfleet install will fix)');

        log.ok(`MCP server: gfleet-managed (${mcpServerPath()})`);
    } else {
        log.warn('graphify not installed yet (gfleet install will install it)');
    }

    // Per-group health check: verify every registered repo path still exists
    // and has a .git (file or dir). For monorepo modules check both the
    // monorepo root and the module path. Surface the fix path.
    const groups = listRegistered();
    const groupNames = Object.keys(groups);
    if (groupNames.length === 0) return;
    log.hr();
    let drift = 0;
    for (const name of groupNames) {
        const cfgPath = groups[name].config;
        if (!existsSync(cfgPath)) {
            log.err(`group '${name}' — config missing: ${cfgPath}`);
            log.info(`  hint: re-run 'gfleet wizard' or remove from ~/.graphify-fleet/registry.json`);
            drift++;
            continue;
        }
        let cfg;
        try { cfg = loadConfig(cfgPath); }
        catch (e) {
            log.err(`group '${name}' — config unreadable: ${e.message}`);
            drift++;
            continue;
        }
        for (const r of cfg.repos) {
            const repoPath = expandPath(r.path);
            if (!existsSync(repoPath)) {
                log.err(`group '${name}' — repo path missing: ${repoPath}`);
                log.info(`  hint: Run 'gfleet onboard' to remap, or edit ~/.gfleet/${name}.fleet.json`);
                drift++;
                continue;
            }
            const gitRoot = r.monorepoRoot ?? repoPath;
            if (!existsSync(join(gitRoot, '.git'))) {
                log.err(`group '${name}' — no .git at ${gitRoot} (slug: ${r.slug})`);
                log.info(`  hint: Run 'gfleet onboard' to remap, or edit ~/.gfleet/${name}.fleet.json`);
                drift++;
            }
            if (r.monorepoRoot && !existsSync(r.monorepoRoot)) {
                log.err(`group '${name}' — monorepo root missing: ${r.monorepoRoot} (module: ${r.slug})`);
                drift++;
            }
        }
    }
    if (drift === 0) log.ok(`all ${groupNames.length} group(s) healthy (paths + .git resolve)`);

    // Per-group MCP / links view.
    log.hr();
    for (const name of groupNames) {
        const gdir = groupGraphsDir(name);
        let count = 0;
        try { count = readdirSync(gdir).filter(f => f.endsWith('.json')).length; } catch {}
        const linksFile = join(GROUPS_DIR, `${name}-links.json`);
        let edges = 0;
        let linksOk = false;
        try {
            if (existsSync(linksFile)) {
                const obj = JSON.parse(readFileSync(linksFile, 'utf8'));
                edges = (obj.links || []).length;
                linksOk = true;
            }
        } catch {}
        log.say(`  ${name}: ${count} repos in graphs-dir, links file ${linksOk ? `present with ${edges} edges` : 'absent'}`);
    }
}

function showRegistryOrHelp() {
    if (existsSync(REGISTRY) && Object.keys(listRegistered()).length > 0) ops.list();
    else help();
}

async function applyToOneOrAll(arg, fn, ...rest) {
    const r = resolveConfigArg(arg);
    if (r.kind === 'one') return fn(r.config, ...rest);
    // ALL
    const groups = listRegistered();
    const cfgs = Object.values(groups).map(g => g.config).filter(c => existsSync(c));
    if (cfgs.length === 0) die('no groups registered. run: gfleet install <config.json>');
    let first = true;
    for (const cfg of cfgs) {
        if (!first) log.say('');
        first = false;
        await fn(cfg, ...rest);
    }
}

export async function main(argv) {
    const cmd = argv[0];
    const args = argv.slice(1);

    try {
        switch (cmd) {
            case undefined: case '':         showRegistryOrHelp(); break;
            case 'help': case '-h': case '--help': {
                const flag = args[0];
                if (flag === 'advanced' || flag === '--advanced' || flag === '--all') helpAdvanced();
                else help();
                break;
            }
            case 'doctor':    doctor(); break;
            case 'wizard': case 'new': await wizard(); break;
            case 'onboard': await onboard(args[0] ?? '.'); break;
            case 'update': {
                const refreshRules = args.includes('--refresh-rules');
                const refreshRulesLite = args.includes('--refresh-rules-lite');
                const force = args.includes('--force');
                await update({ refreshRules, refreshRulesLite, force });
                break;
            }
            case 'list': case 'ls': ops.list(); break;
            case 'install': {
                if (!args[0]) die('usage: gfleet install <config.json>');
                await install(args[0]);
                break;
            }
            case 'uninstall': {
                const purge = args.includes('--purge');
                const filtered = args.filter(a => a !== '--purge');
                await applyToOneOrAll(filtered[0], (cfg) => uninstall(cfg, { purge }));
                break;
            }
            case 'status':  await applyToOneOrAll(args[0], ops.status); break;
            case 'rebuild': await applyToOneOrAll(args[0], ops.rebuild, args[1] ?? 'all'); break;
            case 'reset':   await applyToOneOrAll(args[0], ops.reset,   args[1] ?? 'all'); break;
            case 'remerge': await applyToOneOrAll(args[0], ops.remerge); break;
            case 'start':   await applyToOneOrAll(args[0], ops.start);   break;
            case 'stop':    await applyToOneOrAll(args[0], ops.stop);    break;
            case 'restart': await applyToOneOrAll(args[0], ops.restart); break;

            case 'skills': {
                const sub = args[0];
                switch (sub) {
                    case 'install':   skillsInstall(); break;
                    case 'uninstall': skillsUninstall(); break;
                    case 'update':    skillsUpdate(); break;
                    case 'status':    skillsStatus(); break;
                    default: die('usage: gfleet skills {install|uninstall|update|status}');
                }
                break;
            }
            case 'conventions': {
                const sub = args[0];
                const nameIdx = args.indexOf('--name');
                const name = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
                const baseIdx = args.indexOf('--base');
                const base = baseIdx >= 0 ? args[baseIdx + 1] : undefined;
                switch (sub) {
                    case 'list':   conventionsList(); break;
                    case 'add':    await conventionsAdd({ name, base }); break;
                    case 'remove': await conventionsRemove({ name }); break;
                    default: die('usage: gfleet conventions {list|add|remove}');
                }
                break;
            }
            case 'patch': {
                // Patch system retired — the MCP server is now gfleet-owned
                // (see `src/mcp-server/server.py`). Print a deprecation note
                // and exit 0 so legacy automation does not break.
                log.warn('gfleet patch: deprecated — the MCP server is now gfleet-owned (no graphify patching needed).');
                log.info('Run `gfleet doctor` to see MCP server status.');
                break;
            }
            case 'monorepo': {
                // args[0] is the subcommand (add/remove/list).
                // Remaining args are positional [group] [path] plus optional flag --modules a,b,c.
                const sub = args[0];
                const rest = args.slice(1);
                let modules;
                const positional = [];
                for (let i = 0; i < rest.length; i++) {
                    if (rest[i] === '--modules') {
                        const v = rest[i + 1];
                        if (v === undefined) die('--modules requires a value (comma-separated module paths)');
                        modules = v.split(',').map(s => s.trim()).filter(Boolean);
                        i++; // skip the value
                        continue;
                    }
                    positional.push(rest[i]);
                }
                const group = positional[0];
                const path  = positional[1];
                switch (sub) {
                    case 'add':    await monorepoAdd({ group, path, modules }); break;
                    case 'remove': await monorepoRemove({ group, path, modules }); break;
                    case 'list':   monorepoList(); break;
                    default: die('usage: gfleet monorepo {add|remove|list} [group] [path] [--modules a,b]');
                }
                break;
            }
            case 'docs': {
                const sub = args[0];
                const target = args[1];
                switch (sub) {
                    case 'init':
                        log.warn('`gfleet docs init` is deprecated — it does plain CLI prompts with no LLM seeding.');
                        log.info('Prefer: open the repo in Claude Code or Windsurf and run `/generate-docs --setup-only`,');
                        log.info('which seeds answers from your codebase. Use `gfleet docs init-cli` for the headless CLI version.');
                        process.exit(1);
                    case 'init-cli': await docsInit(target); break;
                    case 'status':   await docsStatus(target); break;
                    case 'run':      docsRun(target); break;
                    case 'path':     docsPath(target); break;
                    case 'silence': {
                        const ttlIdx = args.indexOf('--ttl');
                        const ttl = ttlIdx >= 0 ? args[ttlIdx + 1] : '4h';
                        await docsSilence(target, { ttl });
                        break;
                    }
                    case 'unsilence': await docsUnsilence(target); break;
                    case 'clear-stale': await docsClearStale(target); break;
                    case 'mark-stale': {
                        // Internal — invoked by git hooks. Reads paths from stdin.
                        // Flags:
                        //   --group <name>   (required)
                        //   --hook <name>    (post-commit | post-merge | post-checkout)
                        //   --range <a..b>   (informational)
                        //   --repo <slug>    (limit to one repo in the group)
                        //   --stdin          (read changed file paths from stdin)
                        const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
                        const group = get('--group');
                        const hook = get('--hook') || 'post-commit';
                        const range = get('--range') || null;
                        const repoFilter = get('--repo') || null;
                        const lines = args.includes('--stdin') ? null : [];
                        await marksStale({ group, hook, range, repoFilter, lines });
                        break;
                    }
                    default: die('usage: gfleet docs {init-cli|status|run|path|silence|unsilence|clear-stale|mark-stale} [group]');
                }
                break;
            }

            default: log.err(`unknown command: ${cmd}`); help(); process.exit(1);
        }
    } catch (e) {
        log.err(e?.message ?? String(e));
        if (process.env.GFLEET_DEBUG) console.error(e);
        process.exit(1);
    }
}

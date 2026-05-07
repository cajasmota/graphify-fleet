import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import {
    log, die, which, graphifyBin, graphifyPython, run,
    listRegistered, resolveConfigArg, REGISTRY, GRAPHIFY_PIN, getGraphifyVersion,
} from './util.js';
import { install, uninstall } from './install.js';
import * as ops from './ops.js';
import { wizard } from './wizard.js';
import { skillsInstall, skillsUninstall, skillsUpdate, skillsStatus } from './skills.js';
import { docsInit, docsStatus, docsRun, docsPath, marksStale } from './docs.js';
import { monorepoAdd, monorepoRemove, monorepoList } from './monorepo.js';
import { applyPatch as patchGraphify, revertPatch as unpatchGraphify, checkPatchStatus as graphifyPatchStatus } from './patches/graphify-repo-filter.js';
import { onboard } from './onboard.js';
import { update } from './update.js';
import { conventionsList, conventionsAdd, conventionsRemove } from './conventions.js';

const VERSION = '0.2.0';

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
    log.say('  (docs mark-stale --stdin            internal hook entry point — not for direct use)');
    log.say('');
    log.say('CONVENTIONS  [power user — usually only one ever needs this]');
    log.say('  conventions list                show built-in + user-added stack conventions');
    log.say('  conventions add [--name X]      stub a new stack, fill via /extend-convention in IDE');
    log.say('  conventions remove              remove a user-added convention');
    log.say('');
    log.say('GRAPHIFY PATCH  [auto on every ensureGraphify / skills install]');
    log.say('  patch graphify              apply repo_filter parameter patch (idempotent)');
    log.say('  patch status                show patch status (applied / partial / unpatched)');
    log.say('  patch revert                restore graphify from .gfleet-orig backup');
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
    log.say('  remerge   [group|config]            re-merge group graph (no rebuild)');
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

        const pStatus = graphifyPatchStatus();
        if (pStatus.state === 'patched')        log.ok(`graphify patched (repo_filter parameter: ${pStatus.applied}/${pStatus.total} hunks)`);
        else if (pStatus.state === 'partial')   log.warn(`graphify partially patched (${pStatus.applied}/${pStatus.total}) — likely upstream changed. Re-run: gfleet patch graphify`);
        else if (pStatus.state === 'unpatched') log.warn('graphify unpatched (no repo_filter on MCP tools). Run: gfleet patch graphify');
    } else {
        log.warn('graphify not installed yet (gfleet install will install it)');
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
                const force = args.includes('--force');
                await update({ refreshRules, force });
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
                const sub = args[0];
                const target = args[1];
                if (target && target !== 'graphify') die(`only 'graphify' patch is supported (got: ${target})`);
                switch (sub) {
                    case 'graphify':
                    case 'apply': patchGraphify(); break;
                    case 'status': {
                        const s = graphifyPatchStatus();
                        if (s.state === 'no-graphify') log.warn('graphify not installed');
                        else if (s.state === 'patched')   log.ok(`graphify patched (${s.applied}/${s.total} hunks) — ${s.path}`);
                        else if (s.state === 'unpatched') log.warn(`graphify unpatched (run: gfleet patch graphify) — ${s.path}`);
                        else log.warn(`graphify partially patched (${s.applied}/${s.total}) — graphify upstream may have changed. Run: gfleet patch graphify`);
                        break;
                    }
                    case 'revert': unpatchGraphify(); break;
                    default: die('usage: gfleet patch {graphify|status|revert}');
                }
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
                    default: die('usage: gfleet docs {init-cli|status|run|path|mark-stale} [group]');
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

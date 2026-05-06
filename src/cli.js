import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import {
    log, die, which, graphifyBin, graphifyPython, run,
    listRegistered, resolveConfigArg, REGISTRY,
} from './util.js';
import { install, uninstall } from './install.js';
import * as ops from './ops.js';
import { wizard } from './wizard.js';
import { skillsInstall, skillsUninstall, skillsUpdate, skillsStatus } from './skills.js';
import { docsInit, docsStatus, docsRun, docsPath } from './docs.js';

const VERSION = '0.2.0';

function help() {
    log.say(`gfleet ${VERSION} — orchestrate graphify across multiple related repos.`);
    log.say('');
    log.say('USAGE');
    log.say('  gfleet <command> [<group-name> | <config.json>] [slug]');
    log.say('');
    log.say('  After install, commands accept the group NAME (e.g. upvate) instead of the config path.');
    log.say('  Omit the argument entirely to fan out across all registered groups.');
    log.say('');
    log.say('SETUP');
    log.say('  wizard                              interactive setup — creates a config and installs');
    log.say('  doctor                              check prerequisites');
    log.say('  install   <config.json>             install fleet group + register it');
    log.say('  uninstall [group|config] [--purge]  remove watchers, hooks, configs (purge = also delete graphify-out)');
    log.say('');
    log.say('SKILLS (generate-docs)');
    log.say('  skills install                      install /generate-docs skill (Claude Code + Windsurf)');
    log.say('  skills uninstall');
    log.say('  skills update                       re-copy from local graphify-fleet repo');
    log.say('  skills status                       show what is installed where');
    log.say('');
    log.say('DOCS');
    log.say('  docs init     <group>               configure docs for a group (interactive Q&A)');
    log.say('  docs status   [group]               show generated docs + stale sections');
    log.say('  docs run      <group>               instructions for invoking /generate-docs in IDE');
    log.say('  docs path     <group>               print the group docs path');
    log.say('');
    log.say('INSPECT');
    log.say('  list  (or: ls)                      show all registered groups + node counts');
    log.say('  status    [group|config]            watcher state + node/edge counts (no arg = all)');
    log.say('  help                                show this message');
    log.say('');
    log.say('REBUILD');
    log.say('  rebuild   [group|config] [slug]     force AST rebuild (after deletions)');
    log.say('  reset     [group|config] [slug]     wipe graphify-out/ and rebuild from scratch');
    log.say('  remerge   [group|config]            re-merge group graph (no rebuild)');
    log.say('');
    log.say('WATCHERS');
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
        const py = graphifyPython();
        const r = run(py, ['-c', 'import mcp, watchdog']);
        if (r.code === 0) log.ok('graphify extras: mcp + watchdog');
        else              log.warn('graphify is missing mcp / watchdog extras (gfleet install will fix)');
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
            case 'help': case '-h': case '--help': help(); break;
            case 'doctor':    doctor(); break;
            case 'wizard': case 'new': await wizard(); break;
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
            case 'docs': {
                const sub = args[0];
                const target = args[1];
                switch (sub) {
                    case 'init':   await docsInit(target); break;
                    case 'status': await docsStatus(target); break;
                    case 'run':    docsRun(target); break;
                    case 'path':   docsPath(target); break;
                    default: die('usage: gfleet docs {init|status|run|path} [group]');
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

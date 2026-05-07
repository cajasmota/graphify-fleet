import { existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
    loadConfig, log, run, ensureGraphify, registerGroup, ensureDir,
    GROUPS_DIR,
} from './util.js';
import {
    writeGraphifyignore, updateGitignore, writeMcpJson,
    installClaudeSkill, writeWindsurfFiles, writeRemergeHelper, installGitHooks,
    addWindsurfGlobalMcp, ensureWindsurfSkill, removeGitHooks, removeMcpEntry,
    removeWindsurfFiles, removeWindsurfGlobalMcp,
    ensureClaudeRules, ensureAgentsRules,
} from './integrations.js';
import { installWatcher, uninstallWatcher } from './watchers.js';

export async function install(configPath) {
    ensureGraphify();
    const cfg = loadConfig(configPath);

    log.say(`installing fleet group: ${cfg.group}`);
    log.say(`merged graph -> ${cfg.groupGraph}`);
    log.hr();

    ensureDir(GROUPS_DIR);
    const helper = writeRemergeHelper(cfg.group, cfg.groupGraph, cfg.repos);

    for (const r of cfg.repos) {
        log.say('');
        log.head(`${r.slug}  [${r.stack}]`);
        log.info(r.path);

        if (!existsSync(r.path) || !statSync(r.path).isDirectory()) {
            log.warn(`path does not exist: ${r.path}`); continue;
        }
        if (!existsSync(join(r.path, '.git'))) {
            log.warn('not a git repo, skipping'); continue;
        }

        writeGraphifyignore(r.path, r.stack);
        updateGitignore(r.path);

        if (!existsSync(join(r.path, 'graphify-out', 'graph.json'))) {
            log.info('building initial AST graph (this can take 30-90s)...');
            const res = run('graphify', ['update', '.'], { cwd: r.path });
            if (res.code !== 0) log.warn('initial graphify update failed (continuing)');
        }

        writeMcpJson(r.path, cfg.groupGraph, r.slug, cfg.group);
        if (cfg.options.claude_code) {
            installClaudeSkill(r.path);
            const groupDocs = cfg.docs?.group_docs_path ?? null;
            ensureClaudeRules(r.path, cfg.group, cfg.groupGraph, cfg.repos, groupDocs, r.slug);
            ensureAgentsRules(r.path, cfg.group, cfg.groupGraph, cfg.repos, groupDocs, r.slug);
        }
        if (cfg.options.windsurf)    writeWindsurfFiles(r.path, cfg.group, cfg.groupGraph, cfg.repos, r.slug);
        installGitHooks(r.path, cfg.group, helper);
        if (cfg.options.watchers)    installWatcher(cfg.group, r.path, r.slug);

        // legacy global graph cleanup (was used by older gfleet versions)
        run('graphify', ['global', 'remove', r.slug]);
    }

    log.say('');
    log.info('running initial group merge...');
    if (process.platform === 'win32') run('powershell', ['-NoProfile', '-File', helper]);
    else run(helper);

    if (cfg.options.windsurf) {
        await ensureWindsurfSkill();
        addWindsurfGlobalMcp(cfg.group, cfg.groupGraph, cfg.repos);
    }

    registerGroup(cfg.group, configPath);
    log.say('');
    log.ok(`group '${cfg.group}' installed.`);
    log.info(`merged graph: ${cfg.groupGraph}`);
    log.info(`registered:   gfleet status ${cfg.group}   (or just: gfleet status)`);
}

export function uninstall(configPath, opts = {}) {
    const cfg = loadConfig(configPath);
    log.say(`uninstalling fleet group: ${cfg.group}`);
    log.hr();

    for (const r of cfg.repos) {
        log.say('');
        log.head(r.slug);
        if (!existsSync(join(r.path, '.git'))) continue;
        removeGitHooks(r.path, cfg.group);
        removeMcpEntry(r.path);
        removeWindsurfFiles(r.path);
        uninstallWatcher(cfg.group, r.slug);
        if (opts.purge) {
            try { rmSync(join(r.path, 'graphify-out'), { recursive: true, force: true }); log.info('graphify-out/ purged'); } catch {}
        }
        log.info('cleaned');
    }

    try { rmSync(join(process.env.HOME ?? '', '.local', 'bin', `graphify-fleet-merge-${cfg.group}`), { force: true }); } catch {}
    try { rmSync(join(process.env.HOME ?? '', '.local', 'bin', `graphify-fleet-merge-${cfg.group}.ps1`), { force: true }); } catch {}
    try { rmSync(cfg.groupGraph, { force: true }); } catch {}
    removeWindsurfGlobalMcp(cfg.group);

    // unregister from registry
    import('./util.js').then(({ unregisterGroup }) => unregisterGroup(cfg.group));
    log.say('');
    log.ok(`group '${cfg.group}' uninstalled.${opts.purge ? '' : ' Per-repo graphify-out/ left intact.'}`);
}

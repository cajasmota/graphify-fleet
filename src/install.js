import { existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
    loadConfig, log, run, ensureGraphify, registerGroup, unregisterGroup, ensureDir,
    GROUPS_DIR, getGitDir, readRegistry, writeRegistry,
} from './util.js';
import {
    writeGraphifyignore, updateGitignore, writeMcpJson,
    installClaudeSkill, writeWindsurfFiles, installGitHooks,
    addWindsurfGlobalMcp, ensureWindsurfSkill, removeGitHooks, removeMcpEntry,
    removeWindsurfFiles, removeWindsurfGlobalMcp,
    ensureClaudeRules, ensureAgentsRules,
    installMergeDriver, removeMergeDriver,
    writeGroupManifest, removeGroupManifest,
    ensureGroupGraphsDir, groupGraphsDir, migrateLegacyArtifacts,
} from './integrations.js';
import { installWatcher, uninstallWatcher } from './watchers.js';
import { runImportLinkPass } from './links.js';

export async function install(configPath) {
    ensureGraphify();
    const cfg = loadConfig(configPath);

    log.say(`installing fleet group: ${cfg.group}`);
    log.hr();

    ensureDir(GROUPS_DIR);
    // Clean up artifacts from the pre-fork architecture (patch state, merge
    // daemon launchd plist / systemd unit / scheduled task, merge helper
    // scripts, the legacy merged graph file). Idempotent.
    const migrated = migrateLegacyArtifacts(cfg.group);
    if (migrated.removed.length > 0) {
        log.info(`migrated legacy artifacts: ${migrated.removed.length} item(s) cleaned up`);
        for (const r of migrated.removed) log.dim(`    - ${r}`);
    }
    // Per-repo graphs-dir for this group: one symlink per slug pointing at
    // <repo>/graphify-out/graph.json. The MCP server reads from this dir.
    const graphsDir = ensureGroupGraphsDir(cfg.group, cfg.repos);
    log.info(`graphs-dir: ${graphsDir}`);

    // Track .git roots we've already installed hooks into (monorepo modules
    // share a single .git at the monorepo root — install hooks once).
    const hookedGitRoots = new Set();

    for (const r of cfg.repos) {
        log.say('');
        const monoTag = r.monorepoRoot ? '  (monorepo module)' : '';
        log.head(`${r.slug}  [${r.stack}]${monoTag}`);
        log.info(r.path);

        if (!existsSync(r.path) || !statSync(r.path).isDirectory()) {
            log.warn(`path does not exist: ${r.path}`); continue;
        }

        // Find .git root: for standalone repos it's <path>/.git; for monorepo
        // modules the .git lives at monorepoRoot, not at the module path.
        const gitRoot = r.monorepoRoot ?? r.path;
        if (getGitDir(gitRoot) === null) {
            log.warn(`not a git repo (no .git at ${gitRoot}), skipping`);
            continue;
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

        // Hooks: install once per .git root. Monorepo modules sharing .git get one hook.
        if (!hookedGitRoots.has(gitRoot)) {
            installGitHooks(gitRoot, cfg.group, null);
            installMergeDriver(gitRoot);
            hookedGitRoots.add(gitRoot);
        } else {
            log.info(`git hooks + merge driver already installed at ${gitRoot} (shared across monorepo modules)`);
        }

        if (cfg.options.watchers)    installWatcher(cfg.group, r.path, r.slug);

        // Write portable manifest for teammate onboarding (commit this).
        writeGroupManifest(r.path, cfg.group, { ...cfg.options, docs: cfg.docs }, r, cfg.repos);
        // For monorepo modules: also write a manifest at the monorepoRoot so
        // a teammate cloning the monorepo can run `gfleet onboard` from the
        // repo root (not just from inside a specific module).
        if (r.monorepoRoot && r.monorepoRoot !== r.path) {
            writeGroupManifest(r.monorepoRoot, cfg.group, { ...cfg.options, docs: cfg.docs }, r, cfg.repos);
        }

        // legacy global graph cleanup (was used by older gfleet versions).
        // Gate behind a per-slug one-time flag in the registry so we don't
        // spawn a python subprocess on every install for repos that have
        // already been cleaned. Stderr suppressed since "not present" is the
        // expected outcome.
        try {
            const reg = readRegistry();
            reg.legacyGlobalRemoved = reg.legacyGlobalRemoved || {};
            if (!reg.legacyGlobalRemoved[r.slug]) {
                run('graphify', ['global', 'remove', r.slug], { stdio: ['ignore', 'ignore', 'ignore'] });
                reg.legacyGlobalRemoved[r.slug] = new Date().toISOString();
                writeRegistry(reg);
            }
        } catch {}
    }

    log.say('');
    log.info('running initial cross-repo link pass...');
    try {
        const n = runImportLinkPass(cfg.group, graphsDir);
        log.info(`links: ${n} cross-repo import/call edges discovered`);
    } catch (e) { log.warn(`links pass failed (continuing): ${e.message}`); }

    if (cfg.options.windsurf) {
        await ensureWindsurfSkill();
        addWindsurfGlobalMcp(cfg.group, null, cfg.repos);
    }

    registerGroup(cfg.group, configPath);
    log.say('');
    log.ok(`group '${cfg.group}' installed.`);
    log.info(`graphs-dir:   ${graphsDir}`);
    log.info(`links file:   ~/.graphify/groups/${cfg.group}-links.json`);
    log.info(`registered:   gfleet status ${cfg.group}   (or just: gfleet status)`);
}

export function uninstall(configPath, opts = {}) {
    const cfg = loadConfig(configPath);
    log.say(`uninstalling fleet group: ${cfg.group}`);
    log.hr();

    const unhookedGitRoots = new Set();
    for (const r of cfg.repos) {
        log.say('');
        log.head(r.slug);
        const gitRoot = r.monorepoRoot ?? r.path;
        if (getGitDir(gitRoot) !== null && !unhookedGitRoots.has(gitRoot)) {
            removeGitHooks(gitRoot, cfg.group);
            removeMergeDriver(gitRoot);
            unhookedGitRoots.add(gitRoot);
        }
        removeMcpEntry(r.path, r.slug, cfg.group);
        removeWindsurfFiles(r.path);
        removeGroupManifest(r.path);
        uninstallWatcher(cfg.group, r.slug);
        if (opts.purge) {
            try { rmSync(join(r.path, 'graphify-out'), { recursive: true, force: true }); log.info('graphify-out/ purged'); } catch {}
        }
        log.info('cleaned');
    }

    // Sweep legacy artifacts (merge daemon, merge-helper scripts, merged
    // graph file, patch state). migrateLegacyArtifacts is the same routine
    // install runs; calling it on uninstall keeps cleanup symmetric.
    migrateLegacyArtifacts(cfg.group);
    // Drop the per-group graphs-dir + links files for a complete uninstall.
    try { rmSync(groupGraphsDir(cfg.group), { recursive: true, force: true }); } catch {}
    try { rmSync(join(GROUPS_DIR, `${cfg.group}-links.json`), { force: true }); } catch {}
    try { rmSync(join(GROUPS_DIR, `${cfg.group}-link-candidates.json`), { force: true }); } catch {}
    removeWindsurfGlobalMcp(cfg.group);

    // unregister from registry
    unregisterGroup(cfg.group);
    log.say('');
    log.ok(`group '${cfg.group}' uninstalled.${opts.purge ? '' : ' Per-repo graphify-out/ left intact.'}`);
}

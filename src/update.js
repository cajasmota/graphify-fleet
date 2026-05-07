// gfleet update — pull latest from the gfleet repo and re-deploy.
//
// Steps:
//   1. cd to the gfleet install dir (resolved via ROOT_DIR)
//   2. git pull --ff-only (skip if uncommitted local changes; warn instead)
//   3. npm install (only if package.json or package-lock.json changed)
//   4. gfleet skills update (re-copy skill content; auto re-applies graphify patch)
//   5. gfleet patch graphify (idempotent — covers case where graphifyy was upgraded)
//   6. Optionally refresh agent rules in registered groups (--refresh-rules)
//   7. Print summary with what changed

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR, log, run, runOk, listRegistered, loadConfig, die } from './util.js';
import { skillsInstall } from './skills.js';
import { applyPatch as applyGraphifyPatch, checkPatchStatus as graphifyPatchStatus } from './patches/graphify-mcp-enhancements.js';
import {
    ensureClaudeRules, ensureAgentsRules, writeWindsurfFiles, writeMcpJson,
    writeGroupManifest, installGitHooks, writeRemergeHelper,
} from './integrations.js';

// Read the same VERSION as cli.js to keep "gfleet update" output consistent.
let VERSION = '0.0.0';
try {
    VERSION = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')).version || VERSION;
} catch {}

function inGitRepo(dir) {
    return existsSync(join(dir, '.git'));
}

function getCurrentSha(dir) {
    const r = run('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() : null;
}

function getCurrentBranch(dir) {
    const r = run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() : null;
}

function hasLocalChanges(dir) {
    const r = run('git', ['-C', dir, 'status', '--porcelain']);
    return r.code === 0 && r.stdout.trim().length > 0;
}

function fileChanged(dir, file, oldSha, newSha) {
    if (!oldSha || !newSha || oldSha === newSha) return false;
    const r = run('git', ['-C', dir, 'diff', '--name-only', `${oldSha}..${newSha}`, '--', file]);
    return r.code === 0 && r.stdout.trim().length > 0;
}

// Lightweight rules refresh: rewrite ONLY the template-derived files
// (CLAUDE.md / AGENTS.md / .windsurfrules block, .gfleet/group.json, per-repo
// .windsurf/workflows, MCP entries, hook block contents). Skips:
//   - installWatcher (no service churn)
//   - graphify update / build_initial_graph (no AST rebuilds)
//   - installClaudeSkill (Claude skill registration)
//   - ensureGraphify (no python install / patch reapply)
// Idempotent: relies on the same upsert helpers as the full install.
export async function refreshRulesLite() {
    const groups = listRegistered();
    const cfgs = Object.values(groups).map(g => g.config).filter(c => existsSync(c));
    if (cfgs.length === 0) {
        log.info('(no groups registered)');
        return;
    }
    for (const cfgPath of cfgs) {
        log.say('');
        const cfg = loadConfig(cfgPath);
        log.head(`refreshing rules for: ${cfg.group}`);
        const helper = writeRemergeHelper(cfg.group, cfg.groupGraph, cfg.repos);
        const groupDocs = cfg.docs?.group_docs_path ?? null;
        const hookedGitRoots = new Set();
        for (const r of cfg.repos) {
            if (!existsSync(r.path)) { log.warn(`skip missing path: ${r.path}`); continue; }
            const gitRoot = r.monorepoRoot ?? r.path;
            // Rules + workflows + MCP
            if (cfg.options.claude_code) {
                ensureClaudeRules(r.path, cfg.group, cfg.groupGraph, cfg.repos, groupDocs, r.slug);
                ensureAgentsRules(r.path, cfg.group, cfg.groupGraph, cfg.repos, groupDocs, r.slug);
            }
            if (cfg.options.windsurf) writeWindsurfFiles(r.path, cfg.group, cfg.groupGraph, cfg.repos, r.slug);
            writeMcpJson(r.path, cfg.groupGraph, r.slug, cfg.group);
            // Hooks: idempotent block upsert (no rebuilds, no watchers).
            if (!hookedGitRoots.has(gitRoot)) {
                installGitHooks(gitRoot, cfg.group, helper);
                hookedGitRoots.add(gitRoot);
            }
            // Manifest (committed) — rewrites siblings list to current state.
            writeGroupManifest(r.path, cfg.group, { ...cfg.options, docs: cfg.docs }, r, cfg.repos);
            if (r.monorepoRoot && r.monorepoRoot !== r.path) {
                writeGroupManifest(r.monorepoRoot, cfg.group, { ...cfg.options, docs: cfg.docs }, r, cfg.repos);
            }
        }
        log.ok(`rules refreshed for ${cfg.group}`);
    }
}

export async function update({ refreshRules = false, refreshRulesLite: liteFlag = false, force = false } = {}) {
    log.say('gfleet update');
    log.hr();
    log.info(`install dir: ${ROOT_DIR}`);

    if (!inGitRepo(ROOT_DIR)) {
        die(`${ROOT_DIR} is not a git repo. Reinstall via curl/irm one-liner.`);
    }

    const beforeSha = getCurrentSha(ROOT_DIR);
    const branch = getCurrentBranch(ROOT_DIR);
    log.info(`branch:      ${branch}  (currently at ${beforeSha})`);

    // 1. Detect local changes
    if (hasLocalChanges(ROOT_DIR)) {
        if (!force) {
            log.warn(`Local uncommitted changes detected in ${ROOT_DIR}.`);
            log.info('Either commit/stash them or re-run with --force to overwrite.');
            log.info(`(Without --force, gfleet update will skip the git pull and only re-deploy skills/patch.)`);
        } else {
            log.warn('--force: discarding local changes');
            run('git', ['-C', ROOT_DIR, 'reset', '--hard', `origin/${branch}`]);
        }
    }

    // 2. git fetch + pull
    log.say('');
    log.head('pulling latest');
    const fetchOk = runOk('git', ['-C', ROOT_DIR, 'fetch', '--quiet', 'origin', branch]);
    if (!fetchOk) {
        log.err('git fetch failed (network? auth?)');
        die('Aborting update.');
    }

    if (!hasLocalChanges(ROOT_DIR) || force) {
        const pullR = run('git', ['-C', ROOT_DIR, 'pull', '--quiet', '--ff-only', 'origin', branch]);
        if (pullR.code !== 0) {
            log.warn('git pull --ff-only failed (probably non-fast-forward; remote has unrelated commits or branch diverged)');
            log.info('Resolve manually:  cd ' + ROOT_DIR + ' && git pull');
            log.info('Then re-run: gfleet update');
            die('Aborting update.');
        }
    }

    const afterSha = getCurrentSha(ROOT_DIR);

    if (beforeSha === afterSha) {
        log.info(`already up-to-date at ${afterSha}`);
    } else {
        log.ok(`updated: ${beforeSha} → ${afterSha}`);
        // Show the commits that came in
        const logR = run('git', ['-C', ROOT_DIR, 'log', '--oneline', `${beforeSha}..${afterSha}`]);
        if (logR.code === 0 && logR.stdout.trim()) {
            log.dim('  new commits:');
            logR.stdout.trim().split('\n').forEach(l => log.dim('    ' + l));
        }
    }

    // 3. npm install if package.json or package-lock.json changed
    log.say('');
    log.head('node deps');
    const pkgChanged = fileChanged(ROOT_DIR, 'package.json', beforeSha, afterSha) ||
                       fileChanged(ROOT_DIR, 'package-lock.json', beforeSha, afterSha);
    if (pkgChanged || beforeSha === null) {
        log.info('package.json or lock changed — running npm install...');
        const r = run('npm', ['install', '--silent', '--no-audit', '--no-fund'], { cwd: ROOT_DIR });
        if (r.code === 0) log.ok('npm install complete');
        else log.warn(`npm install exited ${r.code} — check ${ROOT_DIR}/npm-debug.log`);
    } else {
        log.info('no package.json changes — skipping npm install');
    }

    // 4. Skills (re-copy content, re-install workflows, auto-applies graphify patch)
    log.say('');
    log.head('skills');
    skillsInstall();

    // 5. Patch (defensive — skillsInstall already does this, but verify state)
    log.say('');
    log.head('graphify patch');
    const ps = graphifyPatchStatus();
    if (ps.state === 'patched')        log.ok(`patch applied (${ps.applied}/${ps.total} hunks)`);
    else if (ps.state === 'partial')   { log.warn(`partial patch — re-applying`); applyGraphifyPatch(); }
    else if (ps.state === 'unpatched') { log.warn(`unpatched — applying`); applyGraphifyPatch(); }

    // 6a. Optional: lightweight rules refresh (no rebuilds, no watcher churn).
    if (liteFlag) {
        log.say('');
        log.head('refreshing rules (lite — no rebuilds, no watcher reinstalls)');
        await refreshRulesLite();
    }
    // 6. Optional: refresh agent rules across all registered groups (FULL install)
    if (refreshRules) {
        log.say('');
        log.head('refreshing agent rules in registered groups');
        const groups = listRegistered();
        const cfgs = Object.values(groups).map(g => g.config).filter(c => existsSync(c));
        if (cfgs.length === 0) {
            log.info('(no groups registered)');
        } else {
            const { install } = await import('./install.js');
            for (const cfg of cfgs) {
                log.say('');
                log.info(`re-running install for: ${cfg}`);
                try { await install(cfg); }
                catch (e) { log.warn(`install failed for ${cfg}: ${e.message}`); }
            }
        }
    } else {
        const groups = listRegistered();
        const groupCount = Object.keys(groups).length;
        if (groupCount > 0) {
            log.say('');
            log.dim(`${groupCount} registered group(s). To refresh agent rules / templates / hooks:`);
            log.dim('  gfleet update --refresh-rules');
            log.dim('  (or for one group: gfleet install <group>)');
        }
    }

    // 7. Final summary
    log.say('');
    log.hr();
    if (beforeSha === afterSha && !refreshRules && !liteFlag) {
        log.ok('already up-to-date');
    } else {
        log.ok(`updated to ${afterSha}`);
    }
    log.info('Run `gfleet doctor` to verify.');
}

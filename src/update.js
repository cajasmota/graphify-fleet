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

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR, log, run, runOk, listRegistered, die } from './util.js';
import { skillsInstall } from './skills.js';
import { applyPatch as applyGraphifyPatch, checkPatchStatus as graphifyPatchStatus } from './patches/graphify-repo-filter.js';

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

export async function update({ refreshRules = false, force = false } = {}) {
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

    // 6. Optional: refresh agent rules across all registered groups
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
    if (beforeSha === afterSha && !refreshRules) {
        log.ok('already up-to-date');
    } else {
        log.ok(`updated to ${afterSha}`);
    }
    log.info('Run `gfleet doctor` to verify.');
}

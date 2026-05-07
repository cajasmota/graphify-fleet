// gfleet onboard — bootstrap a teammate after they `git clone` a repo
// that's part of a gfleet-managed group. Reads the committed
// .gfleet/group.json manifest, prompts for sibling paths (or offers to
// clone them), generates a local fleet config, and runs gfleet install.

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { intro, outro, text, confirm, select, isCancel, cancel, note } from '@clack/prompts';
import {
    HOME, expandPath, log, run, ensureDir, writeJson, readJson, die,
    listRegistered, FLEET_STATE_DIR,
} from './util.js';

async function ask(fn) {
    const v = await fn();
    if (isCancel(v)) { cancel('cancelled'); process.exit(0); }
    return v;
}

function findManifest(startPath) {
    // Walk up from startPath looking for .gfleet/group.json
    let cur = resolve(startPath);
    while (true) {
        const candidate = join(cur, '.gfleet', 'group.json');
        if (existsSync(candidate)) return { path: candidate, repo: cur };
        const parent = dirname(cur);
        if (parent === cur) return null;
        cur = parent;
    }
}

function expandAndClean(p) {
    return expandPath((p ?? '').trim().replace(/^['"]|['"]$/g, ''));
}

async function resolveSiblingPath(sibling, defaultParent) {
    while (true) {
        const proposed = await ask(() => text({
            message: `Path to ${sibling.slug} (${sibling.stack})`,
            initialValue: join(defaultParent, sibling.slug),
            placeholder: sibling.clone_url ? `(or paste ${sibling.clone_url} to clone)` : undefined,
        }));

        const cleaned = expandAndClean(proposed);

        // If they pasted a URL, offer to clone
        if (cleaned.includes('://') || cleaned.endsWith('.git')) {
            const dest = await ask(() => text({
                message: 'Clone destination',
                initialValue: join(defaultParent, sibling.slug),
            }));
            const destAbs = expandAndClean(dest);
            log.info(`cloning ${cleaned} → ${destAbs}`);
            const r = run('git', ['clone', cleaned, destAbs], { stdio: 'inherit' });
            if (r.code !== 0) {
                log.warn('clone failed; try again or paste an existing local path');
                continue;
            }
            return destAbs;
        }

        if (!existsSync(cleaned)) {
            const cloneOffered = sibling.clone_url
                ? await ask(() => confirm({
                    message: `${cleaned} doesn't exist. Clone from ${sibling.clone_url}?`,
                    initialValue: true,
                }))
                : false;
            if (cloneOffered) {
                log.info(`cloning ${sibling.clone_url} → ${cleaned}`);
                const r = run('git', ['clone', sibling.clone_url, cleaned], { stdio: 'inherit' });
                if (r.code !== 0) { log.warn('clone failed'); continue; }
                return cleaned;
            }
            log.warn(`not found; please clone ${sibling.slug} first or enter a different path`);
            continue;
        }

        if (!statSync(cleaned).isDirectory()) {
            log.warn('not a directory'); continue;
        }
        if (!existsSync(join(cleaned, '.git'))) {
            const proceed = await ask(() => confirm({
                message: `${cleaned} is not a git repo. Use anyway? (gfleet won't install hooks/merge-driver)`,
                initialValue: false,
            }));
            if (!proceed) continue;
        }
        return cleaned;
    }
}

export async function onboard(startPath = '.') {
    intro('gfleet onboard');

    const found = findManifest(resolve(expandPath(startPath)));
    if (!found) {
        cancel('No .gfleet/group.json found in this directory or any parent. This repo isn\'t part of a gfleet-managed group, or the manifest hasn\'t been committed yet.');
        process.exit(1);
    }

    const manifest = readJson(found.path);
    log.ok(`found manifest: ${found.path}`);
    log.say(`  group:    ${manifest.group}`);
    log.say(`  this:     ${manifest.this.slug}  (${manifest.this.stack})  ${found.repo}`);
    log.say(`  siblings: ${manifest.siblings.length}`);
    for (const s of manifest.siblings) {
        log.say(`    - ${s.slug}  (${s.stack})${s.clone_url ? `  ${s.clone_url}` : ''}`);
    }

    // Check if already onboarded (group registered + this repo's path in fleet config)
    const groups = listRegistered();
    if (groups[manifest.group]) {
        const existing = groups[manifest.group].config;
        const existingCfg = existsSync(existing) ? readJson(existing) : null;
        const alreadyHas = existingCfg?.repos?.some(r => {
            const rp = expandPath(r.path);
            return rp === found.repo;
        });
        if (alreadyHas) {
            note(`Group "${manifest.group}" is already registered with this repo at:\n  ${existing}\n\nRunning install to refresh local state (merge driver, watchers, MCP, agent rules).`, 'already onboarded');
            const proceed = await ask(() => confirm({ message: 'Re-run install?', initialValue: true }));
            if (!proceed) { outro('skipped'); return; }
            const { install } = await import('./install.js');
            outro('refreshing');
            await install(existing);
            return;
        }
    }

    // Resolve sibling paths
    const defaultParent = dirname(found.repo);
    note(`Default parent folder for siblings: ${defaultParent}\n(You'll be prompted per-sibling — accept the default or override.)`, 'sibling resolution');

    const resolvedSiblings = [];
    for (const s of manifest.siblings) {
        const path = await resolveSiblingPath(s, defaultParent);
        resolvedSiblings.push({ ...s, path });
    }

    // Build local fleet config
    const localConfigDir = join(HOME, '.gfleet');
    ensureDir(localConfigDir);
    const localConfigPath = join(localConfigDir, `${manifest.group}.fleet.json`);

    const cfg = {
        group: manifest.group,
        repos: [
            { path: found.repo, slug: manifest.this.slug, stack: manifest.this.stack },
            ...resolvedSiblings.map(s => ({ path: s.path, slug: s.slug, stack: s.stack })),
        ],
        options: manifest.options ?? {
            wiki_gitignored: true, watchers: true, windsurf: true, claude_code: true,
        },
    };

    if (manifest.options?.docs?.enabled) {
        const defaultDocsPath = join(defaultParent, 'docs');
        const docsPath = await ask(() => text({
            message: 'Group docs path (where /generate-docs writes group-level docs)',
            initialValue: defaultDocsPath,
        }));
        cfg.docs = { enabled: true, group_docs_path: expandAndClean(docsPath) };
    }

    writeJson(localConfigPath, cfg);
    log.ok(`local fleet config: ${localConfigPath}`);

    const proceed = await ask(() => confirm({
        message: `Install now? (registers merge driver in ${cfg.repos.length} repos, builds graphs, wires MCP + skill, starts watchers)`,
        initialValue: true,
    }));

    if (proceed) {
        outro('installing');
        const { install } = await import('./install.js');
        await install(localConfigPath);

        // Skill install (per-machine, not per-group, idempotent)
        const { skillsInstall } = await import('./skills.js');
        log.say('');
        log.head('installing generate-docs skill');
        skillsInstall();

        log.say('');
        log.ok('onboard complete.');
        log.info('Next: open any of the repos in Claude Code or Windsurf, run /generate-docs');
    } else {
        outro(`run later: gfleet install ${localConfigPath}`);
    }
}

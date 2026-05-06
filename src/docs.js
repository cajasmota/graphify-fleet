// gfleet docs — manage documentation generation for a group.
//   gfleet docs init <group>      configure docs for a group (interactive Q&A)
//   gfleet docs status [group]    show generated docs + stale sections
//   gfleet docs run <group>       prints instructions to run /generate-docs in IDE
//                                 (the actual generation is done by the agent via the slash command)
//   gfleet docs path <group>      print the group_docs_path
import { existsSync, readFileSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { intro, outro, text, confirm, isCancel, cancel, note } from '@clack/prompts';
import {
    HOME, FLEET_STATE_DIR, ensureDir, readJson, writeJson, log, expandPath,
    loadConfig, listRegistered, resolveConfigArg, die,
} from './util.js';

const DOCS_CONFIG_VERSION = 1;

function groupStateDir(group) {
    return join(FLEET_STATE_DIR, 'groups', group);
}
function docsConfigPath(group) {
    return join(groupStateDir(group), 'docs-config.json');
}

async function ask(fn) {
    const v = await fn();
    if (isCancel(v)) { cancel('cancelled'); process.exit(0); }
    return v;
}

function defaultGroupDocsPath(cfg) {
    // user said: group docs in PARENT folder of the repos
    const repoPaths = cfg.repos.map(r => r.path);
    const parents = repoPaths.map(p => dirname(p));
    const allSame = parents.every(p => p === parents[0]);
    if (allSame) return join(parents[0], 'docs');
    // fall back to a sibling of the most-common parent
    return join(HOME, 'Documents', 'Projects', `${cfg.group}-docs`);
}

export async function docsInit(arg) {
    const r = resolveConfigArg(arg);
    if (r.kind !== 'one') die('docs init takes a single group or config: gfleet docs init <group>');
    const cfg = loadConfig(r.config);

    intro(`gfleet docs init · ${cfg.group}`);

    const existing = existsSync(docsConfigPath(cfg.group)) ? readJson(docsConfigPath(cfg.group)) : null;

    if (existing) {
        const update = await ask(() => confirm({
            message: 'Existing docs config found. Update? (No keeps it as-is)',
            initialValue: false,
        }));
        if (!update) { outro('keeping existing config'); return; }
    }

    note('Domain context (used to write docs in your product\'s language)', 'pass 0');

    const productSummary = await ask(() => text({
        message: 'In one sentence, what does this product do?',
        initialValue: existing?.domain?.product_summary ?? '',
        placeholder: 'e.g. "Recurring property inspection management for property managers."',
        validate: v => !v ? 'required' : undefined,
    }));

    const primaryUsers = await ask(() => text({
        message: 'Who are the primary users?',
        initialValue: existing?.domain?.primary_users ?? '',
        placeholder: 'e.g. "property managers, field inspectors, client admins"',
        validate: v => !v ? 'required' : undefined,
    }));

    const featuresStr = await ask(() => text({
        message: '3-5 main user-facing features (comma-separated)',
        initialValue: existing?.domain?.features?.join(', ') ?? '',
        placeholder: 'inspections, reporting, billing, scheduling',
        validate: v => !v ? 'required' : undefined,
    }));

    const vocabStr = await ask(() => text({
        message: 'Domain terms to use consistently (comma-separated, optional)',
        initialValue: (existing?.domain?.vocabulary?.preferred_terms ?? []).join(', '),
        placeholder: 'inspection, client, inspector',
    }));

    const avoidStr = await ask(() => text({
        message: 'Terms to AVOID (comma-separated, optional)',
        initialValue: (existing?.domain?.vocabulary?.avoid_terms ?? []).join(', '),
        placeholder: 'audit, customer',
    }));

    const contextNotes = await ask(() => text({
        message: 'Anything else the agent should know? (free text, optional)',
        initialValue: existing?.domain?.context_notes ?? '',
        placeholder: 'e.g. "we are migrating from system X to Y; legacy contracts have special rules"',
    }));

    note('Where to write group-level docs', 'group docs path');

    const proposedPath = existing?.group_docs_path ?? defaultGroupDocsPath(cfg);

    const groupDocsPath = await ask(() => text({
        message: 'Group docs path (parent folder of repos by default; empty to skip group docs)',
        initialValue: proposedPath,
    }));

    const config = {
        version: DOCS_CONFIG_VERSION,
        group: cfg.group,
        domain: {
            product_summary: productSummary,
            primary_users: primaryUsers,
            features: featuresStr.split(',').map(s => s.trim()).filter(Boolean),
            vocabulary: {
                preferred_terms: vocabStr.split(',').map(s => s.trim()).filter(Boolean),
                avoid_terms: avoidStr.split(',').map(s => s.trim()).filter(Boolean),
                definitions: existing?.domain?.vocabulary?.definitions ?? {},
            },
            context_notes: contextNotes,
        },
        group_docs_path: groupDocsPath ? expandPath(groupDocsPath) : null,
        module_overrides: existing?.module_overrides ?? {},
        stack_overrides: existing?.stack_overrides ?? {},
        captured_at: new Date().toISOString(),
    };

    ensureDir(groupStateDir(cfg.group));
    writeJson(docsConfigPath(cfg.group), config);

    if (config.group_docs_path) {
        ensureDir(config.group_docs_path);
    }

    log.ok(`docs config saved: ${docsConfigPath(cfg.group)}`);
    if (config.group_docs_path) log.ok(`group docs path:   ${config.group_docs_path} (created)`);

    outro(`run /generate-docs in any of the ${cfg.repos.length} ${cfg.group} repos to generate docs`);
}

export async function docsStatus(arg) {
    const r = resolveConfigArg(arg);
    if (r.kind !== 'one') {
        // fan out
        const groups = Object.values(listRegistered()).map(g => g.config).filter(c => existsSync(c));
        for (const c of groups) await docsStatusOne(c);
        return;
    }
    return docsStatusOne(r.config);
}

async function docsStatusOne(configPath) {
    const cfg = loadConfig(configPath);
    log.say(`group: ${cfg.group}`);
    const dcPath = docsConfigPath(cfg.group);
    if (!existsSync(dcPath)) {
        log.warn(`docs not configured. run: gfleet docs init ${cfg.group}`);
        return;
    }
    const dc = readJson(dcPath);
    log.info(`docs config: ${dcPath}`);
    if (dc.group_docs_path) log.info(`group docs:  ${dc.group_docs_path}`);

    log.hr();
    for (const r of cfg.repos) {
        const docsDir = join(r.path, 'docs');
        if (!existsSync(docsDir)) {
            log.say(`${r.slug.padEnd(24)}  not generated yet  (run /generate-docs in this repo)`);
            continue;
        }
        const stale = join(docsDir, '.stale.md');
        const meta  = join(docsDir, '.metadata.json');
        const staleCount = existsSync(stale) ? (readFileSync(stale, 'utf8').match(/^- \[ \]/gm) ?? []).length : 0;
        const metaTs = existsSync(meta) ? readJson(meta).generated_at ?? '?' : '(no metadata)';
        const flag   = staleCount > 0 ? `(${staleCount} stale)` : '(up-to-date)';
        log.say(`${r.slug.padEnd(24)}  ${flag.padEnd(18)}  last: ${metaTs}`);
    }

    if (dc.group_docs_path && existsSync(dc.group_docs_path)) {
        const groupReadme = join(dc.group_docs_path, 'README.md');
        log.say(`${'group'.padEnd(24)}  ${existsSync(groupReadme) ? '(generated)' : '(not generated)'}`);
    }
}

export function docsRun(arg) {
    const r = resolveConfigArg(arg);
    if (r.kind !== 'one') die('docs run takes a single group: gfleet docs run <group>');
    const cfg = loadConfig(r.config);

    log.say(`group: ${cfg.group}`);
    log.say('');
    log.say('Open one of the repos in Claude Code or Windsurf and run:');
    log.say('');
    log.say('  /generate-docs');
    log.say('');
    log.say('Repos in this group:');
    for (const r of cfg.repos) log.say(`  - ${r.path}`);
    log.say('');
    log.say('Useful flags:');
    log.say('  /generate-docs              full repo run (interactive plan-then-write)');
    log.say('  /generate-docs --autonomous skip plan confirmation (uses cached config)');
    log.say('  /generate-docs --refresh    only regenerate stale sections');
    log.say('  /generate-docs --group      group-level synthesis (run after per-repo docs exist)');
    log.say('  /generate-docs --section <path>   regenerate one section');
    log.say('');
    log.say(`Once per-repo docs exist, run /generate-docs --group from any repo to write the cross-repo docs at ${docsConfigPath(cfg.group).includes('group_docs_path') ? '<group_docs_path>' : 'the path in docs-config.json'}.`);
}

export function docsPath(arg) {
    const r = resolveConfigArg(arg);
    if (r.kind !== 'one') die('docs path takes a single group: gfleet docs path <group>');
    const cfg = loadConfig(r.config);
    const dc = existsSync(docsConfigPath(cfg.group)) ? readJson(docsConfigPath(cfg.group)) : null;
    if (!dc) { log.warn('not configured'); return; }
    if (dc.group_docs_path) log.say(dc.group_docs_path);
    else log.say('(no group docs path)');
}

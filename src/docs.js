// gfleet docs — manage documentation generation for a group.
//   gfleet docs init <group>      configure docs for a group (interactive Q&A)
//   gfleet docs status [group]    show generated docs + stale sections
//   gfleet docs run <group>       prints instructions to run /generate-docs in IDE
//                                 (the actual generation is done by the agent via the slash command)
//   gfleet docs path <group>      print the group_docs_path
//   gfleet docs mark-stale --stdin --group <g> [--hook <h>] [--repo <slug>]
//                                 INTERNAL: read changed file paths on stdin,
//                                 update <repo>/docs/.stale.md and the per-user
//                                 cache mirror. Invoked by git hooks.
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve, relative } from 'node:path';
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
    // Show the actual configured group docs path if available (loaded from
    // docs-config.json), otherwise hint at where it would be configured.
    const dcPath = docsConfigPath(cfg.group);
    const dc = existsSync(dcPath) ? readJson(dcPath) : null;
    const groupDocsHint = dc?.group_docs_path
        ? dc.group_docs_path
        : `<group_docs_path> (run 'gfleet docs init ${cfg.group}' to configure)`;
    log.say(`Once per-repo docs exist, run /generate-docs --group from any repo to write the cross-repo docs at ${groupDocsHint}.`);
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

// ---------------------------------------------------------------------------
// mark-stale — internal hook-driven entry point.
//
// Heuristic mapping (Phase 1): for each repo in the registered group, read
// `docs/.metadata.json` and find sections whose `sources[].path` matches one
// of the changed files. Write the result to `<repo>/docs/.stale.md` (markered
// markdown) and a machine-readable mirror at
// `~/.cache/graphify-fleet/<group>/<slug>/stale.json`.
//
// Bootstrap: if `docs/` doesn't exist or `.metadata.json` is absent, no file
// is written for that repo (changed sources still show up under
// `untracked_changes` in stale.json). We never write a placeholder
// `.stale.md` from scratch — the consumer rule already says "if absent, no
// stale work".
//
// Phase 2 extension point: replace `findSectionsForFile` with a graph-aware
// implementation that walks containment+import edges in graphify-out/graph.json.
// ---------------------------------------------------------------------------

const STALE_MARKER_START = '<!-- gfleet:stale:start v=1 -->';
const STALE_MARKER_END   = '<!-- gfleet:stale:end -->';

function cacheDir(group) {
    const base = process.env.XDG_CACHE_HOME ?? join(HOME, '.cache');
    return join(base, 'graphify-fleet', group);
}

// Atomic write: stage to <p>.tmp.<pid>.<ts> then rename.
function atomicWrite(p, body) {
    ensureDir(dirname(p));
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
    try {
        writeFileSync(tmp, body);
        renameSync(tmp, p);
    } catch (e) {
        try { unlinkSync(tmp); } catch {}
        throw e;
    }
}

// Find sections in a metadata.json whose sources include `relPath`.
// Schema (per skills/generate-docs/prompts/03-overview.md):
//   { files: { "<doc-path>": { sources: [{ path, sha }, ...] } } }
function findSectionsForFile(metadata, relPath) {
    const out = [];
    const files = metadata?.files;
    if (!files || typeof files !== 'object') return out;
    for (const [docPath, entry] of Object.entries(files)) {
        const sources = entry?.sources;
        if (!Array.isArray(sources)) continue;
        if (sources.some(s => s && s.path === relPath)) out.push({ docPath, sources: sources.map(s => s.path) });
    }
    return out;
}

// Parse an existing .stale.md (between markers) to recover first_marked_at
// per section. We keep this simple — the cache JSON is the canonical
// machine-readable source; the .md is mirror + UI.
function parseExistingStale(mdPath) {
    const out = new Map();
    if (!existsSync(mdPath)) return out;
    let text;
    try { text = readFileSync(mdPath, 'utf8'); } catch { return out; }
    const start = text.indexOf(STALE_MARKER_START);
    const end = text.indexOf(STALE_MARKER_END);
    if (start === -1 || end === -1) return out;
    const block = text.slice(start, end);
    // Lines like:  - [ ] `path/to/section.md`  ← src1, src2  (stale since YYYY-MM-DD)
    const re = /^- \[ \] `([^`]+)`(?:.*?\(stale since ([0-9T:.\-Z]+)\))?/gm;
    let m;
    while ((m = re.exec(block)) !== null) {
        out.set(m[1], m[2] || null);
    }
    return out;
}

function renderStaleMd({ group, repoSlug, hook, range, sections, untracked, updatedAt }) {
    const lines = [];
    lines.push(STALE_MARKER_START);
    lines.push('# Possibly-stale documentation');
    lines.push('');
    lines.push(`Group: \`${group}\` · Repo: \`${repoSlug}\` · Last hook: \`${hook}\` at ${updatedAt}${range ? ` (${range})` : ''}`);
    lines.push('');
    lines.push('These sections cite source files that changed. Refresh with:');
    lines.push('');
    lines.push('```');
    lines.push(`/generate-docs --refresh        # in your IDE (Claude Code / Windsurf)`);
    lines.push(`gfleet docs ${group} --refresh   # equivalent CLI hint`);
    lines.push('```');
    lines.push('');
    if (sections.length === 0) {
        lines.push('## Sections');
        lines.push('_(none — all tracked sections are up-to-date)_');
    } else {
        lines.push('## Sections');
        for (const s of sections) {
            const since = s.firstMarkedAt ? `  (stale since ${s.firstMarkedAt})` : '';
            const srcs = s.sources.length ? `  ← ${s.sources.join(', ')}` : '';
            lines.push(`- [ ] \`${s.docPath}\`${srcs}${since}`);
        }
    }
    if (untracked && untracked.length) {
        lines.push('');
        lines.push('## Untracked changes');
        lines.push('_(no doc section currently cites these files; consider a full `/generate-docs` run)_');
        lines.push('');
        for (const u of untracked) lines.push(`- \`${u}\``);
    }
    lines.push('');
    lines.push(STALE_MARKER_END);
    return lines.join('\n') + '\n';
}

// Read newline-delimited paths from stdin. Returns a deduped array.
async function readStdinLines() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => {
            const lines = data.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            resolve([...new Set(lines)]);
        });
        process.stdin.on('error', () => resolve([]));
        // If stdin is a TTY (no pipe), resolve immediately empty.
        if (process.stdin.isTTY) resolve([]);
    });
}

export async function marksStale({ group, hook = 'post-commit', range = null, repoFilter = null, lines = null }) {
    if (!group) die('docs mark-stale: --group <name> required');
    const reg = listRegistered();
    const entry = reg[group];
    if (!entry?.config) {
        // Silent: hooks may fire after group was unregistered.
        return;
    }
    if (!existsSync(entry.config)) return;
    const cfg = loadConfig(entry.config);

    let changed = lines;
    if (changed === null) changed = await readStdinLines();
    if (!changed.length) return;

    const updatedAt = new Date().toISOString();

    for (const r of cfg.repos) {
        if (repoFilter && r.slug !== repoFilter) continue;

        const repoPath = r.path;
        if (!existsSync(repoPath)) continue;

        // Bucket changed files by whether they live inside this repo.
        // For monorepo modules, repoPath is the module dir, but the diff comes
        // from the monorepoRoot — strip the module prefix.
        const moduleRoot = r.monorepoRoot || repoPath;
        const repoRel = (f) => {
            // f is given relative to git root (= moduleRoot for monorepos).
            // For standalone repos, moduleRoot === repoPath, so the diff is
            // already repo-relative.
            if (!r.monorepoRoot) return f;
            const moduleSubdir = relative(r.monorepoRoot, repoPath);
            if (!moduleSubdir || moduleSubdir === '.') return f;
            // Only consider files under the module subdir.
            if (!f.startsWith(moduleSubdir + '/')) return null;
            return f.slice(moduleSubdir.length + 1);
        };

        const inRepo = [];
        for (const f of changed) {
            const rel = repoRel(f);
            if (rel !== null) inRepo.push(rel);
        }
        if (!inRepo.length) continue;

        const docsDir = join(repoPath, 'docs');
        const metaPath = join(docsDir, '.metadata.json');
        const stalePath = join(docsDir, '.stale.md');
        const cacheJsonPath = join(cacheDir(group), r.slug, 'stale.json');

        // Bootstrap: no docs/ at all → silent. No .stale.md placeholder.
        if (!existsSync(docsDir)) continue;

        let metadata = null;
        if (existsSync(metaPath)) {
            try { metadata = readJson(metaPath); } catch { metadata = null; }
        }

        // Map changed files → affected doc sections (heuristic).
        // Phase 2: replace this with graph-aware traversal.
        const sectionMap = new Map(); // docPath -> { sources: Set<string> }
        const untracked = [];
        for (const rel of inRepo) {
            const matches = metadata ? findSectionsForFile(metadata, rel) : [];
            if (matches.length === 0) {
                untracked.push(rel);
                continue;
            }
            for (const m of matches) {
                const cur = sectionMap.get(m.docPath) ?? { sources: new Set() };
                m.sources.forEach(s => cur.sources.add(s));
                sectionMap.set(m.docPath, cur);
            }
        }

        // Union-merge with existing .stale.md to preserve first_marked_at.
        const prior = parseExistingStale(stalePath);
        // Read prior cache JSON for richer first_marked_at.
        let priorCache = null;
        if (existsSync(cacheJsonPath)) {
            try { priorCache = readJson(cacheJsonPath); } catch {}
        }
        const priorFirstMarked = new Map();
        if (priorCache?.stale_sections) {
            for (const s of priorCache.stale_sections) {
                if (s.path && s.first_marked_at) priorFirstMarked.set(s.path, s.first_marked_at);
            }
        }

        // Bring forward any prior section that's still relevant (we don't
        // auto-clear: a section stays stale until /generate-docs --refresh
        // runs, or the user runs `gfleet docs clear-stale`).
        for (const [docPath, since] of prior.entries()) {
            if (!sectionMap.has(docPath)) {
                sectionMap.set(docPath, { sources: new Set() });
            }
            if (since && !priorFirstMarked.has(docPath)) priorFirstMarked.set(docPath, since);
        }
        if (priorCache?.stale_sections) {
            for (const s of priorCache.stale_sections) {
                if (!sectionMap.has(s.path)) {
                    sectionMap.set(s.path, { sources: new Set(s.sources || []) });
                }
            }
        }

        const sectionsArr = [...sectionMap.entries()]
            .map(([docPath, { sources }]) => ({
                docPath,
                sources: [...sources],
                firstMarkedAt: priorFirstMarked.get(docPath) || updatedAt,
            }))
            .sort((a, b) => a.docPath.localeCompare(b.docPath));

        // If nothing tracked AND nothing untracked AND no prior content → skip.
        if (sectionsArr.length === 0 && untracked.length === 0) continue;

        // Write .stale.md
        const md = renderStaleMd({
            group, repoSlug: r.slug, hook, range,
            sections: sectionsArr, untracked, updatedAt,
        });
        atomicWrite(stalePath, md);

        // Write cache JSON
        const cacheJson = {
            version: 1,
            repo_slug: r.slug,
            group,
            updated_at: updatedAt,
            last_hook: hook,
            range: range || null,
            stale_sections: sectionsArr.map(s => ({
                path: s.docPath,
                sources: s.sources,
                first_marked_at: s.firstMarkedAt,
            })),
            untracked_changes: untracked,
        };
        ensureDir(dirname(cacheJsonPath));
        writeJson(cacheJsonPath, cacheJson);
    }
}

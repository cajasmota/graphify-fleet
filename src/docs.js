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
    HOME, FLEET_STATE_DIR, GROUPS_DIR, ensureDir, readJson, writeJson, log, expandPath,
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
//
// Phase 2: when no metadata match is found, optionally consult the merged
// group graph (loaded lazily, cached per `marksStale` invocation) to map a
// changed source file → graph node → its containing community / god-node →
// any doc section that references that node. Returns sections with reason
// strings like "graph-derived: <node-name>".
function findSectionsForFile(metadata, relPath, graphCtx = null, repoDocsDir = null) {
    const out = [];
    const files = metadata?.files;
    if (files && typeof files === 'object') {
        for (const [docPath, entry] of Object.entries(files)) {
            const sources = entry?.sources;
            if (!Array.isArray(sources)) continue;
            if (sources.some(s => s && s.path === relPath)) {
                out.push({ docPath, sources: sources.map(s => s.path), reason: 'metadata' });
            }
        }
    }
    if (out.length > 0) return out;

    // -- Phase 2 graph-aware fallback --
    if (graphCtx && repoDocsDir && existsSync(repoDocsDir)) {
        const graph = graphCtx.load();  // memoized, may be null
        if (graph && Array.isArray(graph.nodes)) {
            const matchingNodes = graph.nodes.filter(n => {
                const sf = n.source_file || n.sourceFile || n.file;
                return sf === relPath;
            });
            if (matchingNodes.length === 0) return out;
            // For each match: find god-node ancestors (via containment edges).
            const godNames = new Set();
            const containment = (graph.links || graph.edges || []).filter(
                e => (e.relation || e.type) === 'contains' || (e.relation || e.type) === 'contained_by'
            );
            for (const n of matchingNodes) {
                godNames.add(n.label || n.name || n.id);
                // Walk up containment edges (bounded to 3 hops; cycles ignored).
                let frontier = [n.id ?? n.label];
                const seen = new Set(frontier);
                for (let hop = 0; hop < 3 && frontier.length; hop++) {
                    const next = [];
                    for (const id of frontier) {
                        for (const e of containment) {
                            const child = e.target ?? e.to;
                            const parent = e.source ?? e.from;
                            const isContainsEdge = (e.relation || e.type) === 'contains';
                            if (isContainsEdge && child === id && !seen.has(parent)) {
                                seen.add(parent); next.push(parent);
                                const pn = graph.nodes.find(x => (x.id ?? x.label) === parent);
                                if (pn) godNames.add(pn.label || pn.name || pn.id);
                            } else if (!isContainsEdge && parent === id && !seen.has(child)) {
                                seen.add(child); next.push(child);
                                const cn = graph.nodes.find(x => (x.id ?? x.label) === child);
                                if (cn) godNames.add(cn.label || cn.name || cn.id);
                            }
                        }
                    }
                    frontier = next;
                }
            }
            // For each god-name, find docs that cite it via [name] or in
            // ## Endpoints / ## Methods sections. Cap to limit IO.
            const docFiles = listDocFiles(repoDocsDir, 200);
            for (const docPath of docFiles) {
                let body;
                try { body = readFileSync(docPath, 'utf8'); } catch { continue; }
                for (const name of godNames) {
                    if (!name) continue;
                    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const re = new RegExp(`\\[${escaped}\\]|^##\\s+(Endpoints|Methods)[\\s\\S]*?\\b${escaped}\\b`, 'm');
                    if (re.test(body)) {
                        const rel = docPath.startsWith(repoDocsDir + '/') ? docPath.slice(repoDocsDir.length + 1) : docPath;
                        out.push({ docPath: rel, sources: [relPath], reason: `graph-derived: ${name}` });
                        break;
                    }
                }
            }
        }
    }
    return out;
}

// List all .md files under a docs dir up to `cap` entries (to bound IO when
// the doc tree is large).
function listDocFiles(dir, cap = 200) {
    const out = [];
    function walk(d) {
        if (out.length >= cap) return;
        let entries;
        try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (out.length >= cap) return;
            if (e.name.startsWith('.')) continue;
            const full = join(d, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
        }
    }
    walk(dir);
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

// Parse "4h", "30m", "120s", "3600" into seconds. Default 4 hours.
function parseTtl(ttl) {
    if (!ttl) return 4 * 3600;
    const m = String(ttl).trim().match(/^(\d+)\s*([smhd]?)$/);
    if (!m) return 4 * 3600;
    const n = parseInt(m[1], 10);
    const unit = m[2] || 's';
    if (unit === 's') return n;
    if (unit === 'm') return n * 60;
    if (unit === 'h') return n * 3600;
    if (unit === 'd') return n * 86400;
    return n;
}

// Workspace identifier for silenced-session entries. We key on the
// current working directory so a "silence" issued in one project doesn't
// leak into another. This is intentionally per-cwd, not per-IDE.
function workspaceId() {
    return process.cwd();
}

function silencedSessionsPath(group) {
    return join(cacheDir(group), 'silenced-sessions.json');
}

export async function docsSilence(arg, { ttl = '4h' } = {}) {
    const r = resolveConfigArg(arg);
    if (r.kind !== 'one') die('docs silence takes a single group: gfleet docs silence <group> [--ttl 4h]');
    const cfg = loadConfig(r.config);
    const p = silencedSessionsPath(cfg.group);
    const ttlSec = parseTtl(ttl);
    let obj = { sessions: [] };
    if (existsSync(p)) {
        try { obj = readJson(p); } catch { obj = { sessions: [] }; }
    }
    obj.sessions = (obj.sessions || []).filter(s => {
        // Drop expired entries while we're here.
        const start = Date.parse(s.started_at);
        if (!Number.isFinite(start)) return false;
        return (Date.now() - start) / 1000 < (s.ttl_seconds || 0);
    });
    obj.sessions.push({
        workspace: workspaceId(),
        started_at: new Date().toISOString(),
        ttl_seconds: ttlSec,
    });
    ensureDir(dirname(p));
    writeJson(p, obj);
    log.ok(`silenced stale-doc prompts for ${cfg.group} (workspace: ${workspaceId()}, ttl: ${ttl})`);
}

export async function docsUnsilence(arg) {
    const r = resolveConfigArg(arg);
    if (r.kind !== 'one') die('docs unsilence takes a single group: gfleet docs unsilence <group>');
    const cfg = loadConfig(r.config);
    const p = silencedSessionsPath(cfg.group);
    if (!existsSync(p)) { log.info('no silenced sessions for this group'); return; }
    let obj;
    try { obj = readJson(p); } catch { log.warn('silenced-sessions file unreadable; removing'); try { unlinkSync(p); } catch {} return; }
    const ws = workspaceId();
    const before = (obj.sessions || []).length;
    obj.sessions = (obj.sessions || []).filter(s => s.workspace !== ws);
    const after = obj.sessions.length;
    if (after === 0) { try { unlinkSync(p); } catch {} }
    else writeJson(p, obj);
    log.ok(`removed ${before - after} silenced-session entry/entries for workspace ${ws}`);
}

export async function docsClearStale(arg) {
    const r = resolveConfigArg(arg);
    if (r.kind !== 'one') die('docs clear-stale takes a single group: gfleet docs clear-stale <group>');
    const cfg = loadConfig(r.config);
    let cleared = 0;
    for (const repo of cfg.repos) {
        const stale = join(repo.path, 'docs', '.stale.md');
        const cacheJson = join(cacheDir(cfg.group), repo.slug, 'stale.json');
        if (existsSync(stale)) { try { unlinkSync(stale); cleared++; } catch {} }
        if (existsSync(cacheJson)) { try { unlinkSync(cacheJson); } catch {} }
    }
    log.ok(`cleared stale markers for ${cleared} repo(s) in group '${cfg.group}'`);
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

    // Per-call cache: load the merged group graph at most once. Used for
    // Phase 2 graph-aware mapping of files not present in metadata.json.
    // Test scenarios for monorepo longest-prefix match (in code form):
    //   modules registered: 'packages/api/v2', 'packages/api'
    //   changed:            'packages/api/v2/src/foo.py'
    //   expected:           the v2 module wins (longer match).
    //
    //   modules registered: 'packages/api', 'packages/api-utils'
    //   changed:            'packages/api/src/foo.py'   -> api wins
    //   changed:            'packages/api-utils/x.py'   -> api-utils wins
    //   (boundary: we require the next char after the prefix to be '/' so
    //    'packages/api' does NOT swallow 'packages/api-utils').
    const groupGraphPath = join(GROUPS_DIR, `${group}.json`);
    let _graphCached = undefined;  // undefined = not loaded; null = load failed
    const graphCtx = {
        load() {
            if (_graphCached !== undefined) return _graphCached;
            if (!existsSync(groupGraphPath)) { _graphCached = null; return null; }
            try { _graphCached = readJson(groupGraphPath); }
            catch { _graphCached = null; }
            return _graphCached;
        },
    };

    // Longest-prefix monorepo match: for each changed file, find the
    // registered repo (in cfg.repos) whose monorepo subdir is the LONGEST
    // matching prefix. Standalone repos have an empty subdir and only ever
    // match files relative to their own root (which is what the standard
    // git-diff format gives us when run inside that repo).
    //
    // Build, for monorepo modules only, the list of (subdir, repo) pairs
    // sorted by subdir length descending, grouped by monorepoRoot — files
    // from a diff are relative to that monorepo's git root.
    const monoModulesByRoot = new Map();  // monorepoRoot -> [{ subdir, repo }]
    for (const r of cfg.repos) {
        if (!r.monorepoRoot) continue;
        const subdir = relative(r.monorepoRoot, r.path);
        if (!subdir || subdir === '.') continue;
        const list = monoModulesByRoot.get(r.monorepoRoot) || [];
        list.push({ subdir, repo: r });
        monoModulesByRoot.set(r.monorepoRoot, list);
    }
    for (const list of monoModulesByRoot.values()) {
        list.sort((a, b) => b.subdir.length - a.subdir.length);  // longest first
    }

    // For each repo: bucket changed files. For monorepo modules we use the
    // sorted (longest-first) list to ensure the most-specific subdir wins.
    const filesPerRepoSlug = new Map();
    for (const r of cfg.repos) filesPerRepoSlug.set(r.slug, []);

    for (const f of changed) {
        // Try monorepo modules first (longest-prefix). For each monorepo
        // root we have a sorted list — pick the FIRST module whose subdir is
        // a path-prefix of `f`.
        let assigned = false;
        for (const list of monoModulesByRoot.values()) {
            for (const { subdir, repo } of list) {
                if (f === subdir || f.startsWith(subdir + '/')) {
                    if (filesPerRepoSlug.has(repo.slug)) {
                        const rel = f === subdir ? '' : f.slice(subdir.length + 1);
                        filesPerRepoSlug.get(repo.slug).push(rel);
                    }
                    assigned = true;
                    break;
                }
            }
            if (assigned) break;
        }
        if (assigned) continue;
        // Standalone repos: the diff is repo-relative inside that repo's git
        // root, so just push to every standalone repo. (Hooks fire per-git-
        // root — only the relevant standalone repo's hook is invoking us.)
        for (const r of cfg.repos) {
            if (r.monorepoRoot) continue;
            filesPerRepoSlug.get(r.slug).push(f);
        }
    }

    for (const r of cfg.repos) {
        if (repoFilter && r.slug !== repoFilter) continue;

        const repoPath = r.path;
        if (!existsSync(repoPath)) continue;

        const inRepo = filesPerRepoSlug.get(r.slug) || [];
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
            // Phase 1 (metadata) + Phase 2 (graph-aware) hybrid. The graph
            // lookup is gated on metadata-miss inside findSectionsForFile.
            const matches = findSectionsForFile(metadata, rel, graphCtx, docsDir);
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

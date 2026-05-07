// Cross-repo link table. Maintains `~/.graphify/groups/<group>-links.json`
// (and a sibling `<group>-link-candidates.json`) — the table the MCP server
// loads as a synthetic edge overlay across per-repo graphs.
//
// Link record schema (one entry):
//   {
//     "source": "<repo>::<local_id>",
//     "target": "<repo>::<local_id>",
//     "relation": "calls" | "imports" | ...,
//     "method":   "import" | "openapi" | "events" | "manual" | ...,
//     "confidence": 0..1,
//     "channel":     null | string,    // method-specific (e.g. queue name)
//     "identifier":  null | string,    // method-specific (e.g. function name)
//     "discovered_at": ISO-8601,
//     "source_locations": [...]
//   }
//
// File schema:
//   { "version": 1, "links": [ ... ] }
//
// Phase 1 ships ONE pass: `runImportLinkPass(group, graphsDir)`. It reads
// each `<repo>.json` graph file in `graphsDir`, finds edges where source.repo
// != target.repo and relation is one of {imports, calls}, and emits a link
// record per such edge with method=import. Any pre-existing entries with
// method=import are replaced; entries from other methods are preserved.
//
// Pure Node — no MCP coupling, no python invocation. Idempotent. Atomic
// write (tmp + rename).

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const GROUPS_DIR_DEFAULT = process.env.GFLEET_GROUPS_DIR
    ?? join(process.env.GRAPHIFY_DIR ?? join(HOME, '.graphify'), 'groups');

export function linksPath(group, base = GROUPS_DIR_DEFAULT) {
    return join(base, `${group}-links.json`);
}
export function candidatesPath(group, base = GROUPS_DIR_DEFAULT) {
    return join(base, `${group}-link-candidates.json`);
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

function readJsonOrNull(p) {
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(p, obj) {
    ensureDir(dirname(p));
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
    const data = JSON.stringify(obj, null, 2) + '\n';
    try {
        writeFileSync(tmp, data);
        renameSync(tmp, p);
    } catch (e) {
        try { unlinkSync(tmp); } catch {}
        throw e;
    }
}

export function loadLinks(group, base = GROUPS_DIR_DEFAULT) {
    const obj = readJsonOrNull(linksPath(group, base));
    if (!obj || !Array.isArray(obj.links)) return { version: 1, links: [] };
    return { version: obj.version ?? 1, links: obj.links };
}

export function saveLinks(group, doc, base = GROUPS_DIR_DEFAULT) {
    const out = { version: doc.version ?? 1, links: Array.isArray(doc.links) ? doc.links : [] };
    writeJsonAtomic(linksPath(group, base), out);
}

export function loadCandidates(group, base = GROUPS_DIR_DEFAULT) {
    const obj = readJsonOrNull(candidatesPath(group, base));
    if (!obj || !Array.isArray(obj.candidates)) return { version: 1, candidates: [] };
    return { version: obj.version ?? 1, candidates: obj.candidates };
}

export function saveCandidates(group, doc, base = GROUPS_DIR_DEFAULT) {
    const out = { version: doc.version ?? 1, candidates: Array.isArray(doc.candidates) ? doc.candidates : [] };
    writeJsonAtomic(candidatesPath(group, base), out);
}

// Read a per-repo graph file and return { tag, nodes, edges } where edges are
// uniform { u, v, data } regardless of nx-style vs raw.
function readGraph(graphFile) {
    const tag = basename(graphFile, '.json');
    let parsed;
    try { parsed = JSON.parse(readFileSync(graphFile, 'utf8')); }
    catch { return null; }
    const nodesRaw = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    // node-link: networkx outputs `links` (or `edges` if edges='edges' was
    // passed). We normalize both.
    const edgesRaw = Array.isArray(parsed.links) ? parsed.links
                   : Array.isArray(parsed.edges) ? parsed.edges
                   : [];
    const nodeMap = new Map();
    for (const n of nodesRaw) {
        if (!n || typeof n !== 'object') continue;
        const id = n.id ?? n.label;
        if (id == null) continue;
        nodeMap.set(String(id), n);
    }
    const edges = edgesRaw.map(e => ({
        u: String(e.source ?? e.u ?? ''),
        v: String(e.target ?? e.v ?? ''),
        data: e,
    })).filter(e => e.u && e.v);
    return { tag, nodes: nodeMap, edges };
}

const IMPORT_RELATIONS = new Set(['imports', 'calls']);

function pickRepoTag(node, fallbackTag) {
    if (node && typeof node === 'object' && typeof node.repo === 'string') return node.repo;
    return fallbackTag;
}

// Phase 1 pass: scan each per-repo graph for cross-repo `imports` / `calls`
// edges, replace ALL `method:"import"` entries in <group>-links.json, leave
// other-method entries alone. Returns count of import-method links written.
export function runImportLinkPass(group, graphsDir, opts = {}) {
    const base = opts.base ?? GROUPS_DIR_DEFAULT;
    if (!existsSync(graphsDir)) {
        // Idempotent: if the graphs dir is missing, write an empty doc only
        // if no links file exists yet (don't clobber an existing one).
        if (!existsSync(linksPath(group, base))) {
            saveLinks(group, { version: 1, links: [] }, base);
        }
        return 0;
    }
    const files = readdirSync(graphsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => join(graphsDir, f))
        .filter(f => { try { return statSync(f).isFile(); } catch { return false; } });

    const newImportLinks = [];
    const seen = new Set();
    const now = new Date().toISOString();

    for (const file of files) {
        const g = readGraph(file);
        if (!g) continue;
        for (const e of g.edges) {
            const rel = e.data?.relation;
            if (!rel || !IMPORT_RELATIONS.has(rel)) continue;
            const srcNode = g.nodes.get(e.u);
            const tgtNode = g.nodes.get(e.v);
            const srcRepo = pickRepoTag(srcNode, g.tag);
            const tgtRepo = pickRepoTag(tgtNode, g.tag);
            if (!srcRepo || !tgtRepo || srcRepo === tgtRepo) continue;
            const sourceFull = `${srcRepo}::${e.u}`;
            const targetFull = `${tgtRepo}::${e.v}`;
            const key = `${sourceFull}|${targetFull}|${rel}|import`;
            if (seen.has(key)) continue;
            seen.add(key);
            newImportLinks.push({
                source: sourceFull,
                target: targetFull,
                relation: rel,
                method: 'import',
                confidence: 1.0,
                channel: null,
                identifier: null,
                discovered_at: now,
                source_locations: [
                    e.data?.source_location || srcNode?.source_location || null,
                ].filter(Boolean),
            });
        }
    }

    // Merge: drop existing method=import, keep everything else, then concat.
    const existing = loadLinks(group, base);
    const preserved = (existing.links || []).filter(l => l && l.method !== 'import');
    const merged = preserved.concat(newImportLinks);
    saveLinks(group, { version: 1, links: merged }, base);
    return newImportLinks.length;
}

// ============================================================================
// Phase 2: shared-label cross-repo match.
// ----------------------------------------------------------------------------
// Indexes node labels across all per-repo graphs in a group, normalizes them
// (lowercase + suffix-stripping), and emits cross-repo links for labels that
// appear in 2+ repos. Confidence is `rarity * kind_score` where rarity is a
// normalized IDF over the corpus and kind_score is a small lookup table:
//
//   Kind compatibility (0..1):
//     same kind                                    -> 1.00
//     class<->class, function<->method, file<->file (cross-stack) -> 0.90
//     class<->interface (.py vs .ts via source_file ext)          -> 0.85
//     other cross-kind (function vs class, etc.)                  -> 0.50
//
// Thresholds:
//   confidence >= LABEL_THRESHOLD (default 0.5)        -> emit link
//   LABEL_CANDIDATE_FLOOR <= confidence < threshold    -> emit candidate
//   confidence < LABEL_CANDIDATE_FLOOR                 -> discard
// ============================================================================

// Suffixes stripped during normalization (must leave a usable identifier).
const LABEL_SUFFIXES = [
    '_viewset', '_serializer', '_service', '_queries', '_dto',
    '_interface', '_class', '_type',
    'viewset', 'serializer', 'queries', 'stub', 'service', 'client',
];

// Stop list: lowercased generic terms that match too freely across stacks.
// Maintain at top-of-module so it's auditable in one place.
const LABEL_STOPLIST = new Set([
    'get', 'set', 'list', 'create', 'update', 'delete',
    'index', 'view', 'show', 'init', 'main', 'run',
    'process', 'handle', 'handler', 'helper', 'util', 'utils',
    'config', 'settings', 'factory', 'manager', 'service',
    'module', 'app', 'client', 'server',
    'request', 'response', 'error', 'exception', 'result',
    'data', 'value', 'item', 'entry', 'node', 'field',
    'model', 'schema', 'base',
]);

const LABEL_THRESHOLD_DEFAULT = (() => {
    const raw = parseFloat(process.env.GFLEET_LABEL_PASS_THRESHOLD ?? '');
    return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
})();
const LABEL_CANDIDATE_FLOOR = 0.2;
const LABEL_PAIR_CAP = 6;  // cap pairwise emissions per shared label group

function normalizeLabel(rawLabel) {
    if (typeof rawLabel !== 'string') return null;
    let s = rawLabel.trim();
    if (!s) return null;
    s = s.toLowerCase();
    // Strip parens / call markers that occasionally show up: `foo()` -> `foo`.
    if (s.endsWith('()')) s = s.slice(0, -2);
    if (s.startsWith('.')) s = s.slice(1);
    if (s.endsWith('()')) s = s.slice(0, -2);
    // Strip a single matching suffix if it leaves a sensible identifier.
    for (const suf of LABEL_SUFFIXES) {
        if (s.length > suf.length + 3 && s.endsWith(suf)) {
            const stripped = s.slice(0, -suf.length).replace(/[_\s]+$/, '');
            if (stripped.length >= 2 && /[a-z]/.test(stripped)) {
                s = stripped;
                break;
            }
        }
    }
    return s;
}

function isMeaningfulLabel(norm) {
    if (!norm) return false;
    if (norm.length < 4) return false;
    if (/^\d/.test(norm)) return false;
    if (!/[a-z]/.test(norm)) return false;
    if (LABEL_STOPLIST.has(norm)) return false;
    return true;
}

// Derive a coarse "kind" bucket from a graphify node. Looks at file_type plus
// source_file extension to discriminate class vs interface across stacks.
function nodeKind(node) {
    const ft = (node?.file_type ?? '').toString().toLowerCase();
    const src = (node?.source_file ?? '').toString().toLowerCase();
    const ext = (() => {
        const i = src.lastIndexOf('.');
        return i >= 0 ? src.slice(i) : '';
    })();
    const label = (node?.label ?? '').toString();

    // File-level node: label is the filename.
    if (ft === 'file' || /\.[a-z0-9]+$/i.test(label)) return 'file';
    // Method-style: dot-prefixed labels like `.connect()`.
    if (label.startsWith('.')) return 'method';
    // TS interface heuristic: capitalized identifier in a .ts/.tsx source.
    if ((ext === '.ts' || ext === '.tsx') && /^[A-Z]/.test(label)) return 'interface';
    // Python class heuristic: capitalized identifier in a .py source.
    if (ext === '.py' && /^[A-Z]/.test(label)) return 'class';
    // Generic capitalized identifier elsewhere -> class-ish.
    if (/^[A-Z]/.test(label)) return 'class';
    // Lowercase identifier with parens -> function.
    if (label.endsWith('()') || label.endsWith(')')) return 'function';
    return 'symbol';
}

function kindScore(a, b) {
    if (a === b) return 1.0;
    const pair = [a, b].sort().join('|');
    const compat = new Set([
        'class|class', 'function|method', 'file|file',
        'interface|interface',
    ]);
    if (compat.has(pair)) return 0.9;
    if (pair === 'class|interface') return 0.85;
    // class vs symbol, function vs class, etc.
    return 0.5;
}

// Phase 2 pass: emit `method:"label_match"` links for nodes that share a
// normalized label across repos. Replaces existing label_match entries in
// both <group>-links.json and <group>-link-candidates.json; preserves
// other-method entries verbatim. Returns { links, candidates } counts.
export function runLabelLinkPass(group, graphsDir, opts = {}) {
    const base = opts.base ?? GROUPS_DIR_DEFAULT;
    const threshold = Number.isFinite(opts.threshold) ? opts.threshold : LABEL_THRESHOLD_DEFAULT;
    if (!existsSync(graphsDir)) {
        // Idempotent: nothing to scan, leave files alone (or seed empty).
        if (!existsSync(linksPath(group, base))) {
            saveLinks(group, { version: 1, links: [] }, base);
        }
        return { links: 0, candidates: 0 };
    }
    const files = readdirSync(graphsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => join(graphsDir, f))
        .filter(f => { try { return statSync(f).isFile(); } catch { return false; } });

    // Index: normLabel -> [{ repo, nodeId, label, kind, source_location }]
    const index = new Map();
    let corpusSize = 0;

    for (const file of files) {
        const g = readGraph(file);
        if (!g) continue;
        for (const [nodeId, node] of g.nodes.entries()) {
            corpusSize += 1;
            const repo = pickRepoTag(node, g.tag);
            const norm = normalizeLabel(node?.label ?? node?.norm_label ?? nodeId);
            if (!isMeaningfulLabel(norm)) continue;
            const entry = {
                repo,
                nodeId,
                label: node?.label ?? nodeId,
                kind: nodeKind(node),
                source_location: node?.source_location ?? null,
                source_file: node?.source_file ?? null,
            };
            if (!index.has(norm)) index.set(norm, []);
            index.get(norm).push(entry);
        }
    }

    const newLinks = [];
    const newCandidates = [];
    const seenLink = new Set();
    const seenCand = new Set();
    const now = new Date().toISOString();
    const corpusDenom = Math.log(corpusSize + 1) || 1;

    for (const [norm, entries] of index.entries()) {
        // Group by repo to detect "appears in 2+ different repos".
        const byRepo = new Map();
        for (const e of entries) {
            if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
            byRepo.get(e.repo).push(e);
        }
        if (byRepo.size < 2) continue;

        // Rarity: idf normalized to 0..1 over the corpus.
        const totalOccurrences = entries.length;
        const idf = Math.log((corpusSize + 1) / (totalOccurrences + 1));
        const rarity = Math.max(0, Math.min(1, idf / corpusDenom));

        // Build pairwise across repos. For 2+ repos pick one representative
        // per repo (first occurrence) to avoid pairwise N*M explosions within
        // a label group; cap total emissions per group at LABEL_PAIR_CAP.
        const reps = [...byRepo.values()].map(arr => arr[0]);
        let emitted = 0;
        outer:
        for (let i = 0; i < reps.length; i++) {
            for (let j = i + 1; j < reps.length; j++) {
                if (emitted >= LABEL_PAIR_CAP) break outer;
                const a = reps[i], b = reps[j];
                const ks = kindScore(a.kind, b.kind);
                const confidence = rarity * ks;

                const sourceFull = `${a.repo}::${a.nodeId}`;
                const targetFull = `${b.repo}::${b.nodeId}`;
                const record = {
                    source: sourceFull,
                    target: targetFull,
                    relation: 'shared_label',
                    method: 'label_match',
                    confidence: Number(confidence.toFixed(4)),
                    channel: null,
                    identifier: norm,
                    discovered_at: now,
                    source_locations: [a.source_location, b.source_location].filter(Boolean),
                };

                if (confidence >= threshold) {
                    const k = `${sourceFull}|${targetFull}|shared_label|label_match`;
                    if (!seenLink.has(k)) {
                        seenLink.add(k);
                        newLinks.push(record);
                        emitted += 1;
                    }
                } else if (confidence >= LABEL_CANDIDATE_FLOOR) {
                    const reasons = [];
                    if (rarity < 0.5) reasons.push('label common in corpus');
                    if (ks < 0.9) reasons.push('kind mismatch');
                    if (!reasons.length) reasons.push('confidence below threshold');
                    const cand = { ...record, reason: reasons.join('; ') };
                    const k = `${sourceFull}|${targetFull}|shared_label|label_match`;
                    if (!seenCand.has(k)) {
                        seenCand.add(k);
                        newCandidates.push(cand);
                        emitted += 1;
                    }
                }
                // else: discard
            }
        }
    }

    // Method-segregated overwrite for links.
    const existingLinks = loadLinks(group, base);
    const preservedLinks = (existingLinks.links || []).filter(l => l && l.method !== 'label_match');
    saveLinks(group, { version: 1, links: preservedLinks.concat(newLinks) }, base);

    // Method-segregated overwrite for candidates.
    const existingCands = loadCandidates(group, base);
    const preservedCands = (existingCands.candidates || []).filter(c => c && c.method !== 'label_match');
    saveCandidates(group, { version: 1, candidates: preservedCands.concat(newCandidates) }, base);

    return { links: newLinks.length, candidates: newCandidates.length };
}

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

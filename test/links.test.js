// Tests for src/links.js — pure-Node cross-repo link table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    runImportLinkPass, loadLinks, saveLinks, linksPath, candidatesPath,
    loadCandidates, saveCandidates,
} from '../src/links.js';

function mkTmp() { return mkdtempSync(join(tmpdir(), 'gfleet-links-')); }

// Build a fixture per-repo graph.json (node-link form, networkx default).
function writeGraph(graphsDir, slug, nodes, edges) {
    mkdirSync(graphsDir, { recursive: true });
    const obj = {
        directed: false,
        multigraph: false,
        graph: {},
        nodes: nodes.map(n => ({ id: n.id, label: n.label ?? n.id, repo: n.repo ?? slug, ...(n.extra ?? {}) })),
        links: edges.map(e => ({ source: e.source, target: e.target, relation: e.relation ?? 'imports', confidence: e.confidence ?? 'EXTRACTED' })),
    };
    writeFileSync(join(graphsDir, `${slug}.json`), JSON.stringify(obj));
}

test('runImportLinkPass: discovers cross-repo imports edges', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        // backend graph: node A locally, plus B with repo=frontend (edge A->B is cross-repo).
        writeGraph(graphsDir, 'backend', [
            { id: 'A', label: 'OrderViewSet', repo: 'backend' },
            { id: 'B', label: 'createOrder', repo: 'frontend' },
        ], [
            { source: 'A', target: 'B', relation: 'imports' },
        ]);
        // frontend graph: just node C (no cross-repo edges originating here)
        writeGraph(graphsDir, 'frontend', [
            { id: 'C', label: 'foo', repo: 'frontend' },
        ], []);
        const n = runImportLinkPass('mygroup', graphsDir, { base: tmp });
        assert.equal(n, 1, 'one cross-repo import-method link');
        const obj = JSON.parse(readFileSync(join(tmp, 'mygroup-links.json'), 'utf8'));
        assert.equal(obj.version, 1);
        assert.equal(obj.links.length, 1);
        assert.equal(obj.links[0].source, 'backend::A');
        assert.equal(obj.links[0].target, 'frontend::B');
        assert.equal(obj.links[0].relation, 'imports');
        assert.equal(obj.links[0].method, 'import');
        assert.equal(obj.links[0].confidence, 1.0);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runImportLinkPass: ignores intra-repo edges and unrelated relations', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        writeGraph(graphsDir, 'backend', [
            { id: 'X', repo: 'backend' },
            { id: 'Y', repo: 'backend' },
            { id: 'Z', repo: 'frontend' },
        ], [
            { source: 'X', target: 'Y', relation: 'imports' },     // intra-repo: skip
            { source: 'X', target: 'Z', relation: 'contains' },     // wrong relation: skip
        ]);
        const n = runImportLinkPass('g', graphsDir, { base: tmp });
        assert.equal(n, 0);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runImportLinkPass: idempotent — same input -> same output', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        writeGraph(graphsDir, 'a', [
            { id: 'a1', repo: 'a' },
            { id: 'b1', repo: 'b' },
        ], [{ source: 'a1', target: 'b1', relation: 'calls' }]);
        writeGraph(graphsDir, 'b', [{ id: 'b1', repo: 'b' }], []);
        runImportLinkPass('g', graphsDir, { base: tmp });
        const first = readFileSync(join(tmp, 'g-links.json'), 'utf8');
        runImportLinkPass('g', graphsDir, { base: tmp });
        const second = readFileSync(join(tmp, 'g-links.json'), 'utf8');
        // Both runs MUST produce the same set of links (timestamps differ
        // per-record but the test checks set membership / count).
        const f = JSON.parse(first), s = JSON.parse(second);
        assert.equal(f.links.length, s.links.length);
        assert.equal(f.links[0].source, s.links[0].source);
        assert.equal(f.links[0].target, s.links[0].target);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runImportLinkPass: preserves non-import method entries', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        // Pre-seed a manual / openapi-method link.
        saveLinks('g', {
            version: 1,
            links: [
                {
                    source: 'a::n1', target: 'b::n2', relation: 'calls',
                    method: 'openapi', confidence: 0.9, channel: '/orders',
                    identifier: null, discovered_at: 'past', source_locations: [],
                },
            ],
        }, tmp);
        writeGraph(graphsDir, 'a', [
            { id: 'n1', repo: 'a' },
            { id: 'n3', repo: 'b' },
        ], [{ source: 'n1', target: 'n3', relation: 'imports' }]);
        writeGraph(graphsDir, 'b', [{ id: 'n3', repo: 'b' }], []);
        runImportLinkPass('g', graphsDir, { base: tmp });
        const obj = loadLinks('g', tmp);
        const methods = obj.links.map(l => l.method).sort();
        assert.deepEqual(methods, ['import', 'openapi']);
        // openapi entry preserved in full
        const oa = obj.links.find(l => l.method === 'openapi');
        assert.equal(oa.channel, '/orders');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('saveLinks / loadLinks: atomic write — no leftover .tmp files', () => {
    const tmp = mkTmp();
    try {
        saveLinks('atomic', { version: 1, links: [{ source: 'x::a', target: 'y::b', relation: 'calls', method: 'manual', confidence: 1, channel: null, identifier: null, discovered_at: 'now', source_locations: [] }] }, tmp);
        const files = readdirSync(tmp);
        assert.ok(files.includes('atomic-links.json'));
        for (const f of files) assert.doesNotMatch(f, /\.tmp\./, `unexpected tmp file: ${f}`);
        const back = loadLinks('atomic', tmp);
        assert.equal(back.links.length, 1);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('linksPath / candidatesPath: schema', () => {
    const tmp = mkTmp();
    try {
        const lp = linksPath('mygroup', tmp);
        const cp = candidatesPath('mygroup', tmp);
        assert.match(lp, /mygroup-links\.json$/);
        assert.match(cp, /mygroup-link-candidates\.json$/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('loadLinks: returns empty doc when file missing', () => {
    const tmp = mkTmp();
    try {
        const obj = loadLinks('nope', tmp);
        assert.equal(obj.version, 1);
        assert.deepEqual(obj.links, []);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('candidates round-trip', () => {
    const tmp = mkTmp();
    try {
        saveCandidates('g', { version: 1, candidates: [{ source: 'a::x', target: 'b::y', method: 'heuristic', confidence: 0.4 }] }, tmp);
        const back = loadCandidates('g', tmp);
        assert.equal(back.candidates.length, 1);
        assert.equal(back.candidates[0].method, 'heuristic');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

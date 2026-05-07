// Tests for src/links.js — pure-Node cross-repo link table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    runImportLinkPass, runLabelLinkPass,
    loadLinks, saveLinks, linksPath, candidatesPath,
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

// ---------------------------------------------------------------------------
// Phase 2: runLabelLinkPass — shared-label cross-repo match.
// ---------------------------------------------------------------------------

// Pad a graph with N filler nodes so the corpus is large enough to give the
// shared label a high IDF (rarity).
function fillerNodes(prefix, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push({ id: `${prefix}_n${i}`, label: `${prefix}Filler${i}`, extra: { file_type: 'code', source_file: `${prefix}/f${i}.py` } });
    }
    return out;
}

test('runLabelLinkPass: basic match — same label across two repos emits a link', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        writeGraph(graphsDir, 'backend', [
            { id: 'be_order', label: 'Order', repo: 'backend', extra: { file_type: 'code', source_file: 'models/order.py' } },
            ...fillerNodes('be', 40),
        ], []);
        writeGraph(graphsDir, 'frontend', [
            { id: 'fe_order', label: 'Order', repo: 'frontend', extra: { file_type: 'code', source_file: 'models/order.ts' } },
            ...fillerNodes('fe', 40),
        ], []);
        const r = runLabelLinkPass('g', graphsDir, { base: tmp });
        assert.equal(r.links, 1, 'one shared-label link');
        const obj = loadLinks('g', tmp);
        assert.equal(obj.links.length, 1);
        const link = obj.links[0];
        assert.equal(link.method, 'label_match');
        assert.equal(link.relation, 'shared_label');
        assert.equal(link.identifier, 'order');
        assert.ok(link.confidence >= 0.5, `expected high confidence, got ${link.confidence}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runLabelLinkPass: class<->interface kind compat (.py vs .ts)', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        writeGraph(graphsDir, 'backend', [
            { id: 'be_inv', label: 'Inspection', repo: 'backend', extra: { file_type: 'code', source_file: 'models/inspection.py' } },
            ...fillerNodes('be', 80),
        ], []);
        writeGraph(graphsDir, 'frontend', [
            // Note: frontend has the type as a TS-side definition.
            { id: 'fe_inv', label: 'Inspection', repo: 'frontend', extra: { file_type: 'code', source_file: 'types/inspection.ts' } },
            ...fillerNodes('fe', 80),
        ], []);
        runLabelLinkPass('g', graphsDir, { base: tmp });
        const obj = loadLinks('g', tmp);
        assert.equal(obj.links.length, 1);
        // class<->interface => kind_score 0.85; rarity is high in this small
        // corpus so confidence should land roughly in the 0.7..0.9 band.
        const c = obj.links[0].confidence;
        assert.ok(c >= 0.5 && c <= 0.95, `confidence in band, got ${c}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runLabelLinkPass: stop-list labels never link', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        writeGraph(graphsDir, 'a', [
            { id: 'a1', label: 'helper', repo: 'a', extra: { file_type: 'code', source_file: 'a/helper.py' } },
            { id: 'a2', label: 'util', repo: 'a', extra: { file_type: 'code', source_file: 'a/util.py' } },
            { id: 'a3', label: 'get', repo: 'a', extra: { file_type: 'code', source_file: 'a/x.py' } },
        ], []);
        writeGraph(graphsDir, 'b', [
            { id: 'b1', label: 'helper', repo: 'b', extra: { file_type: 'code', source_file: 'b/helper.ts' } },
            { id: 'b2', label: 'util', repo: 'b', extra: { file_type: 'code', source_file: 'b/util.ts' } },
            { id: 'b3', label: 'get', repo: 'b', extra: { file_type: 'code', source_file: 'b/x.ts' } },
        ], []);
        const r = runLabelLinkPass('g', graphsDir, { base: tmp });
        assert.equal(r.links, 0);
        assert.equal(r.candidates, 0);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runLabelLinkPass: low rarity (label appears many times per repo) lands in candidates', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        // Repeat the shared label many times in a small corpus -> high freq, low IDF.
        const aNodes = fillerNodes('a', 60);
        const bNodes = fillerNodes('b', 60);
        for (let i = 0; i < 8; i++) {
            aNodes.push({ id: `a_widget_${i}`, label: 'Widget', repo: 'a', extra: { file_type: 'code', source_file: `a/w${i}.py` } });
            bNodes.push({ id: `b_widget_${i}`, label: 'Widget', repo: 'b', extra: { file_type: 'code', source_file: `b/w${i}.ts` } });
        }
        writeGraph(graphsDir, 'a', aNodes, []);
        writeGraph(graphsDir, 'b', bNodes, []);
        const r = runLabelLinkPass('g', graphsDir, { base: tmp });
        assert.equal(r.links, 0, 'should not emit a high-confidence link');
        assert.ok(r.candidates >= 1, 'should at least emit a candidate');
        const cands = loadCandidates('g', tmp);
        assert.ok(cands.candidates.some(c => c.identifier === 'widget'));
        assert.ok(cands.candidates[0].reason && cands.candidates[0].reason.length > 0);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runLabelLinkPass: 3 repos sharing a label emit pairwise (capped at 6)', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        for (const slug of ['a', 'b', 'c']) {
            writeGraph(graphsDir, slug, [
                { id: `${slug}_payment`, label: 'Payment', repo: slug, extra: { file_type: 'code', source_file: `${slug}/payment.py` } },
                ...fillerNodes(slug, 30),
            ], []);
        }
        runLabelLinkPass('g', graphsDir, { base: tmp });
        const obj = loadLinks('g', tmp);
        // 3 repos -> C(3,2) = 3 pairwise links, all under cap.
        const labelLinks = obj.links.filter(l => l.method === 'label_match');
        assert.equal(labelLinks.length, 3);
        assert.ok(labelLinks.length <= 6);
        for (const l of labelLinks) {
            assert.equal(l.relation, 'shared_label');
        }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runLabelLinkPass: preserves non-label_match entries', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        // Pre-seed an import-method entry.
        saveLinks('g', {
            version: 1,
            links: [{
                source: 'a::x', target: 'b::y', relation: 'imports',
                method: 'import', confidence: 1.0, channel: null,
                identifier: null, discovered_at: 'past', source_locations: [],
            }],
        }, tmp);
        writeGraph(graphsDir, 'a', [
            { id: 'a_order', label: 'Order', repo: 'a', extra: { file_type: 'code', source_file: 'a/order.py' } },
            ...fillerNodes('a', 40),
        ], []);
        writeGraph(graphsDir, 'b', [
            { id: 'b_order', label: 'Order', repo: 'b', extra: { file_type: 'code', source_file: 'b/order.ts' } },
            ...fillerNodes('b', 40),
        ], []);
        runLabelLinkPass('g', graphsDir, { base: tmp });
        const obj = loadLinks('g', tmp);
        const methods = obj.links.map(l => l.method).sort();
        assert.deepEqual(methods, ['import', 'label_match']);
        const imp = obj.links.find(l => l.method === 'import');
        assert.equal(imp.source, 'a::x');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runLabelLinkPass: re-run idempotent (link set stable)', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        writeGraph(graphsDir, 'a', [
            { id: 'a_inv', label: 'Invoice', repo: 'a', extra: { file_type: 'code', source_file: 'a/invoice.py' } },
            ...fillerNodes('a', 30),
        ], []);
        writeGraph(graphsDir, 'b', [
            { id: 'b_inv', label: 'Invoice', repo: 'b', extra: { file_type: 'code', source_file: 'b/invoice.ts' } },
            ...fillerNodes('b', 30),
        ], []);
        runLabelLinkPass('g', graphsDir, { base: tmp });
        const first = loadLinks('g', tmp).links;
        runLabelLinkPass('g', graphsDir, { base: tmp });
        const second = loadLinks('g', tmp).links;
        assert.equal(first.length, second.length);
        const sigA = first.map(l => `${l.source}|${l.target}`).sort().join(',');
        const sigB = second.map(l => `${l.source}|${l.target}`).sort().join(',');
        assert.equal(sigA, sigB);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('runLabelLinkPass: suffix stripping — OrderViewSet matches Order', () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        writeGraph(graphsDir, 'backend', [
            { id: 'be_ovs', label: 'OrderViewSet', repo: 'backend', extra: { file_type: 'code', source_file: 'api/views.py' } },
            ...fillerNodes('be', 40),
        ], []);
        writeGraph(graphsDir, 'frontend', [
            { id: 'fe_order', label: 'Order', repo: 'frontend', extra: { file_type: 'code', source_file: 'models/order.ts' } },
            ...fillerNodes('fe', 40),
        ], []);
        runLabelLinkPass('g', graphsDir, { base: tmp });
        const obj = loadLinks('g', tmp);
        const lm = obj.links.filter(l => l.method === 'label_match');
        assert.equal(lm.length, 1, 'suffix-stripped match emitted');
        assert.equal(lm[0].identifier, 'order');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

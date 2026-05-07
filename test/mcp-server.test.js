// Tests for the gfleet-owned MCP server package at `src/mcp_server/` and the
// graphs-dir symlink layout produced by `ensureGroupGraphsDir`.
//
// The Python `mcp` and `networkx` libraries are needed for full smoke checks;
// tests gracefully skip when they aren't importable so CI without the
// graphify env doesn't fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readlinkSync, lstatSync, existsSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureGroupGraphsDir, mcpServerPath, groupGraphsDir } from '../src/integrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_DIR = join(__dirname, '..', 'src', 'mcp_server');
const ENTRY_PY = join(PKG_DIR, '__main__.py');

const EXPECTED_MODULES = [
    '__init__.py',
    '__main__.py',
    'server.py',
    'state.py',
    'tools.py',
    'scoring.py',
    'traversal.py',
    'context_filter.py',
    'index.py',
    'links_loader.py',
    'communities.py',
    'utils.py',
];

const PY = (() => {
    for (const cand of ['python3', 'python']) {
        const r = spawnSync(cand, ['--version']);
        if (r.status === 0) return cand;
    }
    return null;
})();

// Resolve a python that has networkx + mcp available (graphify's venv if
// available; otherwise PY if it happens to). Returns null if none found.
const PY_WITH_DEPS = (() => {
    const candidates = [];
    if (PY) candidates.push(PY);
    // graphify's `uv tools install graphifyy` venv (well-known location).
    const home = process.env.HOME ?? '';
    if (home) candidates.push(join(home, '.local', 'share', 'uv', 'tools', 'graphifyy', 'bin', 'python3'));
    for (const cand of candidates) {
        const r = spawnSync(cand, ['-c', 'import networkx, mcp']);
        if (r.status === 0) return cand;
    }
    return null;
})();

function mkTmp() { return mkdtempSync(join(tmpdir(), 'gfleet-mcp-')); }

// ---------------------------------------------------------------------------
// Module structure (Phase 4a.1)
// ---------------------------------------------------------------------------

test('mcp_server: every expected module exists and parses via ast.parse', { skip: PY ? false : 'python not on PATH' }, () => {
    for (const mod of EXPECTED_MODULES) {
        const p = join(PKG_DIR, mod);
        assert.ok(existsSync(p), `expected ${p} to exist`);
        const r = spawnSync(PY, ['-c', `import ast; ast.parse(open(${JSON.stringify(p)}).read())`]);
        assert.equal(r.status, 0, `ast.parse failed for ${mod}: ${r.stderr.toString()}`);
    }
});

test('mcpServerPath: resolves to src/mcp_server/__main__.py and exists', () => {
    const p = mcpServerPath();
    assert.equal(p, ENTRY_PY);
    assert.ok(existsSync(p), `expected ${p} to exist`);
});

test('mcp_server: --help surfaces graphs_dir + --group args', { skip: PY_WITH_DEPS ? false : 'python with networkx+mcp not available' }, () => {
    const r = spawnSync(PY_WITH_DEPS, [ENTRY_PY, '--help'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, `--help exit ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /graphs_dir/);
    assert.match(r.stdout, /--group/);
});

// ---------------------------------------------------------------------------
// Tier A item 2 — LabelIndex correctness
// ---------------------------------------------------------------------------

test('LabelIndex: lookup hits exact and substring, reload drops old entries', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const script = `
import json, sys, networkx as nx
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from mcp_server.index import LabelIndex

G = nx.Graph()
G.add_node('n1', label='Foo Bar', norm_label='foo bar')
G.add_node('n2', label='Baz', norm_label='baz')
idx = LabelIndex()
idx.add_repo('repoA', G)

assert len(idx.lookup('Foo Bar')) == 1
assert idx.lookup('Foo Bar')[0][:2] == ('repoA', 'n1')
assert len(idx.lookup_substring('foo')) == 1
assert idx.lookup('missing') == []

# Reload with a new graph: old entries gone, new entries present.
G2 = nx.Graph()
G2.add_node('n3', label='Qux', norm_label='qux')
idx.reload_repo('repoA', G2)
assert idx.lookup('Foo Bar') == []
assert len(idx.lookup('Qux')) == 1
print('OK')
`;
    const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, `LabelIndex script failed: ${r.stderr}`);
    assert.match(r.stdout, /OK/);
});

// ---------------------------------------------------------------------------
// Tier A item 3 — community cache hit
// ---------------------------------------------------------------------------

test('communities cache: identical (repo, mtime) returns the cached object', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const script = `
import sys, networkx as nx
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from mcp_server.communities import communities_for, cache_size

G = nx.Graph()
G.add_node('a', community=1)
G.add_node('b', community=1)
G.add_node('c', community=2)
first = communities_for('repoA', 100.0, G)
second = communities_for('repoA', 100.0, G)
assert first is second, 'cache miss on second call'
assert sorted(first.keys()) == [1, 2]
# Bump mtime: cache size for repoA stays at 1 (eviction).
_ = communities_for('repoA', 200.0, G)
sizes = [k for k in [('repoA', 100.0), ('repoA', 200.0)]]
print('OK', cache_size())
`;
    const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, `communities cache script failed: ${r.stderr}`);
    assert.match(r.stdout, /OK/);
});

// ---------------------------------------------------------------------------
// Tier A item 4 — schema validation tolerance
// ---------------------------------------------------------------------------

test('links_loader: malformed entries skipped, valid entries served', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const linksFile = join(tmp, 'links.json');
        const data = {
            version: 1,
            links: [
                // valid
                { source: 'a::n1', target: 'b::n2', relation: 'calls', method: 'import', confidence: 1.0, discovered_at: '2026-05-08T00:00:00Z' },
                // missing relation
                { source: 'a::n1', target: 'b::n2', method: 'import', confidence: 1.0, discovered_at: '2026-05-08T00:00:00Z' },
                // not an object
                'not-an-object',
                // valid with optionals
                { source: 'a::n1', target: 'c::n3', relation: 'imports', method: 'manual', confidence: 0.5, discovered_at: '2026-05-08T00:00:00Z', channel: 'queueX' },
            ],
        };
        writeFileSync(linksFile, JSON.stringify(data));
        const script = `
import sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.links_loader import load_links_file
v, entries = load_links_file(Path(${JSON.stringify(linksFile)}))
assert v == 1
assert len(entries) == 2, f"expected 2 valid entries, got {len(entries)}"
assert entries[0]['relation'] == 'calls'
assert entries[1]['channel'] == 'queueX'
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `schema validation script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);

        // Malformed JSON entirely — server should not crash; loader returns [].
        writeFileSync(linksFile, '{ this is not json');
        const script2 = `
import sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.links_loader import load_links_file
v, entries = load_links_file(Path(${JSON.stringify(linksFile)}))
assert entries == []
print('OK')
`;
        const r2 = spawnSync(PY_WITH_DEPS, ['-c', script2], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r2.status, 0, `unparseable JSON script failed: ${r2.stderr}`);
        assert.match(r2.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// Tier A item 5 — graceful per-repo failure
// ---------------------------------------------------------------------------

test('GraphState: corrupt graph file marks repo unavailable; valid repos still queryable', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        mkdirSync(graphsDir, { recursive: true });
        // Valid graphify-style graph (node-link).
        const validGraph = {
            directed: false,
            multigraph: false,
            graph: {},
            nodes: [{ id: 'n1', label: 'Hello' }, { id: 'n2', label: 'World' }],
            links: [{ source: 'n1', target: 'n2', relation: 'calls' }],
        };
        writeFileSync(join(graphsDir, 'good.json'), JSON.stringify(validGraph));
        writeFileSync(join(graphsDir, 'bad.json'), '{ corrupt');
        const script = `
import sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import query_graph, get_node, graph_stats

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
assert 'good' in state.graphs, f"good not loaded: {state.graphs.keys()}"
assert state.is_unavailable('bad'), 'bad should be marked unavailable'
# Filtered tool call against unavailable repo returns the warning shape.
out = query_graph(state, {'question': 'Hello', 'repo_filter': 'bad'})
assert 'warning' in out and 'unavailable' in out, out
# Tool call against good repo works.
out2 = get_node(state, {'label': 'Hello', 'repo_filter': 'good'})
assert 'Hello' in out2, out2
# No-filter graph_stats should skip the bad repo, not crash.
out3 = graph_stats(state, {})
assert 'Repos loaded: 1' in out3, out3
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `graceful-failure script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// Tier A item 1 — save_result writes to disk
// ---------------------------------------------------------------------------

test('save_result: persists Q/A pair to <group>-memory dir and returns path', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        // Override HOME so the save location lands in the tmpdir.
        const env = { ...process.env, HOME: tmp };
        const graphsDir = join(tmp, 'graphs');
        mkdirSync(graphsDir, { recursive: true });
        const script = `
import json, os, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import save_result

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = save_result(state, {
    'question': 'what calls Foo?',
    'answer': 'Bar calls Foo via import.',
    'type': 'query',
    'nodes': ['repoA::n1', 'repoB::n2'],
}, group='upvate')
parsed = json.loads(out)
assert 'memory_path' in parsed and 'saved_at' in parsed, parsed
p = Path(parsed['memory_path'])
assert p.exists() and p.stat().st_size > 0
data = json.loads(p.read_text())
assert data['version'] == 1
assert data['question'].startswith('what calls Foo')
assert data['type'] == 'query'
assert data['nodes'] == ['repoA::n1', 'repoB::n2']
# Group-memory dir is under the (overridden) HOME.
assert str(p).startswith(${JSON.stringify(tmp)}), str(p)
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000, env });
        assert.equal(r.status, 0, `save_result script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// list_link_candidates / resolve_link_candidate
// ---------------------------------------------------------------------------

function seedCandidatesFile(path, candidates) {
    writeFileSync(path, JSON.stringify({ version: 1, candidates }));
}

test('list_link_candidates: filters by channel/method, sorts by confidence desc, truncates to limit', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        mkdirSync(graphsDir, { recursive: true });
        const candPath = join(tmp, 'cands.json');
        seedCandidatesFile(candPath, [
            { source: 'a::n1', target: 'b::n2', relation: 'r', method: 'label_match', confidence: 0.4, discovered_at: '2026-04-01T00:00:00Z', channel: null },
            { source: 'a::n3', target: 'b::n4', relation: 'r', method: 'string',      confidence: 0.7, discovered_at: '2026-04-02T00:00:00Z', channel: 'http' },
            { source: 'a::n5', target: 'b::n6', relation: 'r', method: 'label_match', confidence: 0.6, discovered_at: '2026-04-03T00:00:00Z', channel: null },
            { source: 'a::n7', target: 'b::n8', relation: 'r', method: 'string',      confidence: 0.7, discovered_at: '2026-04-04T00:00:00Z', channel: 'redis_key' },
            { source: 'c::n9', target: 'd::n0', relation: 'r', method: 'label_match', confidence: 0.5, discovered_at: '2026-04-05T00:00:00Z', channel: null },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import list_link_candidates

state = GraphState(Path(${JSON.stringify(graphsDir)}), None, Path(${JSON.stringify(candPath)}), None)
state.initial_load()
# No filter, limit 2 -> sort by confidence desc, two highest at 0.7
out = json.loads(list_link_candidates(state, {'limit': 2}))
assert out['total'] == 5, out
assert out['shown'] == 2
assert out['candidates'][0]['confidence'] == 0.7
assert out['candidates'][1]['confidence'] == 0.7
# Tiebreak: older discovered_at first.
assert out['candidates'][0]['discovered_at'] < out['candidates'][1]['discovered_at']
# method filter
out2 = json.loads(list_link_candidates(state, {'method': 'label_match'}))
assert out2['total'] == 3, out2
# channel filter
out3 = json.loads(list_link_candidates(state, {'channel': 'http'}))
assert out3['total'] == 1 and out3['candidates'][0]['channel'] == 'http'
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `list_link_candidates script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('list_link_candidates: repo_filter matches source OR target prefix', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        mkdirSync(graphsDir, { recursive: true });
        const candPath = join(tmp, 'cands.json');
        seedCandidatesFile(candPath, [
            { source: 'backend::a', target: 'frontend::b', relation: 'r', method: 'label_match', confidence: 0.5, discovered_at: '2026-04-01T00:00:00Z' },
            { source: 'mobile::c',  target: 'core::d',     relation: 'r', method: 'label_match', confidence: 0.5, discovered_at: '2026-04-02T00:00:00Z' },
            { source: 'core::e',    target: 'backend::f',  relation: 'r', method: 'label_match', confidence: 0.5, discovered_at: '2026-04-03T00:00:00Z' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import list_link_candidates

state = GraphState(Path(${JSON.stringify(graphsDir)}), None, Path(${JSON.stringify(candPath)}), None)
state.initial_load()
out = json.loads(list_link_candidates(state, {'repo_filter': 'backend'}))
assert out['total'] == 2, out
sources = [c['source'] for c in out['candidates']]
assert 'mobile::c' not in sources
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `repo_filter script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('resolve_link_candidate: confirm moves entry to links file with +resolved suffix and confidence 1.0', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        mkdirSync(graphsDir, { recursive: true });
        const candPath = join(tmp, 'cands.json');
        const linksFile = join(tmp, 'links.json');
        const rejPath = join(tmp, 'rej.json');
        seedCandidatesFile(candPath, [
            { source: 'a::n1', target: 'b::n2', relation: 'shared_label', method: 'label_match', confidence: 0.45, discovered_at: '2026-04-01T00:00:00Z', channel: null, identifier: 'order' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import list_link_candidates, resolve_link_candidate

state = GraphState(Path(${JSON.stringify(graphsDir)}), Path(${JSON.stringify(linksFile)}), Path(${JSON.stringify(candPath)}), Path(${JSON.stringify(rejPath)}))
state.initial_load()
listed = json.loads(list_link_candidates(state, {}))
cid = listed['candidates'][0]['id']
assert cid, 'expected backfilled id'
out = json.loads(resolve_link_candidate(state, {'candidate_id': cid, 'decision': 'confirm', 'reason': 'verified by review'}))
assert out['resolved'] is True and out['decision'] == 'confirm' and out['moved_to'] == 'links', out

# Candidates file empty
cands_after = json.loads(open(${JSON.stringify(candPath)}).read())
assert cands_after['candidates'] == [], cands_after

# Links file has the promoted entry
links_after = json.loads(open(${JSON.stringify(linksFile)}).read())
assert len(links_after['links']) == 1
link = links_after['links'][0]
assert link['method'] == 'label_match+resolved', link
assert link['confidence'] == 1.0
assert link['resolution']['by'] == 'agent'
assert link['resolution']['reason'] == 'verified by review'
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `confirm script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('resolve_link_candidate: reject moves entry from candidates to rejections file', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        mkdirSync(graphsDir, { recursive: true });
        const candPath = join(tmp, 'cands.json');
        const linksFile = join(tmp, 'links.json');
        const rejPath = join(tmp, 'rej.json');
        seedCandidatesFile(candPath, [
            { source: 'a::n1', target: 'b::n2', relation: 'shared_label', method: 'label_match', confidence: 0.4, discovered_at: '2026-04-01T00:00:00Z' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import list_link_candidates, resolve_link_candidate

state = GraphState(Path(${JSON.stringify(graphsDir)}), Path(${JSON.stringify(linksFile)}), Path(${JSON.stringify(candPath)}), Path(${JSON.stringify(rejPath)}))
state.initial_load()
listed = json.loads(list_link_candidates(state, {}))
cid = listed['candidates'][0]['id']
out = json.loads(resolve_link_candidate(state, {'candidate_id': cid, 'decision': 'reject', 'reason': 'false positive'}))
assert out['moved_to'] == 'rejections' and out['decision'] == 'reject', out

cands_after = json.loads(open(${JSON.stringify(candPath)}).read())
assert cands_after['candidates'] == []

rej_after = json.loads(open(${JSON.stringify(rejPath)}).read())
assert len(rej_after['rejections']) == 1
assert rej_after['rejections'][0]['resolution']['reason'] == 'false positive'
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `reject script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('resolve_link_candidate: not found returns error shape', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs');
        mkdirSync(graphsDir, { recursive: true });
        const candPath = join(tmp, 'cands.json');
        const linksFile = join(tmp, 'links.json');
        const rejPath = join(tmp, 'rej.json');
        seedCandidatesFile(candPath, []);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import resolve_link_candidate

state = GraphState(Path(${JSON.stringify(graphsDir)}), Path(${JSON.stringify(linksFile)}), Path(${JSON.stringify(candPath)}), Path(${JSON.stringify(rejPath)}))
state.initial_load()
out = json.loads(resolve_link_candidate(state, {'candidate_id': 'deadbeef', 'decision': 'confirm'}))
assert out.get('error') == 'candidate not found' and out.get('candidate_id') == 'deadbeef', out
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `not-found script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// ensureGroupGraphsDir / symlink layout (preserved from earlier tests)
// ---------------------------------------------------------------------------

test('ensureGroupGraphsDir: creates one symlink per repo pointing at graphify-out/graph.json', () => {
    const tmp = mkTmp();
    try {
        process.env.GFLEET_STATE_DIR = tmp;
        const repoA = join(tmp, 'repoA');
        const repoB = join(tmp, 'repoB');
        mkdirSync(join(repoA, 'graphify-out'), { recursive: true });
        mkdirSync(join(repoB, 'graphify-out'), { recursive: true });
        writeFileSync(join(repoA, 'graphify-out', 'graph.json'), '{"nodes":[],"links":[]}');
        writeFileSync(join(repoB, 'graphify-out', 'graph.json'), '{"nodes":[],"links":[]}');
        const dir = ensureGroupGraphsDir('grp', [
            { slug: 'a', path: repoA },
            { slug: 'b', path: repoB },
        ]);
        const expected = groupGraphsDir('grp');
        assert.equal(dir, expected);
        const entries = readdirSync(dir).sort();
        assert.deepEqual(entries, ['a.json', 'b.json']);
        if (process.platform !== 'win32') {
            assert.ok(lstatSync(join(dir, 'a.json')).isSymbolicLink());
            assert.equal(readlinkSync(join(dir, 'a.json')), join(repoA, 'graphify-out', 'graph.json'));
        }
    } finally {
        delete process.env.GFLEET_STATE_DIR;
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('ensureGroupGraphsDir: idempotent — re-running with same repos is a no-op', () => {
    const tmp = mkTmp();
    try {
        process.env.GFLEET_STATE_DIR = tmp;
        const repo = join(tmp, 'repo');
        mkdirSync(join(repo, 'graphify-out'), { recursive: true });
        writeFileSync(join(repo, 'graphify-out', 'graph.json'), '{}');
        ensureGroupGraphsDir('g', [{ slug: 'a', path: repo }]);
        const before = readdirSync(groupGraphsDir('g')).sort();
        ensureGroupGraphsDir('g', [{ slug: 'a', path: repo }]);
        const after = readdirSync(groupGraphsDir('g')).sort();
        assert.deepEqual(before, after);
    } finally {
        delete process.env.GFLEET_STATE_DIR;
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('ensureGroupGraphsDir: sweeps stale entries from prior runs', () => {
    const tmp = mkTmp();
    try {
        process.env.GFLEET_STATE_DIR = tmp;
        const repoA = join(tmp, 'a'); const repoB = join(tmp, 'b');
        mkdirSync(join(repoA, 'graphify-out'), { recursive: true });
        mkdirSync(join(repoB, 'graphify-out'), { recursive: true });
        writeFileSync(join(repoA, 'graphify-out', 'graph.json'), '{}');
        writeFileSync(join(repoB, 'graphify-out', 'graph.json'), '{}');
        ensureGroupGraphsDir('g', [{ slug: 'a', path: repoA }, { slug: 'b', path: repoB }]);
        // Now drop b — should sweep b.json
        ensureGroupGraphsDir('g', [{ slug: 'a', path: repoA }]);
        assert.deepEqual(readdirSync(groupGraphsDir('g')).sort(), ['a.json']);
    } finally {
        delete process.env.GFLEET_STATE_DIR;
        rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// get_node_source
// ---------------------------------------------------------------------------

// Build a graphs-dir containing one repo's graph that points at a given source file.
function seedGraphFile(graphsDir, repoSlug, nodes) {
    const data = {
        directed: false,
        multigraph: false,
        graph: {},
        nodes,
        links: [],
    };
    writeFileSync(join(graphsDir, `${repoSlug}.json`), JSON.stringify(data));
}

test('get_node_source: happy path returns snippet around the target line', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        const srcFile = join(tmp, 'sample.py');
        const lines = [];
        for (let i = 1; i <= 50; i++) lines.push(`line_${i}`);
        writeFileSync(srcFile, lines.join('\n'));
        seedGraphFile(graphsDir, 'r', [
            { id: 'n1', label: 'thing', source_file: srcFile, source_location: 'L25' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import get_node_source

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = json.loads(get_node_source(state, {'node_id': 'r::n1', 'context_lines': 5}))
assert out['snippet_start_line'] == 20, out
assert out['snippet_end_line'] == 30, out
assert out['language'] == 'python', out
assert 'line_25' in out['snippet']
assert 'line_20' in out['snippet']
assert 'line_30' in out['snippet']
assert out['node_label'] == 'thing'
assert out['repo'] == 'r'
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `get_node_source happy script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('get_node_source: missing source file returns error shape', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        seedGraphFile(graphsDir, 'r', [
            { id: 'n1', label: 'gone', source_file: join(tmp, 'does-not-exist.py'), source_location: 'L1' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import get_node_source

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = json.loads(get_node_source(state, {'node_id': 'r::n1'}))
assert out.get('error') == 'source file missing', out
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `missing-file script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('get_node_source: context_lines clamped to 200', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        const srcFile = join(tmp, 'big.py');
        const lines = [];
        for (let i = 1; i <= 1000; i++) lines.push(`line_${i}`);
        writeFileSync(srcFile, lines.join('\n'));
        seedGraphFile(graphsDir, 'r', [
            { id: 'n1', label: 'mid', source_file: srcFile, source_location: 'L500' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import get_node_source

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = json.loads(get_node_source(state, {'node_id': 'r::n1', 'context_lines': 500}))
# Clamped to 200 → start=300, end=700
assert out['snippet_start_line'] == 300, out
assert out['snippet_end_line'] == 700, out
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `clamp script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('get_node_source: language detection picks python and typescript', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        const py = join(tmp, 'a.py'); writeFileSync(py, 'x = 1\n');
        const ts = join(tmp, 'b.ts'); writeFileSync(ts, 'const x = 1;\n');
        seedGraphFile(graphsDir, 'r', [
            { id: 'p', label: 'p', source_file: py, source_location: 'L1' },
            { id: 't', label: 't', source_file: ts, source_location: 'L1' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import get_node_source

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
op = json.loads(get_node_source(state, {'node_id': 'r::p'}))
ot = json.loads(get_node_source(state, {'node_id': 'r::t'}))
assert op['language'] == 'python', op
assert ot['language'] == 'typescript', ot
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `language script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// recent_activity
// ---------------------------------------------------------------------------

test('recent_activity: relative duration filter returns only recently mtimed nodes', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        const fOld = join(tmp, 'old.py'); writeFileSync(fOld, 'x\n');
        const fMid = join(tmp, 'mid.py'); writeFileSync(fMid, 'x\n');
        const fNew = join(tmp, 'new.py'); writeFileSync(fNew, 'x\n');
        // Backdate fOld 2 days, fMid 2 hours; fNew now.
        const now = Date.now() / 1000;
        const utimes = (p, t) => { utimesSync(p, t, t); };
        utimes(fOld, now - 2 * 86400);
        utimes(fMid, now - 2 * 3600);
        utimes(fNew, now - 60);
        seedGraphFile(graphsDir, 'r', [
            { id: 'a', label: 'a', source_file: fOld, source_location: 'L1' },
            { id: 'b', label: 'b', source_file: fMid, source_location: 'L1' },
            { id: 'c', label: 'c', source_file: fNew, source_location: 'L1' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import recent_activity

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = json.loads(recent_activity(state, {'since': '1h'}))
assert out['shown'] == 1, out
assert out['nodes'][0]['node_id'] == 'r::c', out
assert out['total_changed_files'] == 1, out
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `relative-duration script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('recent_activity: ISO timestamp cutoff', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        const fOld = join(tmp, 'o.py'); writeFileSync(fOld, 'x\n');
        const fNew = join(tmp, 'n.py'); writeFileSync(fNew, 'x\n');
        const now = Date.now() / 1000;
        const utimes = (p, t) => { utimesSync(p, t, t); };
        utimes(fOld, now - 10 * 86400);
        utimes(fNew, now - 60);
        // Cutoff 5 days ago.
        const cutoff = new Date((now - 5 * 86400) * 1000).toISOString();
        seedGraphFile(graphsDir, 'r', [
            { id: 'a', label: 'a', source_file: fOld, source_location: 'L1' },
            { id: 'b', label: 'b', source_file: fNew, source_location: 'L1' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import recent_activity

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = json.loads(recent_activity(state, {'since': ${JSON.stringify(cutoff)}}))
assert out['shown'] == 1, out
assert out['nodes'][0]['node_id'] == 'r::b', out
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `iso-timestamp script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('recent_activity: repo_filter scopes results to one repo', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        const fA = join(tmp, 'a.py'); writeFileSync(fA, 'x\n');
        const fB = join(tmp, 'b.py'); writeFileSync(fB, 'x\n');
        seedGraphFile(graphsDir, 'repoA', [
            { id: 'na', label: 'na', source_file: fA, source_location: 'L1' },
        ]);
        seedGraphFile(graphsDir, 'repoB', [
            { id: 'nb', label: 'nb', source_file: fB, source_location: 'L1' },
        ]);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import recent_activity

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = json.loads(recent_activity(state, {'since': '7d', 'repo_filter': 'repoA'}))
assert out['shown'] == 1, out
assert out['nodes'][0]['node_id'] == 'repoA::na', out
out_all = json.loads(recent_activity(state, {'since': '7d'}))
assert out_all['shown'] == 2, out_all
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `repo-filter script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('recent_activity: limit truncates and total_changed_files counts pre-truncation', { skip: PY_WITH_DEPS ? false : 'python with networkx not available' }, () => {
    const tmp = mkTmp();
    try {
        const graphsDir = join(tmp, 'graphs'); mkdirSync(graphsDir, { recursive: true });
        const nodes = [];
        for (let i = 0; i < 5; i++) {
            const f = join(tmp, `f${i}.py`);
            writeFileSync(f, 'x\n');
            nodes.push({ id: `n${i}`, label: `n${i}`, source_file: f, source_location: 'L1' });
        }
        seedGraphFile(graphsDir, 'r', nodes);
        const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'src'))})
from pathlib import Path
from mcp_server.state import GraphState
from mcp_server.tools import recent_activity

state = GraphState(Path(${JSON.stringify(graphsDir)}), None)
state.initial_load()
out = json.loads(recent_activity(state, {'since': '7d', 'limit': 2}))
assert out['shown'] == 2, out
assert out['total_changed_files'] == 5, out
print('OK')
`;
        const r = spawnSync(PY_WITH_DEPS, ['-c', script], { encoding: 'utf8', timeout: 10000 });
        assert.equal(r.status, 0, `limit script failed: ${r.stderr}`);
        assert.match(r.stdout, /OK/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// Tests for the gfleet-owned MCP server fork at `src/mcp-server/server.py`
// and the graphs-dir symlink layout produced by `ensureGroupGraphsDir`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readlinkSync, lstatSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureGroupGraphsDir, mcpServerPath, groupGraphsDir } from '../src/integrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PY = join(__dirname, '..', 'src', 'mcp-server', 'server.py');

const PY = (() => {
    for (const cand of ['python3', 'python']) {
        const r = spawnSync(cand, ['--version']);
        if (r.status === 0) return cand;
    }
    return null;
})();

function mkTmp() { return mkdtempSync(join(tmpdir(), 'gfleet-mcp-')); }

test('server.py: parses cleanly under python -c ast.parse', { skip: PY ? false : 'python not on PATH' }, () => {
    const r = spawnSync(PY, ['-c', `import ast; ast.parse(open(${JSON.stringify(SERVER_PY)}).read())`]);
    assert.equal(r.status, 0, `ast.parse failed: ${r.stderr.toString()}`);
});

test('server.py: --help surfaces graphs_dir + --group args (no mcp dep needed for argparse)', { skip: PY ? false : 'python not on PATH' }, () => {
    // argparse runs before the mcp import path; --help should exit 0 even if
    // networkx / mcp aren't available. If networkx is missing the import at
    // top of the file fails, in which case skip — that's not what we're
    // verifying here.
    const probe = spawnSync(PY, ['-c', 'import networkx'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        return; // can't validate without networkx; skip silently in CI without graphify env
    }
    const r = spawnSync(PY, [SERVER_PY, '--help'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, `--help exit ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /graphs_dir/);
    assert.match(r.stdout, /--group/);
});

test('mcpServerPath: resolves to an existing file under src/mcp-server/', () => {
    const p = mcpServerPath();
    assert.equal(p, SERVER_PY);
    assert.ok(existsSync(p), `expected ${p} to exist`);
});

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

// Tests for src/util.js — pure helpers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    expandPath, flattenRepos, getGitDir, readJson, writeJson, loadConfig, levenshtein, HOME,
} from '../src/util.js';

function mkTmp() {
    return mkdtempSync(join(tmpdir(), 'gfleet-test-'));
}

test('expandPath: bare ~ returns HOME', () => {
    assert.equal(expandPath('~'), HOME);
});

test('expandPath: ~/foo joins with HOME', () => {
    assert.equal(expandPath('~/foo'), join(HOME, 'foo'));
});

test('expandPath: ~\\foo (Windows) joins with HOME', () => {
    assert.equal(expandPath('~\\foo'), join(HOME, 'foo'));
});

test('expandPath: absolute path untouched', () => {
    const p = '/absolute/path/here';
    assert.equal(expandPath(p), p);
});

test('expandPath: relative path untouched', () => {
    assert.equal(expandPath('relative/path'), 'relative/path');
});

test('expandPath: undefined / empty pass through', () => {
    assert.equal(expandPath(undefined), undefined);
    assert.equal(expandPath(''), '');
});

test('expandPath: tilde-only-prefix word like ~user not expanded', () => {
    // ~user is not ~/, ~\, or ~ alone — should be untouched.
    assert.equal(expandPath('~user'), '~user');
});

test('flattenRepos: standalone repo with no type', () => {
    const flat = flattenRepos([{ path: '/tmp/abc', stack: 'node' }]);
    assert.equal(flat.length, 1);
    assert.equal(flat[0].path, '/tmp/abc');
    assert.equal(flat[0].slug, 'abc');
    assert.equal(flat[0].stack, 'node');
    assert.equal(flat[0].monorepoRoot, null);
});

test('flattenRepos: standalone repo, default stack=generic', () => {
    const flat = flattenRepos([{ path: '/tmp/xyz' }]);
    assert.equal(flat[0].stack, 'generic');
});

test('flattenRepos: monorepo entry with modules sets monorepoRoot', () => {
    const flat = flattenRepos([{
        type: 'monorepo',
        path: '/tmp/big-mono',
        modules: [
            { path: 'packages/a', stack: 'node' },
            { path: 'packages/b', stack: 'python-generic' },
        ],
    }]);
    assert.equal(flat.length, 2);
    assert.equal(flat[0].monorepoRoot, '/tmp/big-mono');
    assert.equal(flat[0].path, join('/tmp/big-mono', 'packages/a'));
    assert.equal(flat[0].slug, 'big-mono-packages-a');
    assert.equal(flat[1].slug, 'big-mono-packages-b');
});

test('flattenRepos: monorepo with explicit slug overrides default', () => {
    const flat = flattenRepos([{
        type: 'monorepo',
        path: '/tmp/big',
        modules: [{ path: 'packages/api', slug: 'my-api', stack: 'node' }],
    }]);
    assert.equal(flat[0].slug, 'my-api');
});

test('flattenRepos: mixed standalone + monorepo', () => {
    const flat = flattenRepos([
        { path: '/tmp/standalone' },
        { type: 'monorepo', path: '/tmp/m', modules: [{ path: 'p/x', stack: 'go' }] },
    ]);
    assert.equal(flat.length, 2);
    assert.equal(flat[0].monorepoRoot, null);
    assert.equal(flat[1].monorepoRoot, '/tmp/m');
});

test('flattenRepos: nested module path produces correct slug', () => {
    const flat = flattenRepos([{
        type: 'monorepo',
        path: '/tmp/proj',
        modules: [{ path: 'packages/api/v2', stack: 'node' }],
    }]);
    assert.equal(flat[0].slug, 'proj-packages-api-v2');
});

test('getGitDir: directory .git', () => {
    const dir = mkTmp();
    try {
        mkdirSync(join(dir, '.git'));
        assert.equal(getGitDir(dir), join(dir, '.git'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getGitDir: worktree .git file with gitdir pointer', () => {
    const dir = mkTmp();
    try {
        const target = join(dir, 'real-gitdir');
        mkdirSync(target);
        writeFileSync(join(dir, '.git'), `gitdir: ${target}\n`);
        assert.equal(getGitDir(dir), target);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getGitDir: worktree .git file with relative gitdir pointer', () => {
    const dir = mkTmp();
    try {
        mkdirSync(join(dir, 'sub'));
        writeFileSync(join(dir, '.git'), 'gitdir: sub\n');
        // Resolved relative to gitRoot
        const got = getGitDir(dir);
        assert.ok(got && got.endsWith('sub'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getGitDir: missing .git returns null', () => {
    const dir = mkTmp();
    try {
        assert.equal(getGitDir(dir), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getGitDir: .git file without gitdir line returns null', () => {
    const dir = mkTmp();
    try {
        writeFileSync(join(dir, '.git'), 'garbage\n');
        assert.equal(getGitDir(dir), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readJson / writeJson round-trip', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'x', 'a.json');
        writeJson(p, { a: 1, nested: { b: [1, 2] } });
        assert.deepEqual(readJson(p), { a: 1, nested: { b: [1, 2] } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readJson: missing file with fallback returns fallback', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'nope.json');
        assert.deepEqual(readJson(p, { default: true }), { default: true });
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readJson: missing file with no fallback throws', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'nope.json');
        assert.throws(() => readJson(p), /not found/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeJson: atomic — no temp file leftover', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'final.json');
        writeJson(p, { ok: true });
        const remaining = readdirSync(dir);
        // Only the final file should exist; tmp pattern is `${p}.tmp.*`
        assert.deepEqual(remaining, ['final.json']);
        // Verify no leftover .tmp.* files
        assert.ok(!remaining.some(n => n.includes('.tmp.')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: minimal valid config', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'cfg.json');
        writeJson(p, {
            group: 'g1',
            repos: [{ path: '/tmp/some-repo', stack: 'node' }],
        });
        const cfg = loadConfig(p);
        assert.equal(cfg.group, 'g1');
        assert.equal(cfg.repos.length, 1);
        assert.equal(cfg.options.watchers, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

// die() calls process.exit, which would kill the test runner. Verify by
// spawning a child node process that imports loadConfig and asserts a
// non-zero exit code.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UTIL_PATH = pathResolve(__dirname, '..', 'src', 'util.js');

function spawnLoadConfig(cfgPath) {
    const code = `import('${UTIL_PATH.replace(/\\/g, '\\\\')}').then(m => m.loadConfig(${JSON.stringify(cfgPath)})).catch(e => { console.error(e.message); process.exit(2); });`;
    return spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
}

test('loadConfig: missing group dies', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'cfg.json');
        writeJson(p, { repos: [{ path: '/x' }] });
        const r = spawnLoadConfig(p);
        assert.notEqual(r.status, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: missing repos dies', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'cfg.json');
        writeJson(p, { group: 'g' });
        const r = spawnLoadConfig(p);
        assert.notEqual(r.status, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: monorepo entries are flattened', () => {
    const dir = mkTmp();
    try {
        const p = join(dir, 'cfg.json');
        writeJson(p, {
            group: 'g',
            repos: [
                { type: 'monorepo', path: '/tmp/m', modules: [
                    { path: 'a', stack: 'node' }, { path: 'b', stack: 'go' },
                ]},
                { path: '/tmp/standalone', stack: 'python-generic' },
            ],
        });
        const cfg = loadConfig(p);
        assert.equal(cfg.repos.length, 3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('levenshtein: identical strings → 0', () => {
    assert.equal(levenshtein('upvate', 'upvate'), 0);
});

test('levenshtein: single edit', () => {
    assert.equal(levenshtein('upvate', 'upvates'), 1);
    assert.equal(levenshtein('cat', 'bat'), 1);
});

test('levenshtein: empty strings', () => {
    assert.equal(levenshtein('', ''), 0);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('abc', ''), 3);
});

test('levenshtein: completely different', () => {
    assert.equal(levenshtein('abc', 'xyz'), 3);
});

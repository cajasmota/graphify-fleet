// Tests for src/util.js — pure helpers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    expandPath, flattenRepos, getGitDir, readJson, writeJson, loadConfig, levenshtein, HOME,
    parseSemver, semverCompare, classifyGraphifyVersion, resolvedGraphifyPin,
    GRAPHIFY_MIN_VERSION, GRAPHIFY_TESTED_MAX,
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

// ---------------------------------------------------------------------------
// Semver helpers + graphify version-floor logic
// ---------------------------------------------------------------------------

test('parseSemver: basic X.Y.Z', () => {
    assert.deepEqual(parseSemver('0.7.9'), [0, 7, 9]);
    assert.deepEqual(parseSemver('1.0.0'), [1, 0, 0]);
});

test('parseSemver: shorter forms padded with zeros', () => {
    assert.deepEqual(parseSemver('1'), [1, 0, 0]);
    assert.deepEqual(parseSemver('1.2'), [1, 2, 0]);
});

test('parseSemver: leading v ignored, prerelease stripped', () => {
    assert.deepEqual(parseSemver('v0.8.0'), [0, 8, 0]);
    assert.deepEqual(parseSemver('0.8.0-rc1'), [0, 8, 0]);
    assert.deepEqual(parseSemver('0.8.0+build.5'), [0, 8, 0]);
});

test('parseSemver: garbage returns null', () => {
    assert.equal(parseSemver('garbage'), null);
    assert.equal(parseSemver(undefined), null);
    assert.equal(parseSemver(null), null);
    assert.equal(parseSemver(''), null);
});

test('semverCompare: equal', () => {
    assert.equal(semverCompare('0.7.9', '0.7.9'), 0);
    assert.equal(semverCompare('1.0', '1.0.0'), 0);
});

test('semverCompare: greater / lesser', () => {
    assert.equal(semverCompare('0.8.0', '0.7.9'), 1);
    assert.equal(semverCompare('0.7.9', '0.8.0'), -1);
    assert.equal(semverCompare('1.0.0', '0.99.99'), 1);
});

test('semverCompare: patch-level differences', () => {
    assert.equal(semverCompare('0.7.10', '0.7.9'), 1);
    assert.equal(semverCompare('0.7.9', '0.7.10'), -1);
});

test('semverCompare: unparseable returns null', () => {
    assert.equal(semverCompare('garbage', '0.7.9'), null);
    assert.equal(semverCompare('0.7.9', 'garbage'), null);
});

test('classifyGraphifyVersion: in_range / below / above / unknown', () => {
    assert.equal(classifyGraphifyVersion(GRAPHIFY_MIN_VERSION), 'in_range');
    assert.equal(classifyGraphifyVersion(GRAPHIFY_TESTED_MAX), 'in_range');
    assert.equal(classifyGraphifyVersion('0.7.0'), 'below');
    assert.equal(classifyGraphifyVersion('99.0.0'), 'above');
    assert.equal(classifyGraphifyVersion('garbage'), 'unknown');
});

test('resolvedGraphifyPin: env var wins, returns source=env', () => {
    const dir = mkTmp();
    const prev = process.env.GFLEET_GRAPHIFY_VERSION;
    const prevState = process.env.GFLEET_STATE_DIR;
    try {
        process.env.GFLEET_STATE_DIR = join(dir, '.graphify-fleet');
        process.env.GFLEET_GRAPHIFY_VERSION = '0.7.9';
        const r = resolvedGraphifyPin();
        assert.equal(r.version, '0.7.9');
        assert.equal(r.source, 'env');
    } finally {
        if (prev === undefined) delete process.env.GFLEET_GRAPHIFY_VERSION;
        else process.env.GFLEET_GRAPHIFY_VERSION = prev;
        if (prevState === undefined) delete process.env.GFLEET_STATE_DIR;
        else process.env.GFLEET_STATE_DIR = prevState;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('resolvedGraphifyPin: no env / no preferences returns null', () => {
    const dir = mkTmp();
    const prev = process.env.GFLEET_GRAPHIFY_VERSION;
    const prevState = process.env.GFLEET_STATE_DIR;
    try {
        // Point state dir at empty tmp — preferences.json absent → null.
        process.env.GFLEET_STATE_DIR = join(dir, '.graphify-fleet');
        delete process.env.GFLEET_GRAPHIFY_VERSION;
        // Re-import to pick up the env override (PREFERENCES_PATH is computed
        // at import time via FLEET_STATE_DIR). Use a child process to ensure
        // a clean module load.
        const code = `import('${UTIL_PATH.replace(/\\/g, '\\\\')}').then(m => { const r = m.resolvedGraphifyPin(); console.log(JSON.stringify(r)); });`;
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
            encoding: 'utf8',
            env: { ...process.env, GFLEET_STATE_DIR: process.env.GFLEET_STATE_DIR },
        });
        assert.equal(r.status, 0, r.stderr);
        const parsed = JSON.parse(r.stdout.trim());
        assert.equal(parsed.version, null);
        assert.equal(parsed.source, null);
    } finally {
        if (prev === undefined) delete process.env.GFLEET_GRAPHIFY_VERSION;
        else process.env.GFLEET_GRAPHIFY_VERSION = prev;
        if (prevState === undefined) delete process.env.GFLEET_STATE_DIR;
        else process.env.GFLEET_STATE_DIR = prevState;
        rmSync(dir, { recursive: true, force: true });
    }
});

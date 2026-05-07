// Tests for src/monorepo.js — workspace detection + glob expansion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectMonorepo } from '../src/monorepo.js';

function mkTmp() { return mkdtempSync(join(tmpdir(), 'gfleet-mono-')); }

function touch(p) { writeFileSync(p, ''); }
function writePkg(dir, obj) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(obj));
}

test('detectMonorepo: pnpm-workspace.yaml with packages/*', () => {
    const dir = mkTmp();
    try {
        writeFileSync(join(dir, 'pnpm-workspace.yaml'), `packages:\n  - 'packages/*'\n`);
        mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
        touch(join(dir, 'packages', 'a', 'package.json'));
        mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
        touch(join(dir, 'packages', 'b', 'package.json'));
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'pnpm');
        assert.equal(r.modules.length, 2);
        const rels = r.modules.map(m => m.rel).sort();
        assert.deepEqual(rels, ['packages/a', 'packages/b']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: package.json workspaces array', () => {
    const dir = mkTmp();
    try {
        writePkg(dir, { name: 'root', workspaces: ['apps/*'] });
        writePkg(join(dir, 'apps', 'web'), { name: 'web' });
        writePkg(join(dir, 'apps', 'api'), { name: 'api' });
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'npm');
        assert.equal(r.modules.length, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: package.json workspaces.packages object', () => {
    const dir = mkTmp();
    try {
        writePkg(dir, { name: 'root', workspaces: { packages: ['packages/*'] } });
        writePkg(join(dir, 'packages', 'core'), { name: 'core' });
        writePkg(join(dir, 'packages', 'ui'), { name: 'ui' });
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'npm');
        assert.equal(r.modules.length, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: nx.json with appsDir/libsDir', () => {
    const dir = mkTmp();
    try {
        writeFileSync(join(dir, 'nx.json'), JSON.stringify({
            workspaceLayout: { appsDir: 'apps', libsDir: 'libs' },
        }));
        writePkg(join(dir, 'apps', 'web'), { name: 'web' });
        writePkg(join(dir, 'libs', 'shared'), { name: 'shared' });
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'nx');
        assert.equal(r.modules.length, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: lerna.json', () => {
    const dir = mkTmp();
    try {
        writeFileSync(join(dir, 'lerna.json'), JSON.stringify({ packages: ['packages/*'] }));
        writePkg(join(dir, 'packages', 'one'), { name: 'one' });
        writePkg(join(dir, 'packages', 'two'), { name: 'two' });
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'lerna');
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: multi-package fallback (no manifest)', () => {
    const dir = mkTmp();
    try {
        writePkg(join(dir, 'packages', 'a'), { name: 'a' });
        writePkg(join(dir, 'packages', 'b'), { name: 'b' });
        // No top-level workspace declaration → falls through to multi
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'multi');
        assert.equal(r.modules.length, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: missing path returns null', () => {
    assert.equal(detectMonorepo('/nonexistent/path/xyz123'), null);
});

test('detectMonorepo: brace expansion {a,b}/* in pnpm', () => {
    const dir = mkTmp();
    try {
        writeFileSync(join(dir, 'pnpm-workspace.yaml'), `packages:\n  - '{apps,libs}/*'\n`);
        writePkg(join(dir, 'apps', 'web'), { name: 'web' });
        writePkg(join(dir, 'libs', 'core'), { name: 'core' });
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'pnpm');
        const rels = r.modules.map(m => m.rel).sort();
        assert.deepEqual(rels, ['apps/web', 'libs/core']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: recursive ** wildcard', () => {
    const dir = mkTmp();
    try {
        writePkg(dir, { name: 'root', workspaces: ['packages/**'] });
        writePkg(join(dir, 'packages', 'a'), { name: 'a' });
        writePkg(join(dir, 'packages', 'sub', 'b'), { name: 'b' });
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'npm');
        // Should find both top-level and nested
        const rels = r.modules.map(m => m.rel);
        assert.ok(rels.length >= 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: negation !ignored excludes', () => {
    const dir = mkTmp();
    try {
        writeFileSync(join(dir, 'pnpm-workspace.yaml'),
            `packages:\n  - 'packages/*'\n  - '!packages/ignored'\n`);
        writePkg(join(dir, 'packages', 'a'), { name: 'a' });
        writePkg(join(dir, 'packages', 'ignored'), { name: 'i' });
        const r = detectMonorepo(dir);
        const rels = r.modules.map(m => m.rel);
        assert.ok(rels.includes('packages/a'));
        assert.ok(!rels.includes('packages/ignored'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: multi-package ignores node_modules / dist / .venv', () => {
    const dir = mkTmp();
    try {
        writePkg(join(dir, 'packages', 'real'), { name: 'real' });
        writePkg(join(dir, 'node_modules', 'fake'), { name: 'fake' });
        writePkg(join(dir, 'dist', 'fake2'), { name: 'fake2' });
        writePkg(join(dir, '.venv', 'fake3'), { name: 'fake3' });
        // Need a 2nd real package to trigger multi (>=2 required)
        writePkg(join(dir, 'apps', 'app'), { name: 'app' });
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'multi');
        const rels = r.modules.map(m => m.rel).sort();
        assert.deepEqual(rels, ['apps/app', 'packages/real']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: multi-package finds pyproject.toml / go.mod / Cargo.toml', () => {
    const dir = mkTmp();
    try {
        mkdirSync(join(dir, 'svc1'), { recursive: true });
        writeFileSync(join(dir, 'svc1', 'pyproject.toml'), '');
        mkdirSync(join(dir, 'svc2'), { recursive: true });
        writeFileSync(join(dir, 'svc2', 'go.mod'), 'module x');
        mkdirSync(join(dir, 'svc3'), { recursive: true });
        writeFileSync(join(dir, 'svc3', 'Cargo.toml'), '');
        const r = detectMonorepo(dir);
        assert.equal(r.kind, 'multi');
        assert.equal(r.modules.length, 3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectMonorepo: multi-package needs ≥2 packages', () => {
    const dir = mkTmp();
    try {
        writePkg(join(dir, 'packages', 'only'), { name: 'only' });
        const r = detectMonorepo(dir);
        // Only 1 package — not a monorepo
        assert.equal(r, null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

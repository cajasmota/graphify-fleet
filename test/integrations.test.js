// Tests for src/integrations.js — pure file-mutating helpers.
// We avoid functions that shell out to git/graphify (writeMcpJson etc that
// call graphifyPython are tested by stubbing the resulting file content).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    updateGitignore, writeMcpJson, removeMcpEntry, upsertAgentRulesBlock,
    installMergeDriver, removeMergeDriver, writeGroupManifest, readGroupManifest,
} from '../src/integrations.js';

function mkTmp() { return mkdtempSync(join(tmpdir(), 'gfleet-int-')); }

// Isolate `~/.graphify-fleet` writes so writeMcpJson's symlink-creation
// doesn't pollute the user's real state during tests.
function withState(fn) {
    const tmpState = mkdtempSync(join(tmpdir(), 'gfleet-int-state-'));
    const prev = process.env.GFLEET_STATE_DIR;
    process.env.GFLEET_STATE_DIR = tmpState;
    try { return fn(); }
    finally {
        if (prev === undefined) delete process.env.GFLEET_STATE_DIR;
        else process.env.GFLEET_STATE_DIR = prev;
        try { rmSync(tmpState, { recursive: true, force: true }); } catch {}
    }
}

// --- updateGitignore ---

test('updateGitignore: fresh file', () => {
    const repo = mkTmp();
    try {
        updateGitignore(repo);
        const out = readFileSync(join(repo, '.gitignore'), 'utf8');
        assert.match(out, /# graphify-fleet/);
        assert.match(out, /docs\//);
        assert.match(out, /graphify-out\/wiki\//);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('updateGitignore: idempotent (skip if block already present)', () => {
    const repo = mkTmp();
    try {
        updateGitignore(repo);
        const first = readFileSync(join(repo, '.gitignore'), 'utf8');
        updateGitignore(repo);
        const second = readFileSync(join(repo, '.gitignore'), 'utf8');
        assert.equal(first, second);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('updateGitignore: preserves user content', () => {
    const repo = mkTmp();
    try {
        writeFileSync(join(repo, '.gitignore'), '# user stuff\n*.log\nnode_modules/\n');
        updateGitignore(repo);
        const out = readFileSync(join(repo, '.gitignore'), 'utf8');
        assert.match(out, /# user stuff/);
        assert.match(out, /\*\.log/);
        assert.match(out, /# graphify-fleet/);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

// --- writeMcpJson / removeMcpEntry ---

test('writeMcpJson: fresh creates file with group server only (no per-repo)', () => {
    withState(() => {
        const repo = mkTmp();
        try {
            writeMcpJson(repo, '/tmp/group.json', 'my-repo', 'my-group');
            const obj = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8'));
            // Group MCP only — repo-local queries use repo_filter against it.
            assert.ok(obj.mcpServers['graphify-my-group']);
            assert.equal(obj.mcpServers['graphify-my-repo'], undefined);
            // Args now point at the gfleet-owned server script + graphs-dir.
            const args = obj.mcpServers['graphify-my-group'].args;
            assert.ok(args.some(a => a.endsWith('__main__.py')), 'expected mcp_server/__main__.py in args');
            assert.ok(args.includes('--group'));
            assert.ok(args.includes('my-group'));
        } finally { rmSync(repo, { recursive: true, force: true }); }
    });
});

test('writeMcpJson: preserves non-graphify entries', () => {
    withState(() => {
        const repo = mkTmp();
        try {
            writeFileSync(join(repo, '.mcp.json'), JSON.stringify({
                mcpServers: { other: { command: 'foo', args: [] } },
            }));
            writeMcpJson(repo, '/tmp/g.json', 'r', 'g');
            const obj = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8'));
            assert.ok(obj.mcpServers.other);
            assert.ok(obj.mcpServers['graphify-g']);
            assert.equal(obj.mcpServers['graphify-r'], undefined);
        } finally { rmSync(repo, { recursive: true, force: true }); }
    });
});

test('writeMcpJson: heals leftover per-repo + stale graphify-* entries from older gfleet versions', () => {
    withState(() => {
        const repo = mkTmp();
        try {
            writeFileSync(join(repo, '.mcp.json'), JSON.stringify({
                mcpServers: {
                    'graphify-my-repo':       { command: 'old', args: [] },
                    'graphify-old-other-repo': { command: 'old', args: [] },
                    other:                    { command: 'foo', args: [] },
                },
            }));
            writeMcpJson(repo, '/tmp/g.json', 'my-repo', 'my-group');
            const obj = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8'));
            assert.ok(obj.mcpServers['graphify-my-group']);
            assert.equal(obj.mcpServers['graphify-my-repo'], undefined);
            assert.equal(obj.mcpServers['graphify-old-other-repo'], undefined);
            assert.ok(obj.mcpServers.other);
        } finally { rmSync(repo, { recursive: true, force: true }); }
    });
});

test('writeMcpJson: removes legacy single-key graphify entry', () => {
    withState(() => {
        const repo = mkTmp();
        try {
            writeFileSync(join(repo, '.mcp.json'), JSON.stringify({
                mcpServers: { graphify: { command: 'old', args: [] } },
            }));
            writeMcpJson(repo, '/tmp/g.json', 'r', 'g');
            const obj = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8'));
            assert.equal(obj.mcpServers.graphify, undefined);
        } finally { rmSync(repo, { recursive: true, force: true }); }
    });
});

test('removeMcpEntry: preserves non-graphify entries', () => {
    const repo = mkTmp();
    try {
        writeFileSync(join(repo, '.mcp.json'), JSON.stringify({
            mcpServers: {
                'graphify-r': { command: 'x' },
                'graphify-g': { command: 'x' },
                other: { command: 'y' },
            },
        }));
        removeMcpEntry(repo, 'r', 'g');
        const obj = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8'));
        assert.equal(obj.mcpServers['graphify-r'], undefined);
        assert.equal(obj.mcpServers['graphify-g'], undefined);
        assert.ok(obj.mcpServers.other);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('removeMcpEntry: deletes file when only graphify entries existed', () => {
    const repo = mkTmp();
    try {
        const f = join(repo, '.mcp.json');
        writeFileSync(f, JSON.stringify({
            mcpServers: { 'graphify-r': { command: 'x' }, 'graphify-g': { command: 'x' } },
        }));
        removeMcpEntry(repo, 'r', 'g');
        assert.ok(!existsSync(f));
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('removeMcpEntry: preserves file with other top-level keys', () => {
    const repo = mkTmp();
    try {
        const f = join(repo, '.mcp.json');
        writeFileSync(f, JSON.stringify({
            mcpServers: { 'graphify-r': { command: 'x' } },
            otherTopLevel: { something: true },
        }));
        removeMcpEntry(repo, 'r', null);
        assert.ok(existsSync(f));
        const obj = JSON.parse(readFileSync(f, 'utf8'));
        assert.deepEqual(obj.otherTopLevel, { something: true });
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

// --- upsertAgentRulesBlock ---

test('upsertAgentRulesBlock: fresh file', () => {
    const repo = mkTmp();
    try {
        const f = join(repo, 'CLAUDE.md');
        upsertAgentRulesBlock(f, 'g', '/tmp/g.json', [{ slug: 'a', stack: 'node', path: '/x' }], null, 'a');
        const out = readFileSync(f, 'utf8');
        assert.match(out, /<!-- gfleet:graphify-rules:start -->/);
        assert.match(out, /<!-- gfleet:graphify-rules:end -->/);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('upsertAgentRulesBlock: replace existing markered block', () => {
    const repo = mkTmp();
    try {
        const f = join(repo, 'CLAUDE.md');
        upsertAgentRulesBlock(f, 'g1', '/tmp/g.json', [], null, 'a');
        const before = readFileSync(f, 'utf8');
        upsertAgentRulesBlock(f, 'g2', '/tmp/g.json', [], null, 'a');
        const after = readFileSync(f, 'utf8');
        // Only one start marker
        assert.equal((after.match(/<!-- gfleet:graphify-rules:start -->/g) || []).length, 1);
        assert.notEqual(before, after);
        assert.match(after, /g2/);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('upsertAgentRulesBlock: replace legacy ## graphify section', () => {
    const repo = mkTmp();
    try {
        const f = join(repo, 'CLAUDE.md');
        writeFileSync(f, `# My rules\nuser content\n\n## graphify\nold content\n\n## next\nkept\n`);
        upsertAgentRulesBlock(f, 'g', '/tmp/g.json', [], null, 'a');
        const out = readFileSync(f, 'utf8');
        assert.match(out, /<!-- gfleet:graphify-rules:start -->/);
        assert.doesNotMatch(out, /old content/);
        // user content + next H2 preserved
        assert.match(out, /user content/);
        assert.match(out, /## next/);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('upsertAgentRulesBlock: append fresh to existing file', () => {
    const repo = mkTmp();
    try {
        const f = join(repo, 'CLAUDE.md');
        writeFileSync(f, '# Existing project rules\n\nNo graphify section yet.\n');
        upsertAgentRulesBlock(f, 'g', '/tmp/g.json', [], null, 'a');
        const out = readFileSync(f, 'utf8');
        assert.match(out, /Existing project rules/);
        assert.match(out, /<!-- gfleet:graphify-rules:start -->/);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

// --- installMergeDriver / removeMergeDriver ---
// These call `git config` — to keep tests pure, we run inside a real `git
// init`'d temp dir and let git modify .git/config naturally.

import { spawnSync } from 'node:child_process';

function gitInit(dir) {
    const r = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git init failed: ' + r.stderr);
}

const HAS_GIT = spawnSync('git', ['--version']).status === 0;

test('installMergeDriver / removeMergeDriver: .gitattributes round-trip', { skip: HAS_GIT ? false : 'git not available' }, () => {
    const repo = mkTmp();
    try {
        gitInit(repo);
        const ok = installMergeDriver(repo);
        assert.equal(ok, true);
        const ga = readFileSync(join(repo, '.gitattributes'), 'utf8');
        assert.match(ga, /merge=graphify/);
        // Idempotent: don't duplicate the line
        installMergeDriver(repo);
        const ga2 = readFileSync(join(repo, '.gitattributes'), 'utf8');
        const matches = (ga2.match(/merge=graphify/g) || []).length;
        assert.equal(matches, 1);
        // Remove
        removeMergeDriver(repo);
        const ga3 = readFileSync(join(repo, '.gitattributes'), 'utf8');
        assert.doesNotMatch(ga3, /merge=graphify/);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

// --- writeGroupManifest ---

test('writeGroupManifest: schema correctness', () => {
    const repo = mkTmp();
    try {
        const options = { wiki_gitignored: true, watchers: true, windsurf: true, claude_code: true, docs: null };
        const thisRepo = { slug: 'main', stack: 'node' };
        const allRepos = [
            { slug: 'main', stack: 'node' },
            { slug: 'side', stack: 'go' },
        ];
        writeGroupManifest(repo, 'mygroup', options, thisRepo, allRepos);
        const manifest = readGroupManifest(repo);
        assert.equal(manifest.version, 1);
        assert.equal(manifest.group, 'mygroup');
        assert.equal(manifest.this.slug, 'main');
        assert.equal(manifest.siblings.length, 1);
        assert.equal(manifest.siblings[0].slug, 'side');
        assert.equal(manifest.siblings[0].clone_url, null);
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('writeGroupManifest: preserves clone_url across re-runs', () => {
    const repo = mkTmp();
    try {
        const options = { wiki_gitignored: true, watchers: true, windsurf: true, claude_code: true, docs: null };
        const thisRepo = { slug: 'main', stack: 'node' };
        const allRepos = [{ slug: 'main', stack: 'node' }, { slug: 'side', stack: 'go' }];
        writeGroupManifest(repo, 'g', options, thisRepo, allRepos);
        // Manually edit clone_url
        const f = join(repo, '.gfleet', 'group.json');
        const m = JSON.parse(readFileSync(f, 'utf8'));
        m.siblings[0].clone_url = 'git@github.com:me/side.git';
        writeFileSync(f, JSON.stringify(m, null, 2));
        // Re-run — should preserve clone_url
        writeGroupManifest(repo, 'g', options, thisRepo, allRepos);
        const after = readGroupManifest(repo);
        assert.equal(after.siblings[0].clone_url, 'git@github.com:me/side.git');
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('writeGroupManifest: located at <repo>/.gfleet/group.json', () => {
    const repo = mkTmp();
    try {
        writeGroupManifest(
            repo,
            'g',
            { wiki_gitignored: true, watchers: true, windsurf: true, claude_code: true, docs: null },
            { slug: 's', stack: 'node' },
            [{ slug: 's', stack: 'node' }],
        );
        assert.ok(existsSync(join(repo, '.gfleet', 'group.json')));
    } finally { rmSync(repo, { recursive: true, force: true }); }
});

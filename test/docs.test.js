// Tests for src/docs.js — marksStale (heuristic stale-tracker).
//
// IMPORTANT: util.js reads HOME / GFLEET_STATE_DIR / XDG_CACHE_HOME at
// module load time, so we MUST set these env vars BEFORE importing.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Single shared tmp root for the whole test file.
const ROOT = mkdtempSync(join(tmpdir(), 'gfleet-docs-'));
const FAKE_HOME = join(ROOT, 'home');
const STATE_DIR = join(ROOT, 'state');
const CACHE_DIR = join(ROOT, 'cache');
mkdirSync(FAKE_HOME, { recursive: true });
mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

process.env.HOME = FAKE_HOME;
process.env.GFLEET_STATE_DIR = STATE_DIR;
process.env.XDG_CACHE_HOME = CACHE_DIR;

// NOW import — modules will pick up the overridden env vars.
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { marksStale } = await import('../src/docs.js');

let groupCounter = 0;

function setupGroup() {
    groupCounter++;
    const group = `g${groupCounter}`;
    const repoDir = join(ROOT, 'repos', group);
    mkdirSync(join(repoDir, 'docs'), { recursive: true });
    writeFileSync(join(repoDir, 'docs', '.metadata.json'), JSON.stringify({
        files: {
            'docs/api.md': { sources: [{ path: 'src/api.ts', sha: 'aaa' }] },
            'docs/auth.md': { sources: [{ path: 'src/auth.ts', sha: 'bbb' }] },
        },
    }));
    const configPath = join(STATE_DIR, `${group}.cfg.json`);
    writeFileSync(configPath, JSON.stringify({
        group,
        repos: [{ path: repoDir, slug: `${group}-r1`, stack: 'node' }],
    }));
    // Update registry.json (overwrite — additive across tests).
    const regPath = join(STATE_DIR, 'registry.json');
    let reg = { groups: {} };
    if (existsSync(regPath)) reg = JSON.parse(readFileSync(regPath, 'utf8'));
    reg.groups[group] = { config: configPath, installed_at: new Date().toISOString() };
    writeFileSync(regPath, JSON.stringify(reg));
    return { group, repoDir, slug: `${group}-r1` };
}

test('marksStale: writes .stale.md and stale.json with right entries', async () => {
    const { group, repoDir, slug } = setupGroup();
    await marksStale({ group, hook: 'post-commit', range: 'HEAD~1..HEAD', lines: ['src/api.ts'] });
    const staleMd = join(repoDir, 'docs', '.stale.md');
    assert.ok(existsSync(staleMd));
    const md = readFileSync(staleMd, 'utf8');
    assert.match(md, /docs\/api\.md/);
    const cacheJson = join(CACHE_DIR, 'graphify-fleet', group, slug, 'stale.json');
    assert.ok(existsSync(cacheJson));
    const obj = JSON.parse(readFileSync(cacheJson, 'utf8'));
    assert.equal(obj.repo_slug, slug);
    assert.equal(obj.group, group);
    assert.ok(obj.stale_sections.find(s => s.path === 'docs/api.md'));
});

test('marksStale: union-merge preserves first_marked_at on second run', async () => {
    const { group, slug } = setupGroup();
    await marksStale({ group, hook: 'post-commit', lines: ['src/api.ts'] });
    const cacheJson = join(CACHE_DIR, 'graphify-fleet', group, slug, 'stale.json');
    const first = JSON.parse(readFileSync(cacheJson, 'utf8'));
    const firstApi = first.stale_sections.find(s => s.path === 'docs/api.md');
    assert.ok(firstApi);
    const firstTs = firstApi.first_marked_at;
    await new Promise(r => setTimeout(r, 5));
    await marksStale({ group, hook: 'post-commit', lines: ['src/api.ts', 'src/auth.ts'] });
    const second = JSON.parse(readFileSync(cacheJson, 'utf8'));
    const secondApi = second.stale_sections.find(s => s.path === 'docs/api.md');
    assert.equal(secondApi.first_marked_at, firstTs, 'first_marked_at must be preserved');
    assert.notEqual(second.updated_at, first.updated_at);
});

test('marksStale: atomic write — no temp file leftover', async () => {
    const { group, repoDir } = setupGroup();
    await marksStale({ group, hook: 'post-commit', lines: ['src/api.ts'] });
    const docsDir = join(repoDir, 'docs');
    const leftovers = readdirSync(docsDir).filter(n => n.includes('.tmp.'));
    assert.deepEqual(leftovers, []);
});

test('marksStale: untracked changes recorded when no doc cites the file', async () => {
    const { group, slug } = setupGroup();
    await marksStale({ group, hook: 'post-commit', lines: ['src/uncited.ts'] });
    const cacheJson = join(CACHE_DIR, 'graphify-fleet', group, slug, 'stale.json');
    const obj = JSON.parse(readFileSync(cacheJson, 'utf8'));
    assert.ok(obj.untracked_changes.includes('src/uncited.ts'));
});

test('marksStale: silent (no write) when docs/ directory does not exist', async () => {
    const { group, repoDir } = setupGroup();
    rmSync(join(repoDir, 'docs'), { recursive: true, force: true });
    await marksStale({ group, hook: 'post-commit', lines: ['src/api.ts'] });
    assert.ok(!existsSync(join(repoDir, 'docs', '.stale.md')));
});

test('marksStale: silent when group not in registry', async () => {
    // Group "ghost" isn't registered — should silently return.
    await marksStale({ group: 'ghost', hook: 'post-commit', lines: ['src/x.ts'] });
    // Nothing to assert — just shouldn't throw.
    assert.ok(true);
});

// Cleanup at end (best-effort).
process.on('exit', () => {
    try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

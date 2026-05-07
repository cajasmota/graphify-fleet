// Smoke tests for `bin/gfleet` — spawn as subprocess and assert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIN = join(__dirname, '..', 'bin', 'gfleet');

function run(args, opts = {}) {
    // Isolate gfleet state so doctor/help don't crash on user state.
    const tmpHome = mkdtempSync(join(tmpdir(), 'gfleet-cli-'));
    const env = {
        ...process.env,
        HOME: tmpHome,
        GFLEET_STATE_DIR: join(tmpHome, '.graphify-fleet'),
        // Hint stdin closed
    };
    try {
        return spawnSync(process.execPath, [BIN, ...args], {
            encoding: 'utf8',
            timeout: 10_000,
            env,
            stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
            ...opts,
        });
    } finally {
        try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    }
}

test('gfleet help — prints primary surface', () => {
    const r = run(['help']);
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    const out = r.stdout;
    assert.match(out, /wizard/);
    assert.match(out, /doctor/);
    assert.match(out, /REPAIR/);
});

test('gfleet help advanced — prints advanced surface', () => {
    const r = run(['help', 'advanced']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /skills install/);
});

test('gfleet doctor — exits 0', () => {
    const r = run(['doctor']);
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
});

test('gfleet --help — exits 0', () => {
    const r = run(['--help']);
    assert.equal(r.status, 0);
});

test('gfleet (no args) — exits 0', () => {
    const r = run([]);
    assert.equal(r.status, 0);
});

test('gfleet unknown-cmd — exits non-zero', () => {
    const r = run(['nonsense-command-xyz']);
    assert.notEqual(r.status, 0);
});

test('gfleet doctor — surfaces graphify version line + tested range', () => {
    const r = run(['doctor']);
    assert.equal(r.status, 0);
    // The doctor output mentions the tested range regardless of whether
    // graphify is installed; when not installed the warning line is shown.
    const out = r.stdout + r.stderr;
    // Either the install prompt or the version+range pair must appear.
    const matches = /graphify version:.*range: >=/.test(out)
        || /graphify not installed/.test(out);
    assert.ok(matches, `expected version/range or install hint in doctor output:\n${out}`);
});

test('gfleet doctor — shows pin source when GFLEET_GRAPHIFY_VERSION is set', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'gfleet-cli-'));
    try {
        const env = {
            ...process.env,
            HOME: tmpHome,
            GFLEET_STATE_DIR: join(tmpHome, '.graphify-fleet'),
            GFLEET_GRAPHIFY_VERSION: '0.7.9',
        };
        const r = spawnSync(process.execPath, [BIN, 'doctor'], {
            encoding: 'utf8',
            timeout: 10_000,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        assert.equal(r.status, 0);
        const out = r.stdout + r.stderr;
        // If graphify isn't installed locally we still show install prompt;
        // we only assert pin surfacing when graphify *is* installed.
        if (/graphify found/.test(out)) {
            assert.match(out, /graphify pinned to 0\.7\.9 \(env var/);
        }
    } finally {
        try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    }
});

test('gfleet wizard with stdin closed — fails gracefully (no hang)', () => {
    // stdin is 'ignore' (closed). The interactive wizard should error rather
    // than block. spawnSync timeout would catch a hang.
    const r = run(['wizard'], { timeout: 8_000 });
    // Either exits non-zero (cancelled / error) or zero with a clean message.
    // The critical assertion is: it terminates. spawnSync.signal would be set
    // if it timed out.
    assert.notEqual(r.signal, 'SIGTERM', 'wizard hung — stdin-closed path should not block');
});

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

test('gfleet wizard with stdin closed — fails gracefully (no hang)', () => {
    // stdin is 'ignore' (closed). The interactive wizard should error rather
    // than block. spawnSync timeout would catch a hang.
    const r = run(['wizard'], { timeout: 8_000 });
    // Either exits non-zero (cancelled / error) or zero with a clean message.
    // The critical assertion is: it terminates. spawnSync.signal would be set
    // if it timed out.
    assert.notEqual(r.signal, 'SIGTERM', 'wizard hung — stdin-closed path should not block');
});

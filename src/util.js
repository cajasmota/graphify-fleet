import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch as applyGraphifyPatch } from './patches/graphify-repo-filter.js';

export const HOME = homedir();
export const PLATFORM = platform();
export const IS_DARWIN = PLATFORM === 'darwin';
export const IS_LINUX  = PLATFORM === 'linux';
export const IS_WIN    = PLATFORM === 'win32';

export const ROOT_DIR        = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATES_DIR   = join(ROOT_DIR, 'templates');
export const GRAPHIFY_DIR    = process.env.GRAPHIFY_DIR    ?? join(HOME, '.graphify');
export const GROUPS_DIR      = join(GRAPHIFY_DIR, 'groups');
export const FLEET_STATE_DIR = process.env.GFLEET_STATE_DIR ?? join(HOME, '.graphify-fleet');
export const REGISTRY        = join(FLEET_STATE_DIR, 'registry.json');
export const LOCAL_BIN       = join(HOME, '.local', 'bin');

// ----- ANSI logging -----
const C = { red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', dim:'\x1b[2m', reset:'\x1b[0m' };
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (col, s) => useColor ? `${col}${s}${C.reset}` : s;
export const log = {
    say:  (s='') => console.log(s),
    ok:   (s)    => console.log(wrap(C.green, '✓ ') + s),
    warn: (s)    => console.log(wrap(C.yellow, '! ') + s),
    err:  (s)    => console.error(wrap(C.red, '✗ ') + s),
    info: (s)    => console.log('  ' + s),
    dim:  (s)    => console.log(wrap(C.dim, s)),
    hr:   ()     => console.log(wrap(C.dim, '─'.repeat(45))),
    head: (s)    => console.log(wrap(C.green, '▸ ') + s),
};
export function die(msg) { log.err(msg); process.exit(1); }

// ----- paths -----
export function expandPath(p) {
    if (!p) return p;
    if (p === '~')        return HOME;
    if (p.startsWith('~/') || p.startsWith('~\\')) return join(HOME, p.slice(2));
    return p;
}
export function ensureDir(p) { mkdirSync(p, { recursive: true }); }

// Resolve the actual .git directory for a working tree.
// - Standard repo: <gitRoot>/.git is a directory; return it.
// - Worktree: <gitRoot>/.git is a file containing "gitdir: <path>"; resolve and return that path.
// - Otherwise: return null.
export function getGitDir(gitRoot) {
    const dotGit = join(gitRoot, '.git');
    if (!existsSync(dotGit)) return null;
    let st;
    try { st = statSync(dotGit); } catch { return null; }
    if (st.isDirectory()) return dotGit;
    if (st.isFile()) {
        try {
            const content = readFileSync(dotGit, 'utf8');
            const m = content.match(/^gitdir:\s*(.+)\s*$/m);
            if (!m) return null;
            const target = m[1].trim();
            // gitdir may be relative to gitRoot
            const resolved = target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target)
                ? target
                : resolve(gitRoot, target);
            return existsSync(resolved) ? resolved : null;
        } catch { return null; }
    }
    return null;
}

// ----- shell -----
export function which(cmd) {
    try {
        const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8' });
        if (r.status === 0) return r.stdout.split('\n')[0].trim() || null;
    } catch {}
    return null;
}
export function run(cmd, args = [], opts = {}) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    return { code: r.status ?? -1, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}
export function runOk(cmd, args = [], opts = {}) {
    const r = run(cmd, args, opts);
    return r.code === 0;
}
export function runOrThrow(cmd, args = [], opts = {}) {
    const r = run(cmd, args, opts);
    if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.code}): ${r.stderr || r.stdout}`);
    return r.stdout;
}

// ----- JSON helpers -----
export function readJson(p, fallback = undefined) {
    if (!existsSync(p)) {
        if (fallback !== undefined) return fallback;
        throw new Error(`not found: ${p}`);
    }
    return JSON.parse(readFileSync(p, 'utf8'));
}
export function writeJson(p, obj) {
    ensureDir(dirname(p));
    writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

// ----- registry (group <-> config path) -----
export function readRegistry() {
    return readJson(REGISTRY, { groups: {} });
}
export function writeRegistry(reg) { writeJson(REGISTRY, reg); }

export function registerGroup(group, configPath) {
    const reg = readRegistry();
    reg.groups[group] = {
        config: resolve(configPath),
        installed_at: new Date().toISOString(),
    };
    writeRegistry(reg);
}
export function unregisterGroup(group) {
    const reg = readRegistry();
    delete reg.groups[group];
    writeRegistry(reg);
}
export function listRegistered() { return readRegistry().groups; }

// ----- config resolution -----
// arg can be: undefined (= ALL), a config path, or a registered group name.
export function resolveConfigArg(arg) {
    if (!arg) return { kind: 'all' };
    const expanded = expandPath(arg);
    if (existsSync(expanded) && statSync(expanded).isFile()) return { kind: 'one', config: resolve(expanded) };
    const reg = readRegistry();
    if (reg.groups[arg]?.config) {
        const cfg = reg.groups[arg].config;
        if (existsSync(cfg)) return { kind: 'one', config: cfg };
        die(`registered group '${arg}' points at missing config: ${cfg}`);
    }
    die(`no config file or registered group named: ${arg} (try 'gfleet list')`);
}

// Flatten monorepo entries into a flat list of virtual repos.
// Lives in util.js to avoid a util→monorepo→util circular import.
export function flattenRepos(rawRepos) {
    const flat = [];
    for (const entry of rawRepos) {
        if (entry.type === 'monorepo') {
            const root = resolve(expandPath(entry.path));
            for (const m of (entry.modules ?? [])) {
                const monoSlug = basename(root).replace(/[^a-zA-Z0-9_-]/g, '-');
                const moduleSlug = m.path.replace(/\//g, '-').replace(/[^a-zA-Z0-9_-]/g, '-');
                flat.push({
                    path: join(root, m.path),
                    slug: m.slug || `${monoSlug}-${moduleSlug}`.toLowerCase(),
                    stack: m.stack || 'generic',
                    monorepoRoot: root,
                });
            }
        } else {
            flat.push({
                path: expandPath(entry.path),
                slug: entry.slug || basename(expandPath(entry.path)),
                stack: entry.stack || 'generic',
                monorepoRoot: null,
            });
        }
    }
    return flat;
}

export function loadConfig(configPath) {
    const c = readJson(configPath);
    if (!c.group) die(`config missing 'group': ${configPath}`);
    if (!Array.isArray(c.repos) || c.repos.length === 0) die(`config has no repos: ${configPath}`);
    return {
        configPath: resolve(configPath),
        group: c.group,
        repos: flattenRepos(c.repos),
        options: {
            wiki_gitignored: c.options?.wiki_gitignored ?? true,
            watchers:        c.options?.watchers        ?? true,
            windsurf:        c.options?.windsurf        ?? true,
            claude_code:     c.options?.claude_code     ?? true,
        },
        docs: c.docs ?? null,
        groupGraph: join(GROUPS_DIR, `${c.group}.json`),
        rawRepos: c.repos,  // preserve for editing (monorepo add/remove)
    };
}

// ----- graphify ensure -----
export function graphifyBin() { return which('graphify'); }
export function graphifyPython() {
    const bin = graphifyBin();
    if (!bin) return null;
    if (IS_WIN) return join(dirname(bin), 'python.exe');
    try {
        const shebang = readFileSync(bin, 'utf8').split('\n', 1)[0];
        const py = shebang.replace(/^#!\s*/, '').split(' ')[0];
        if (py && existsSync(py)) return py;
    } catch {}
    return which('python3') || which('python');
}

// Pinned graphify version. Bump this only after re-validating the
// src/patches/graphify-repo-filter.js anchors against the new release.
// gfleet patch graphify will print a warning if installed != pinned.
export const GRAPHIFY_PIN = '0.7.9';

// Re-apply the repo-filter patch after any uv tool install of graphifyy.
// `--reinstall` (and even initial install) replaces site-packages and wipes
// the patch, so we always re-apply to keep it self-healing. Failures here
// are non-fatal — log and continue.
function reapplyGraphifyPatch() {
    try {
        applyGraphifyPatch({ verbose: false });
    } catch (e) {
        log.warn(`graphify patch re-apply failed (continuing): ${e.message}`);
    }
}

export function ensureGraphify(verbose = true) {
    if (!which('uv')) die('uv is required. install: curl -LsSf https://astral.sh/uv/install.sh | sh');
    const spec = `graphifyy==${GRAPHIFY_PIN}`;
    if (!graphifyBin()) {
        if (verbose) log.info(`installing ${spec} via uv (with mcp + watchdog extras)...`);
        runOrThrow('uv', ['tool', 'install', spec, '--with', 'mcp', '--with', 'watchdog']);
        reapplyGraphifyPatch();
        return;
    }
    const py = graphifyPython();
    // Check version matches pin
    const versionResult = run(py, ['-c', `from importlib.metadata import version; print(version('graphifyy'))`]);
    const installed = versionResult.code === 0 ? versionResult.stdout.trim() : null;
    if (installed && installed !== GRAPHIFY_PIN) {
        if (verbose) log.warn(`graphifyy ${installed} is installed; gfleet pins to ${GRAPHIFY_PIN}. Pinning now (will re-apply patch after).`);
        runOrThrow('uv', ['tool', 'install', spec, '--with', 'mcp', '--with', 'watchdog', '--reinstall']);
        reapplyGraphifyPatch();
        return;
    }
    const ok = runOk(py, ['-c', 'import mcp, watchdog']);
    if (!ok) {
        if (verbose) log.info('adding mcp + watchdog extras to graphifyy...');
        runOrThrow('uv', ['tool', 'install', spec, '--with', 'mcp', '--with', 'watchdog', '--reinstall']);
        reapplyGraphifyPatch();
    }
}

export function getGraphifyVersion() {
    const py = graphifyPython();
    if (!py) return null;
    const r = run(py, ['-c', `from importlib.metadata import version; print(version('graphifyy'))`]);
    return r.code === 0 ? r.stdout.trim() : null;
}

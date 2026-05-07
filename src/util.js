import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// Patch system removed: the MCP server is now gfleet-owned (a fork of
// upstream `serve.py` lives at `src/mcp-server/server.py`), so there is
// nothing to patch in graphify's site-packages.

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
    // Atomic write: stage to a sibling tmp file then rename. Avoids a partial
    // half-written file being read by a concurrent watcher / install.
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
    const data = JSON.stringify(obj, null, 2) + '\n';
    try {
        writeFileSync(tmp, data);
        renameSync(tmp, p);
    } catch (e) {
        try { unlinkSync(tmp); } catch {}
        throw e;
    }
}

// Levenshtein distance for fuzzy name-collision warnings (gfleet conventions).
// Tiny implementation; only used for short identifiers.
export function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const m = a.length, n = b.length;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, cur] = [cur, prev];
    }
    return prev[n];
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

// Cross-repo / extraction contract with graphify is now limited to:
//   1. NetworkX node_link_data shape of `graph.json` (nodes[].id required).
//   2. The `graphify update .` CLI shape (the watcher invokes it).
// Both have been stable since 0.7.x, so we accept a range instead of pinning.
// `GRAPHIFY_MIN_VERSION` is the floor (versions below this lack required
// fields or CLI flags). `GRAPHIFY_TESTED_MAX` is the highest version we have
// verified — newer versions warn but proceed.
export const GRAPHIFY_MIN_VERSION = '0.7.9';
export const GRAPHIFY_TESTED_MAX = '0.8.0';

// Back-compat export. A handful of consumers (and older error messages) used
// `GRAPHIFY_PIN`; keep it as an alias for the floor so existing imports work.
export const GRAPHIFY_PIN = GRAPHIFY_MIN_VERSION;

// ----- semver (no deps) -----
// Parse `X.Y.Z` (or `X.Y`, `X`) into [major, minor, patch]. Prerelease /
// build metadata (anything after `-` or `+`) is ignored for ordering.
export function parseSemver(s) {
    if (typeof s !== 'string') return null;
    const core = s.trim().replace(/^v/, '').split(/[-+]/, 1)[0];
    if (!/^\d+(\.\d+){0,2}$/.test(core)) return null;
    const parts = core.split('.').map(n => parseInt(n, 10));
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

// Compare two semver strings. Returns -1 if a<b, 0 if equal, 1 if a>b.
// Returns null if either string is unparseable.
export function semverCompare(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb) return null;
    for (let i = 0; i < 3; i++) {
        if (pa[i] < pb[i]) return -1;
        if (pa[i] > pb[i]) return 1;
    }
    return 0;
}

// Classify a graphify version against the supported range.
// Returns one of: 'unknown' | 'below' | 'in_range' | 'above'.
export function classifyGraphifyVersion(v) {
    const cmpMin = semverCompare(v, GRAPHIFY_MIN_VERSION);
    const cmpMax = semverCompare(v, GRAPHIFY_TESTED_MAX);
    if (cmpMin === null || cmpMax === null) return 'unknown';
    if (cmpMin < 0) return 'below';
    if (cmpMax > 0) return 'above';
    return 'in_range';
}

// ----- preferences (~/.graphify-fleet/preferences.json) -----
export const PREFERENCES_PATH = join(FLEET_STATE_DIR, 'preferences.json');

export function readPreferences() {
    return readJson(PREFERENCES_PATH, {});
}
export function writePreferences(p) { writeJson(PREFERENCES_PATH, p); }

// Resolve which graphify version to install, honoring (in order):
//   1. GFLEET_GRAPHIFY_VERSION env var (one-shot pin for this process)
//   2. preferences.json `graphify_version` (persisted via `gfleet update --pin-graphify`)
//   3. null → install latest, then verify against [MIN, TESTED_MAX]
// Returns { version: string|null, source: 'env'|'preferences'|null }.
export function resolvedGraphifyPin() {
    const env = process.env.GFLEET_GRAPHIFY_VERSION;
    if (env && env.trim()) return { version: env.trim(), source: 'env' };
    try {
        const prefs = readPreferences();
        if (prefs.graphify_version) return { version: String(prefs.graphify_version), source: 'preferences' };
    } catch {}
    return { version: null, source: null };
}

export function ensureGraphify(verbose = true) {
    if (!which('uv')) die('uv is required. install: curl -LsSf https://astral.sh/uv/install.sh | sh');

    const pin = resolvedGraphifyPin();
    const installSpec = pin.version ? `graphifyy==${pin.version}` : 'graphifyy';

    if (!graphifyBin()) {
        if (verbose) log.info(`installing ${installSpec} via uv (with mcp + watchdog extras)...`);
        runOrThrow('uv', ['tool', 'install', installSpec, '--with', 'mcp', '--with', 'watchdog']);
        // fall through to verification
    } else if (pin.version) {
        // A pin is in force — make sure the installed version matches.
        const installed = getGraphifyVersion();
        if (installed && installed !== pin.version) {
            if (verbose) log.warn(`graphifyy ${installed} is installed; ${pin.source} pin requests ${pin.version}. Repinning.`);
            runOrThrow('uv', ['tool', 'install', installSpec, '--with', 'mcp', '--with', 'watchdog', '--reinstall']);
        }
    }

    // Always verify mcp + watchdog extras are present.
    const py = graphifyPython();
    if (py) {
        const ok = runOk(py, ['-c', 'import mcp, watchdog']);
        if (!ok) {
            if (verbose) log.info('adding mcp + watchdog extras to graphifyy...');
            runOrThrow('uv', ['tool', 'install', installSpec, '--with', 'mcp', '--with', 'watchdog', '--reinstall']);
        }
    }

    // Verify the installed version is within the supported range.
    const installed = getGraphifyVersion();
    if (!installed) {
        if (verbose) log.warn('graphify version unknown after install — skipping range check');
        return;
    }
    const klass = classifyGraphifyVersion(installed);
    if (klass === 'below') {
        die(`graphify ${installed} is installed but gfleet requires >= ${GRAPHIFY_MIN_VERSION}. Run \`uv tool upgrade graphify\` (or set GFLEET_GRAPHIFY_VERSION to override).`);
    }
    if (klass === 'above' && verbose) {
        log.warn(`graphify ${installed} is newer than the version range gfleet has been tested with (>=${GRAPHIFY_MIN_VERSION}, <=${GRAPHIFY_TESTED_MAX}). Most things work; if you hit issues, set GFLEET_GRAPHIFY_VERSION=${GRAPHIFY_MIN_VERSION} to pin back.`);
    }
}

export function getGraphifyVersion() {
    const py = graphifyPython();
    if (!py) return null;
    const r = run(py, ['-c', `from importlib.metadata import version; print(version('graphifyy'))`]);
    return r.code === 0 ? r.stdout.trim() : null;
}

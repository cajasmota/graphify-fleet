// Monorepo detection + module discovery + interactive module picker.
// A "monorepo" entry in fleet config has type:"monorepo" with a list of
// selected modules. Each selected module is treated as a virtual repo
// for indexing, watching, and MCP wiring.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { intro, outro, select, multiselect, confirm, text, isCancel, cancel, note } from '@clack/prompts';
import {
    HOME, expandPath, log, run, readJson, writeJson, listRegistered, loadConfig, die,
} from './util.js';

// ------------------------------------------------------------
// Detection
// ------------------------------------------------------------

const DETECTORS = [
    { name: 'pnpm',    file: 'pnpm-workspace.yaml',  detect: detectPnpm },
    { name: 'npm',     file: 'package.json',         detect: detectNpmWorkspaces },
    { name: 'nx',      file: 'nx.json',              detect: detectNx },
    { name: 'turbo',   file: 'turbo.json',           detect: detectTurbo },
    { name: 'lerna',   file: 'lerna.json',           detect: detectLerna },
    { name: 'multi',   file: null,                   detect: detectMultiPackage },
];

export function detectMonorepo(rootPath) {
    if (!existsSync(rootPath)) return null;
    for (const d of DETECTORS) {
        if (d.file && !existsSync(join(rootPath, d.file))) continue;
        const result = d.detect(rootPath);
        if (result && result.modules.length > 0) {
            return { kind: d.name, root: rootPath, ...result };
        }
    }
    return null;
}

function detectPnpm(root) {
    // pnpm-workspace.yaml: lines like "  - 'packages/*'"
    try {
        const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
        const globs = yaml
            .split('\n')
            .map(l => l.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/)?.[1])
            .filter(Boolean);
        return { modules: expandGlobs(root, globs) };
    } catch { return null; }
}

function detectNpmWorkspaces(root) {
    try {
        const pkg = readJson(join(root, 'package.json'));
        const ws = pkg.workspaces;
        if (!ws) return null;
        const globs = Array.isArray(ws) ? ws : ws.packages;
        if (!globs) return null;
        return { modules: expandGlobs(root, globs) };
    } catch { return null; }
}

function detectNx(root) {
    try {
        const nx = readJson(join(root, 'nx.json'));
        const wsLayout = nx.workspaceLayout ?? {};
        const appsDir = wsLayout.appsDir ?? 'apps';
        const libsDir = wsLayout.libsDir ?? 'libs';
        const modules = [
            ...expandGlobs(root, [`${appsDir}/*`]),
            ...expandGlobs(root, [`${libsDir}/*`]),
        ];
        return { modules };
    } catch { return null; }
}

function detectTurbo(root) {
    // turbo.json itself doesn't list packages — they come from package.json workspaces
    return detectNpmWorkspaces(root);
}

function detectLerna(root) {
    try {
        const lerna = readJson(join(root, 'lerna.json'));
        const globs = lerna.packages ?? ['packages/*'];
        return { modules: expandGlobs(root, globs) };
    } catch { return null; }
}

const MULTI_IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '.expo', 'target', '.next', '.turbo', '.cache']);
const MANIFEST_FILES = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'];

function detectMultiPackage(root, depth = 2) {
    // Walk up to `depth` levels deep looking for module manifests. Stops
    // descending into a directory once a manifest is found there (to avoid
    // double-counting nested packages within a workspace).
    const found = [];
    function walk(dir, relPrefix, levelsLeft) {
        if (levelsLeft < 0) return;
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const entry of entries) {
            if (!entry.isDirectory() || MULTI_IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
            const sub = join(dir, entry.name);
            const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
            const hasManifest = MANIFEST_FILES.some(m => existsSync(join(sub, m)));
            if (hasManifest) {
                found.push({
                    rel,
                    abs: sub,
                    name: entry.name,
                    stack: detectStack(sub),
                    loc: estimateLoc(sub),
                });
                continue;  // don't recurse into a packaged module
            }
            walk(sub, rel, levelsLeft - 1);
        }
    }
    walk(root, '', depth - 1);
    if (found.length < 2) return null;  // not a monorepo if only 1 package
    return { modules: found };
}

// Expand brace-alternation in a glob: "{a,b}/*" → ["a/*", "b/*"]. Only
// handles single-level (non-nested) braces — sufficient for the common
// pnpm/npm workspace forms.
function expandBraces(glob) {
    const m = glob.match(/^([^{]*)\{([^{}]+)\}(.*)$/);
    if (!m) return [glob];
    const [, head, alts, tail] = m;
    const out = [];
    for (const a of alts.split(',').map(s => s.trim())) {
        out.push(...expandBraces(`${head}${a}${tail}`));
    }
    return out;
}

// Expand "**" by listing all subdirectories under a base recursively (bounded).
// Returns an array of relative path prefixes (from `from`).
function listAllSubdirs(from, maxDepth = 4) {
    const out = [''];
    function walk(dir, rel, levelsLeft) {
        if (levelsLeft < 0) return;
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('.') || MULTI_IGNORE.has(e.name)) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            out.push(r);
            walk(join(dir, e.name), r, levelsLeft - 1);
        }
    }
    walk(from, '', maxDepth - 1);
    return out;
}

function expandGlobs(root, globs) {
    // Glob expansion: brace alternation, "packages/*", "apps/*/lib", "!negated",
    // and a basic "**" recursive wildcard. Not full-minimatch — covers the
    // shapes commonly seen in pnpm/npm workspaces.
    const expanded = [];
    for (const g of globs) {
        for (const eg of expandBraces(g)) expanded.push(eg);
    }
    const negations = expanded.filter(g => g.startsWith('!')).map(g => g.slice(1));
    const positives = expanded.filter(g => !g.startsWith('!'));
    const matched = new Set();

    function matchSingleStarSegment(prefixRel, restSegments) {
        // Walks one level under prefixRel, expanding the next "*" segment.
        const baseDir = join(root, prefixRel);
        if (!existsSync(baseDir)) return [];
        let dirs = [];
        try {
            dirs = readdirSync(baseDir, { withFileTypes: true })
                .filter(e => e.isDirectory() && !e.name.startsWith('.'))
                .map(e => e.name);
        } catch { return []; }
        const results = [];
        for (const d of dirs) {
            const next = prefixRel ? `${prefixRel}/${d}` : d;
            results.push(...expandSegments(next, restSegments));
        }
        return results;
    }

    function expandSegments(prefixRel, segments) {
        if (segments.length === 0) return [prefixRel];
        const [seg, ...rest] = segments;
        if (seg === '*') {
            return matchSingleStarSegment(prefixRel, rest);
        }
        if (seg === '**') {
            const subs = listAllSubdirs(join(root, prefixRel), 4);
            const out = [];
            for (const s of subs) {
                const next = s ? (prefixRel ? `${prefixRel}/${s}` : s) : prefixRel;
                out.push(...expandSegments(next, rest));
            }
            return out;
        }
        if (seg.includes('*')) {
            // partial wildcard like "lib*"
            const re = new RegExp('^' + seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            const baseDir = join(root, prefixRel);
            if (!existsSync(baseDir)) return [];
            let dirs = [];
            try {
                dirs = readdirSync(baseDir, { withFileTypes: true })
                    .filter(e => e.isDirectory() && !e.name.startsWith('.') && re.test(e.name))
                    .map(e => e.name);
            } catch { return []; }
            const out = [];
            for (const d of dirs) {
                const next = prefixRel ? `${prefixRel}/${d}` : d;
                out.push(...expandSegments(next, rest));
            }
            return out;
        }
        // Literal segment
        const next = prefixRel ? `${prefixRel}/${seg}` : seg;
        return expandSegments(next, rest);
    }

    for (const glob of positives) {
        if (!glob.includes('*')) {
            const abs = join(root, glob);
            if (existsSync(abs)) matched.add(glob);
            continue;
        }
        const segments = glob.split('/').filter(Boolean);
        for (const r of expandSegments('', segments)) matched.add(r);
    }
    // Apply negations (simple literal match)
    for (const n of negations) matched.delete(n);
    return [...matched]
        .filter(rel => {
            const abs = join(root, rel);
            return existsSync(abs) && statSync(abs).isDirectory();
        })
        .map(rel => ({
            rel,
            abs: join(root, rel),
            name: basename(rel),
            stack: detectStack(join(root, rel)),
            loc: estimateLoc(join(root, rel)),
        }));
}

function detectStack(modulePath) {
    const has = (f) => existsSync(join(modulePath, f));
    if (has('package.json')) {
        try {
            const pkg = readJson(join(modulePath, 'package.json'));
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (deps['react-native'] || deps['expo']) return 'react-native';
            return 'node';
        } catch { return 'node'; }
    }
    if (has('go.mod')) return 'go';
    if (has('manage.py')) return 'django';
    if (has('pyproject.toml') || has('requirements.txt')) return 'python-generic';
    if (has('Cargo.toml')) return 'generic';
    return 'generic';
}

function estimateLoc(modulePath) {
    // Rough LOC estimate via wc -l on relevant source files. Cheap.
    try {
        const r = run('bash', ['-c',
            `find "${modulePath}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \\) ` +
            `-not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.venv/*" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'`]);
        return parseInt(r.stdout, 10) || 0;
    } catch { return 0; }
}

// ------------------------------------------------------------
// Config helpers (work on raw config, before loadConfig flattens it)
// ------------------------------------------------------------

export function readRawConfig(configPath) {
    if (!existsSync(configPath)) die(`config not found: ${configPath}`);
    return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function writeRawConfig(configPath, config) {
    writeJson(configPath, config);
}

export function findOrCreateMonorepoEntry(rawConfig, monorepoPath) {
    const abs = resolve(expandPath(monorepoPath));
    let entry = rawConfig.repos.find(r => r.type === 'monorepo' && resolve(expandPath(r.path)) === abs);
    if (!entry) {
        entry = { type: 'monorepo', path: monorepoPath, modules: [] };
        rawConfig.repos.push(entry);
    }
    return entry;
}

export function alreadyIndexedModulePaths(rawConfig, monorepoAbs) {
    const entry = rawConfig.repos.find(r => r.type === 'monorepo' && resolve(expandPath(r.path)) === monorepoAbs);
    return new Set((entry?.modules ?? []).map(m => m.path));
}

// ------------------------------------------------------------
// Interactive: pick group / pick monorepo / pick modules
// ------------------------------------------------------------

async function ask(fn) {
    const v = await fn();
    if (isCancel(v)) { cancel('cancelled'); process.exit(0); }
    return v;
}

async function pickGroup(promptMessage = 'Which group?') {
    const groups = listRegistered();
    const names = Object.keys(groups);
    if (names.length === 0) die('no groups registered. run: gfleet wizard');
    if (names.length === 1) return names[0];
    return await ask(() => select({
        message: promptMessage,
        options: names.map(n => ({ value: n, label: n })),
    }));
}

async function pickMonorepoPath(group, configPath) {
    const raw = readRawConfig(configPath);
    const existingMonos = raw.repos.filter(r => r.type === 'monorepo');

    // If existing monorepos in this group: offer choosing one or adding a new path
    const NEW = '__NEW__';
    const choice = existingMonos.length === 0 ? NEW : await ask(() => select({
        message: 'Monorepo',
        options: [
            ...existingMonos.map(m => ({
                value: m.path,
                label: m.path,
                hint: `${(m.modules ?? []).length} module(s) indexed`,
            })),
            { value: NEW, label: '+ Add a new monorepo path', hint: 'enter a path manually' },
        ],
    }));

    if (choice !== NEW) return resolve(expandPath(choice));

    const path = await ask(() => text({
        message: 'Monorepo path',
        placeholder: '~/code/big-monorepo',
        validate: v => {
            const abs = expandPath((v ?? '').trim().replace(/^['"]|['"]$/g, ''));
            if (!abs) return 'required';
            if (!existsSync(abs)) return `not found: ${abs}`;
            if (!statSync(abs).isDirectory()) return 'not a directory';
        },
    }));
    return resolve(expandPath(path.trim().replace(/^['"]|['"]$/g, '')));
}

async function pickModules(monorepo, alreadyIndexed) {
    const initialValues = monorepo.modules
        .filter(m => alreadyIndexed.has(m.rel))
        .map(m => m.rel);

    const labelFor = (m) => {
        const indexed = alreadyIndexed.has(m.rel);
        const indexedTag = indexed ? '✓ ' : '  ';
        return `${indexedTag}${m.rel}`;
    };

    const picked = await ask(() => multiselect({
        message: `Modules in ${monorepo.root} (${monorepo.kind} workspace, ${monorepo.modules.length} found) — pick which to index`,
        options: monorepo.modules.map(m => ({
            value: m.rel,
            label: labelFor(m),
            hint: `${m.stack}${m.loc ? ` · ${m.loc.toLocaleString()} LOC` : ''}`,
        })),
        initialValues,
        required: false,
    }));
    return picked;
}

// ------------------------------------------------------------
// Public commands: add / remove / list (interactive-first)
// ------------------------------------------------------------

export async function monorepoAdd({ group, path, modules } = {}) {
    intro('gfleet monorepo add');

    const groupName = group ?? await pickGroup();
    const groups = listRegistered();
    const configPath = groups[groupName]?.config;
    if (!configPath) die(`group not found in registry: ${groupName}`);

    const monorepoAbs = path ? resolve(expandPath(path)) : await pickMonorepoPath(groupName, configPath);

    log.info(`scanning ${monorepoAbs} ...`);
    const detected = detectMonorepo(monorepoAbs);
    if (!detected) {
        log.warn(`no monorepo detected at ${monorepoAbs}`);
        log.info('  Looked for: pnpm-workspace.yaml, package.json workspaces, nx.json,');
        log.info('              turbo.json, lerna.json, or multi-package layout (depth 2).');
        log.info('  If this is a deeper or non-standard layout, edit the config directly to');
        log.info('  add a `{ "type": "monorepo", "path": ..., "modules": [{ "path": ..., "stack": ... }] }`');
        log.info('  entry under `repos`, then run `gfleet install <group>`.');
        cancel('cancelled');
        process.exit(1);
    }
    log.ok(`detected ${detected.kind} workspace · ${detected.modules.length} module(s)`);

    const raw = readRawConfig(configPath);
    const alreadyIndexed = alreadyIndexedModulePaths(raw, monorepoAbs);

    const picked = modules
        ? modules.map(m => m.trim()).filter(Boolean)
        : await pickModules(detected, alreadyIndexed);

    if (!picked || picked.length === 0) {
        outro('no modules selected — nothing to do');
        return;
    }

    // Resolve picked rel-paths to module entries
    const newModules = picked
        .filter(rel => !alreadyIndexed.has(rel))
        .map(rel => {
            const m = detected.modules.find(d => d.rel === rel);
            if (!m) return null;
            return {
                path: rel,
                slug: defaultSlug(detected.root, rel),
                stack: m.stack,
            };
        })
        .filter(Boolean);

    const removedModules = [...alreadyIndexed].filter(rel => !picked.includes(rel));

    if (newModules.length === 0 && removedModules.length === 0) {
        outro('selection unchanged — no modules added or removed');
        return;
    }

    const entry = findOrCreateMonorepoEntry(raw, monorepoAbs);
    entry.modules = entry.modules ?? [];
    // Remove deselected
    entry.modules = entry.modules.filter(m => !removedModules.includes(m.path));
    // Add new
    entry.modules.push(...newModules);

    writeRawConfig(configPath, raw);
    log.ok(`config updated: ${configPath}`);
    log.info(`+${newModules.length} added, -${removedModules.length} removed`);

    const proceed = await ask(() => confirm({
        message: `Run 'gfleet install ${groupName}' now to apply?`,
        initialValue: true,
    }));
    if (proceed) {
        outro('running install');
        const { install } = await import('./install.js');
        await install(configPath);
    } else {
        outro(`run later: gfleet install ${groupName}`);
    }
}

export async function monorepoRemove({ group, path, modules } = {}) {
    intro('gfleet monorepo remove');
    const groupName = group ?? await pickGroup();
    const groups = listRegistered();
    const configPath = groups[groupName]?.config;
    if (!configPath) die(`group not found: ${groupName}`);

    const raw = readRawConfig(configPath);
    const monos = raw.repos.filter(r => r.type === 'monorepo' && (r.modules ?? []).length > 0);
    if (monos.length === 0) {
        outro(`no monorepos with indexed modules in group "${groupName}"`);
        return;
    }

    const monorepoAbs = path ? resolve(expandPath(path)) : (
        monos.length === 1 ? resolve(expandPath(monos[0].path)) :
        await ask(() => select({
            message: 'Monorepo',
            options: monos.map(m => ({ value: m.path, label: m.path, hint: `${m.modules.length} module(s)` })),
        })).then(p => resolve(expandPath(p)))
    );

    const entry = raw.repos.find(r => r.type === 'monorepo' && resolve(expandPath(r.path)) === monorepoAbs);
    if (!entry) die(`monorepo not in config: ${monorepoAbs}`);

    const toRemove = modules ?? await ask(() => multiselect({
        message: 'Which modules to remove?',
        options: entry.modules.map(m => ({ value: m.path, label: m.path, hint: m.slug })),
        required: true,
    }));

    entry.modules = entry.modules.filter(m => !toRemove.includes(m.path));
    writeRawConfig(configPath, raw);

    log.ok(`removed ${toRemove.length} module(s) from config`);
    log.info('Note: watchers and per-repo files for removed modules persist until you run:');
    log.info(`  gfleet uninstall ${groupName}      # full uninstall`);
    log.info(`  gfleet install ${groupName}        # reapply (incremental)`);

    const proceed = await ask(() => confirm({ message: 'Run gfleet install now to reapply?', initialValue: true }));
    if (proceed) {
        outro('running install');
        const { install } = await import('./install.js');
        await install(configPath);
    } else {
        outro('config saved; install on demand');
    }
}

export function monorepoList() {
    const groups = listRegistered();
    if (Object.keys(groups).length === 0) { log.warn('no groups registered'); return; }
    for (const groupName of Object.keys(groups)) {
        const cfgPath = groups[groupName].config;
        if (!existsSync(cfgPath)) continue;
        const raw = readRawConfig(cfgPath);
        const monos = raw.repos.filter(r => r.type === 'monorepo');
        if (monos.length === 0) continue;
        log.head(groupName);
        for (const m of monos) {
            const monoAbs = resolve(expandPath(m.path));
            const detected = detectMonorepo(monoAbs);
            const totalAvailable = detected ? detected.modules.length : '?';
            console.log(`    ${m.path}`);
            console.log(`      indexed: ${(m.modules ?? []).length} / available: ${totalAvailable}`);
            for (const mod of (m.modules ?? [])) {
                console.log(`        ✓ ${mod.path}  (${mod.slug}, ${mod.stack})`);
            }
        }
    }
}

function defaultSlug(monorepoRoot, modulePath) {
    const monoSlug = basename(monorepoRoot).replace(/[^a-zA-Z0-9_-]/g, '-');
    const moduleSlug = modulePath.replace(/\//g, '-').replace(/[^a-zA-Z0-9_-]/g, '-');
    return `${monoSlug}-${moduleSlug}`.toLowerCase();
}

// flattenRepos lives in util.js (was here in early draft) — see util.js

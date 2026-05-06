import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { intro, outro, text, select, confirm, multiselect, isCancel, cancel, note } from '@clack/prompts';
import { HOME, expandPath, log, writeJson, ensureDir } from './util.js';
import { install } from './install.js';

const STACK_CHOICES = [
    { value: 'react-native', label: 'react-native', hint: 'Expo / RN — iOS + Android' },
    { value: 'node',         label: 'node',         hint: 'Vite, Next.js, Vue, Svelte, etc.' },
    { value: 'python',       label: 'python',       hint: 'Django, FastAPI, scripts' },
    { value: 'go',           label: 'go',           hint: 'go.mod project' },
    { value: 'generic',      label: 'generic',      hint: 'fallback — minimal ignores' },
];

function detectStack(repo) {
    const has = f => existsSync(join(repo, f));
    if (has('package.json')) {
        try {
            const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
            const deps = { ...(pkg.dependencies||{}), ...(pkg.devDependencies||{}) };
            if (deps['react-native'] || deps['expo']) return 'react-native';
            return 'node';
        } catch { return 'node'; }
    }
    if (has('go.mod')) return 'go';
    if (has('requirements.txt') || has('pyproject.toml') || has('manage.py') || has('setup.py')) return 'python';
    return 'generic';
}

function isGitRepo(p) { return existsSync(join(p, '.git')); }

// Strip wrapping quotes (drag-and-drop in macOS Terminal pastes paths as
// '/path/to/dir' — single quotes — and iTerm uses double quotes).
function cleanPath(s) {
    if (!s) return s;
    let v = s.trim();
    if ((v.startsWith("'") && v.endsWith("'")) ||
        (v.startsWith('"') && v.endsWith('"'))) {
        v = v.slice(1, -1);
    }
    return v;
}

async function ask(fn) {
    const v = await fn();
    if (isCancel(v)) { cancel('cancelled'); process.exit(0); }
    return v;
}

function discoverGitRepos(parent) {
    if (!existsSync(parent) || !statSync(parent).isDirectory()) return [];
    const found = [];
    for (const name of readdirSync(parent)) {
        if (name.startsWith('.')) continue;
        const full = join(parent, name);
        try {
            if (statSync(full).isDirectory() && isGitRepo(full)) {
                found.push({ path: full, name, stack: detectStack(full) });
            }
        } catch {}
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
}

async function chooseRepos_Discover() {
    const parent = await ask(() => text({
        message: 'Parent folder containing the repos',
        placeholder: '~/Documents/Projects/UpVate',
        validate: v => {
            const abs = expandPath(cleanPath(v ?? ''));
            if (!abs) return 'required';
            if (!existsSync(abs)) return `not found: ${abs}`;
            if (!statSync(abs).isDirectory()) return 'not a directory';
        },
    }));
    const abs = expandPath(cleanPath(parent));
    const repos = discoverGitRepos(abs);
    if (repos.length === 0) {
        log.warn(`no git repos found directly under ${abs}`);
        return null;
    }

    const picked = await ask(() => multiselect({
        message: `Found ${repos.length} git repo${repos.length > 1 ? 's' : ''} — select which to include`,
        options: repos.map(r => ({
            value: r.path,
            label: r.name,
            hint: r.stack,
        })),
        initialValues: repos.map(r => r.path),
        required: true,
    }));

    return picked.map(p => {
        const r = repos.find(x => x.path === p);
        return { path: r.path, slug: defaultSlug(r.name), stack: r.stack, displayName: r.name };
    });
}

async function chooseRepos_Manual() {
    note('Type one or more repo paths. Comma-separated for multiple. Empty input to finish.\nDrag a folder from Finder to paste its path.', 'manual mode');
    const repos = [];
    while (true) {
        const raw = await ask(() => text({
            message: repos.length === 0
                ? 'Repo path(s) — comma-separated for multiple'
                : `Repo path(s) (${repos.length} added — empty to finish)`,
            placeholder: '~/Code/api, ~/Code/web, ~/Code/mobile',
        }));
        if (!raw) {
            if (repos.length === 0) { cancel('need at least one repo'); process.exit(1); }
            break;
        }
        const candidates = raw.split(',').map(s => cleanPath(s)).filter(Boolean);
        for (const c of candidates) {
            const abs = expandPath(c);
            if (!existsSync(abs) || !statSync(abs).isDirectory()) { log.warn(`not a directory: ${abs}`); continue; }
            if (!isGitRepo(abs)) { log.warn(`not a git repo: ${abs}`); continue; }
            if (repos.some(r => r.path === abs)) { log.warn(`already added: ${abs}`); continue; }
            const name = basename(abs);
            repos.push({ path: abs, slug: defaultSlug(name), stack: detectStack(abs), displayName: name });
            log.ok(`added: ${name} [${detectStack(abs)}]`);
        }
    }
    return repos;
}

function defaultSlug(name) { return name.replace(/[^a-zA-Z0-9_-]/g, '-'); }

async function refineRepoMetadata(repos) {
    if (repos.length === 0) return repos;
    const editAll = await ask(() => confirm({
        message: 'Review/override slug + stack for each repo?',
        initialValue: false,
    }));
    if (!editAll) return repos;

    const out = [];
    for (const r of repos) {
        log.say('');
        log.head(`${r.displayName} → ${r.path}`);
        const slug = await ask(() => text({
            message: 'slug',
            initialValue: r.slug,
            validate: v => !/^[a-zA-Z0-9_-]+$/.test(v ?? '') ? 'letters/digits/_/- only' : undefined,
        }));
        const stack = await ask(() => select({
            message: 'stack',
            options: STACK_CHOICES,
            initialValue: r.stack,
        }));
        out.push({ path: r.path, slug, stack });
    }
    return out;
}

export async function wizard() {
    intro('graphify-fleet · setup wizard');

    const group = await ask(() => text({
        message: 'Group name (one config per group of related repos)',
        placeholder: 'upvate, clientB, personal, ...',
        validate: v => !v ? 'required' : !/^[a-zA-Z0-9_-]+$/.test(v) ? 'use letters, digits, _ or -' : undefined,
    }));

    const mode = await ask(() => select({
        message: 'How do you want to add repos?',
        options: [
            { value: 'discover', label: 'Discover under a parent folder', hint: 'recommended — one input, multi-select' },
            { value: 'manual',   label: 'Type paths manually',            hint: 'comma-separated supported · drag-and-drop works' },
        ],
        initialValue: 'discover',
    }));

    let picked = null;
    if (mode === 'discover') {
        picked = await chooseRepos_Discover();
        if (!picked || picked.length === 0) {
            log.warn('falling back to manual mode');
            picked = await chooseRepos_Manual();
        }
    } else {
        picked = await chooseRepos_Manual();
    }

    const repos = await refineRepoMetadata(picked);

    const features = await ask(() => multiselect({
        message: 'Features (space to toggle)',
        options: [
            { value: 'watchers',    label: 'File watchers (save-time graph refresh)', hint: 'launchd / systemd / Scheduled Tasks' },
            { value: 'windsurf',    label: 'Windsurf integration',                    hint: 'workflow + rules + MCP' },
            { value: 'claude_code', label: 'Claude Code integration',                  hint: 'CLAUDE.md + PreToolUse hook' },
        ],
        initialValues: ['watchers', 'windsurf', 'claude_code'],
        required: false,
    }));

    const configPath = await ask(() => text({
        message: 'Save config to',
        initialValue: join(HOME, 'configs', `${group}.fleet.json`),
    }));

    const cfg = {
        group,
        repos: repos.map(r => ({ path: r.path, slug: r.slug, stack: r.stack })),
        options: {
            wiki_gitignored: true,
            watchers:    features.includes('watchers'),
            windsurf:    features.includes('windsurf'),
            claude_code: features.includes('claude_code'),
        },
    };

    const absCfg = expandPath(cleanPath(configPath));
    ensureDir(resolve(absCfg, '..'));
    writeJson(absCfg, cfg);
    log.ok(`config written: ${absCfg}`);

    const doInstall = await ask(() => confirm({
        message: 'Install now?',
        initialValue: true,
    }));

    if (doInstall) {
        outro('starting install');
        await install(absCfg);
    } else {
        outro(`run later:  gfleet install ${absCfg}`);
    }
}

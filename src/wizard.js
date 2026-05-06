import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { intro, outro, text, select, confirm, multiselect, isCancel, cancel, spinner, note } from '@clack/prompts';
import { HOME, expandPath, log, writeJson, ensureDir, die } from './util.js';
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

async function prompt(question, fn) {
    const v = await fn();
    if (isCancel(v)) { cancel('cancelled'); process.exit(0); }
    return v;
}

export async function wizard() {
    intro('graphify-fleet · setup wizard');

    const group = await prompt('group', () => text({
        message: 'Group name (one config per group of related repos)',
        placeholder: 'upvate, clientB, personal, ...',
        validate: v => !v ? 'required' : !/^[a-zA-Z0-9_-]+$/.test(v) ? 'use letters, digits, _ or -' : undefined,
    }));

    note('Add repos to this group. Empty path to finish.', 'repos');

    const repos = [];
    while (true) {
        const pathArg = await prompt('repo', () => text({
            message: repos.length === 0 ? 'First repo path' : `Repo #${repos.length + 1} path (empty to finish)`,
            placeholder: '~/Documents/Projects/myapp-backend',
        }));
        if (!pathArg) {
            if (repos.length === 0) { cancel('need at least one repo'); process.exit(1); }
            break;
        }
        const abs = expandPath(pathArg.trim());
        if (!existsSync(abs) || !statSync(abs).isDirectory()) { log.warn(`not a directory: ${abs}`); continue; }
        if (!isGitRepo(abs)) { log.warn(`not a git repo: ${abs}`); continue; }
        if (repos.some(r => r.path === abs)) { log.warn('already added'); continue; }

        const detectedStack = detectStack(abs);
        const slug = basename(abs).replace(/[^a-zA-Z0-9_-]/g, '-');

        const useDefaults = await prompt('detect-confirm', () => confirm({
            message: `slug=${slug}  stack=${detectedStack}  — accept defaults?`,
            initialValue: true,
        }));

        let finalSlug = slug, finalStack = detectedStack;
        if (!useDefaults) {
            finalSlug = await prompt('slug', () => text({
                message: 'slug',
                initialValue: slug,
                validate: v => !/^[a-zA-Z0-9_-]+$/.test(v) ? 'letters/digits/_/- only' : undefined,
            }));
            finalStack = await prompt('stack', () => select({
                message: 'stack',
                options: STACK_CHOICES,
                initialValue: detectedStack,
            }));
        }

        repos.push({ path: pathArg.trim(), slug: finalSlug, stack: finalStack });
        log.ok(`added: ${finalSlug} [${finalStack}]`);
    }

    const features = await prompt('features', () => multiselect({
        message: 'Features (space to toggle)',
        options: [
            { value: 'watchers',    label: 'File watchers (save-time graph refresh)', hint: 'launchd / systemd / Scheduled Tasks' },
            { value: 'windsurf',    label: 'Windsurf integration',                    hint: 'workflow + rules + MCP' },
            { value: 'claude_code', label: 'Claude Code integration',                  hint: 'CLAUDE.md + PreToolUse hook' },
        ],
        initialValues: ['watchers', 'windsurf', 'claude_code'],
        required: false,
    }));

    const configPath = await prompt('config-path', () => text({
        message: 'Save config to',
        initialValue: join(HOME, 'configs', `${group}.fleet.json`),
    }));

    const cfg = {
        group,
        repos,
        options: {
            wiki_gitignored: true,
            watchers:    features.includes('watchers'),
            windsurf:    features.includes('windsurf'),
            claude_code: features.includes('claude_code'),
        },
    };

    const absCfg = expandPath(configPath);
    ensureDir(resolve(absCfg, '..'));
    writeJson(absCfg, cfg);
    log.ok(`config written: ${absCfg}`);

    const doInstall = await prompt('install-now', () => confirm({
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

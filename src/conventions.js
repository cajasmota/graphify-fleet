// gfleet conventions — list / add / remove stack conventions for the
// generate-docs skill. Adds new framework support without forking.

import { existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { intro, outro, text, select, confirm, isCancel, cancel, note } from '@clack/prompts';
import { ROOT_DIR, HOME, ensureDir, log, die, levenshtein } from './util.js';

// User-level conventions live alongside the user-installed skill so the
// agent can find them at runtime. We mirror to BOTH locations so Claude
// Code and Windsurf both pick up extensions.
const SKILL_SRC = join(ROOT_DIR, 'skills', 'generate-docs', 'conventions');
const CLAUDE_CONV = join(HOME, '.claude', 'skills', 'generate-docs', 'conventions');
const WINDSURF_CONV = join(HOME, '.codeium', 'windsurf', 'skills', 'generate-docs', 'conventions');

async function ask(fn) {
    const v = await fn();
    if (isCancel(v)) { cancel('cancelled'); process.exit(0); }
    return v;
}

function listConventions(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
}

export function conventionsList() {
    const builtin = listConventions(SKILL_SRC);
    const claudeUser = listConventions(CLAUDE_CONV).filter(c => !builtin.includes(c));
    const windsurfUser = listConventions(WINDSURF_CONV).filter(c => !builtin.includes(c));

    log.head('Built-in conventions (shipped with gfleet)');
    for (const c of builtin) log.say(`  • ${c}`);

    if (claudeUser.length > 0 || windsurfUser.length > 0) {
        log.say('');
        log.head('User-added conventions');
        const allUser = new Set([...claudeUser, ...windsurfUser]);
        for (const c of allUser) {
            const inClaude = claudeUser.includes(c) ? '✓' : ' ';
            const inWindsurf = windsurfUser.includes(c) ? '✓' : ' ';
            log.say(`  ${inClaude}/${inWindsurf}  ${c}`);
        }
        log.dim('  (Claude / Windsurf installed)');
    }

    log.say('');
    log.info(`To add a new convention: gfleet conventions add`);
}

export async function conventionsAdd({ name, base } = {}) {
    intro('gfleet conventions add');

    const stackName = name ?? await ask(() => text({
        message: 'Stack identifier (e.g. "elixir", "dotnet", "ktor", "actix")',
        placeholder: 'lowercase, kebab-case if multi-word',
        validate: v => {
            const x = (v ?? '').trim();
            if (!x) return 'required';
            if (!/^[a-z0-9-]+$/.test(x)) return 'lowercase letters, digits, and dashes only';
            const all = listConventions(SKILL_SRC).concat(listConventions(CLAUDE_CONV));
            if (all.includes(x)) return `"${x}" already exists — use 'gfleet conventions remove' first to overwrite`;
        },
    }));

    // Warn (don't block) on near-duplicate names — common typo trap (e.g.
    // "djano" vs built-in "django").
    {
        const trimmed = stackName.trim();
        const all = listConventions(SKILL_SRC).concat(listConventions(CLAUDE_CONV));
        const close = all.filter(c => c !== trimmed && levenshtein(c, trimmed) <= 1);
        if (close.length > 0) {
            log.warn(`Name "${trimmed}" is one edit away from existing convention(s): ${close.join(', ')}`);
            log.info('  (continuing — this is just a heads-up; cancel with Ctrl-C if it was a typo)');
        }
    }

    const builtin = listConventions(SKILL_SRC);
    const baseConvention = base ?? await ask(() => select({
        message: 'Pick a similar existing convention to base on',
        options: builtin.map(b => ({ value: b, label: b })),
    }));

    const useAi = await ask(() => confirm({
        message: 'Use AI-assisted draft? (recommended — opens a draft + instructs you to run /extend-convention in your IDE)',
        initialValue: true,
    }));

    const dst = join(CLAUDE_CONV, `${stackName.trim()}.md`);
    const dstWindsurf = join(WINDSURF_CONV, `${stackName.trim()}.md`);
    ensureDir(CLAUDE_CONV);
    ensureDir(WINDSURF_CONV);

    if (useAi) {
        // Write a stub primed for /extend-convention to fill in
        const stub = renderExtendStub(stackName, baseConvention);
        writeFileSync(dst, stub);
        copyFileSync(dst, dstWindsurf);
        log.ok(`stub written: ${dst}`);
        log.ok(`stub mirrored: ${dstWindsurf}`);
        log.say('');
        note(
            `Open a representative repo of the ${stackName} stack in Claude Code or Windsurf, then run:\n\n  /extend-convention ${stackName}\n\nThe agent will inspect your code, ask a few targeted questions, and complete the convention file.`,
            'next step',
        );
    } else {
        // Pure copy from base — user fills in manually
        copyFileSync(join(SKILL_SRC, `${baseConvention}.md`), dst);
        copyFileSync(join(SKILL_SRC, `${baseConvention}.md`), dstWindsurf);
        log.ok(`copied ${baseConvention} → ${stackName}`);
        log.info(`Edit: ${dst}`);
        log.info(`(Mirror: ${dstWindsurf})`);
    }

    outro('done');
}

export async function conventionsRemove({ name } = {}) {
    intro('gfleet conventions remove');

    const userConventions = [
        ...listConventions(CLAUDE_CONV).filter(c => !listConventions(SKILL_SRC).includes(c)),
        ...listConventions(WINDSURF_CONV).filter(c => !listConventions(SKILL_SRC).includes(c)),
    ];
    const unique = [...new Set(userConventions)];
    if (unique.length === 0) {
        outro('no user-added conventions to remove');
        return;
    }

    const target = name ?? await ask(() => select({
        message: 'Which user-added convention to remove?',
        options: unique.map(c => ({ value: c, label: c })),
    }));

    if (listConventions(SKILL_SRC).includes(target)) {
        die(`"${target}" is a built-in convention; remove it from the gfleet repo instead`);
    }

    rmSync(join(CLAUDE_CONV, `${target}.md`), { force: true });
    rmSync(join(WINDSURF_CONV, `${target}.md`), { force: true });
    log.ok(`removed ${target}`);
    outro('done');
}

function renderExtendStub(name, baseName) {
    return `# Stack convention: ${name}

<!-- gfleet:extend-convention:start -->
*This is a stub. Run \`/extend-convention ${name}\` in your AI IDE to have it
inspect your code and fill in the sections below. The skill will base its
analysis on the existing \`${baseName}\` convention as a starting point.*

The agent should:
1. Read the existing \`${baseName}.md\` convention as a reference structure.
2. Inspect 3-5 representative source files in this repo to learn the stack's idioms.
3. Ask the user clarifying questions about: state management, routing, data layer, build tooling, common gotchas in this stack.
4. Replace this stub block with a fully populated convention file matching the structure of other built-in conventions.
5. Test by running \`/generate-docs --section <some-module>/api.md\` and seeing whether the convention produces sensible output.
<!-- gfleet:extend-convention:end -->

## Module = <TBD: how do modules manifest in ${name}>

Discovery (in priority order — fill in for ${name}):
1. <TBD>
2. <TBD>
3. Communities fallback

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| <TBD> | <TBD>.md | <TBD> | <TBD glob patterns> |

## Per-artifact rules

### \`<artifact>.md\`
- <TBD>

## Patterns to detect

- <TBD: state management lib, routing, build tool, etc.>

## Common gotchas

- <TBD>
`;
}

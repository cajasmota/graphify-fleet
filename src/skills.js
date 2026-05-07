// gfleet skills — install/uninstall/update/status the generate-docs skill
// across Claude Code (~/.claude) and Windsurf (~/.codeium/windsurf), plus
// per-repo Windsurf workflow files.
import { existsSync, readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { HOME, ROOT_DIR, ensureDir, log, listRegistered, loadConfig } from './util.js';
import { applyPatch as applyGraphifyPatch } from './patches/graphify-mcp-enhancements.js';

const SKILL_NAME = 'generate-docs';
const SKILL_SRC  = join(ROOT_DIR, 'skills', SKILL_NAME);
const SLASH_CMD_TEMPLATE = join(ROOT_DIR, 'templates', 'claude-slash-command.md');
const WORKFLOW_TEMPLATE  = join(ROOT_DIR, 'templates', `windsurf-${SKILL_NAME}-workflow.md`);

const CLAUDE_SKILLS_DIR  = join(HOME, '.claude', 'skills', SKILL_NAME);
const CLAUDE_CMD_FILE    = join(HOME, '.claude', 'commands', `${SKILL_NAME}.md`);
const WINDSURF_SKILL_DIR = join(HOME, '.codeium', 'windsurf', 'skills', SKILL_NAME);

// extend-convention skill (companion to generate-docs)
const EXTEND_SKILL_NAME = 'extend-convention';
const EXTEND_SKILL_SRC  = join(ROOT_DIR, 'skills', EXTEND_SKILL_NAME);
const EXTEND_CLAUDE_DIR = join(HOME, '.claude', 'skills', EXTEND_SKILL_NAME);
const EXTEND_WINDSURF_DIR = join(HOME, '.codeium', 'windsurf', 'skills', EXTEND_SKILL_NAME);

function copyDir(src, dst) {
    cpSync(src, dst, { recursive: true });
}

function repoWorkflowPath(repoPath) {
    return join(repoPath, '.windsurf', 'workflows', `${SKILL_NAME}.md`);
}

export function skillsInstall() {
    if (!existsSync(SKILL_SRC)) {
        log.err(`skill source missing: ${SKILL_SRC}`);
        log.info('did you forget to git pull graphify-fleet?');
        process.exit(1);
    }

    log.say(`installing ${SKILL_NAME} skill`);
    log.hr();

    // 1. Claude Code skill (user-level)
    if (existsSync(CLAUDE_SKILLS_DIR)) rmSync(CLAUDE_SKILLS_DIR, { recursive: true, force: true });
    ensureDir(dirname(CLAUDE_SKILLS_DIR));
    copyDir(SKILL_SRC, CLAUDE_SKILLS_DIR);
    log.ok(`Claude Code skill: ${CLAUDE_SKILLS_DIR}`);

    // 2. Claude Code slash command (user-level)
    ensureDir(dirname(CLAUDE_CMD_FILE));
    copyFileSync(SLASH_CMD_TEMPLATE, CLAUDE_CMD_FILE);
    log.ok(`Claude Code slash command: ${CLAUDE_CMD_FILE}`);

    // 3. Windsurf skill (user-level)
    if (existsSync(WINDSURF_SKILL_DIR)) rmSync(WINDSURF_SKILL_DIR, { recursive: true, force: true });
    ensureDir(dirname(WINDSURF_SKILL_DIR));
    copyDir(SKILL_SRC, WINDSURF_SKILL_DIR);
    log.ok(`Windsurf skill: ${WINDSURF_SKILL_DIR}`);

    // 4. Per-repo Windsurf workflows (one per repo in every registered group)
    const groups = listRegistered();
    let workflowCount = 0;
    const skipped = [];
    for (const group of Object.keys(groups)) {
        const cfgPath = groups[group].config;
        if (!existsSync(cfgPath)) continue;
        const cfg = loadConfig(cfgPath);
        for (const r of cfg.repos) {
            if (!existsSync(r.path)) {
                skipped.push(`${group}/${r.slug} (path missing: ${r.path})`);
                continue;
            }
            const dst = repoWorkflowPath(r.path);
            ensureDir(dirname(dst));
            copyFileSync(WORKFLOW_TEMPLATE, dst);
            workflowCount++;
        }
    }
    if (workflowCount > 0) log.ok(`Windsurf workflows: ${workflowCount} repo(s) updated`);
    if (skipped.length > 0) {
        log.warn(`Skipped ${skipped.length} repo(s) with missing paths:`);
        for (const s of skipped) log.info(`  - ${s}`);
    }

    // 5. extend-convention skill (companion)
    if (existsSync(EXTEND_SKILL_SRC)) {
        if (existsSync(EXTEND_CLAUDE_DIR))   rmSync(EXTEND_CLAUDE_DIR,   { recursive: true, force: true });
        if (existsSync(EXTEND_WINDSURF_DIR)) rmSync(EXTEND_WINDSURF_DIR, { recursive: true, force: true });
        ensureDir(dirname(EXTEND_CLAUDE_DIR));
        ensureDir(dirname(EXTEND_WINDSURF_DIR));
        cpSync(EXTEND_SKILL_SRC, EXTEND_CLAUDE_DIR, { recursive: true });
        cpSync(EXTEND_SKILL_SRC, EXTEND_WINDSURF_DIR, { recursive: true });
        log.ok(`extend-convention skill installed (Claude Code + Windsurf)`);
    }

    log.say('');
    log.head('patching graphify (repo_filter parameter on MCP tools)');
    applyGraphifyPatch();

    log.say('');
    log.ok('skill installed.');
    log.info('Use:  /generate-docs   in Claude Code or Windsurf, opened in any registered repo.');
    log.info('CLI:  gfleet docs <group>   to drive runs from the terminal (planned).');
}

export function skillsUninstall() {
    log.say(`uninstalling ${SKILL_NAME} skill`);
    log.hr();

    if (existsSync(CLAUDE_SKILLS_DIR)) {
        rmSync(CLAUDE_SKILLS_DIR, { recursive: true, force: true });
        log.info(`removed ${CLAUDE_SKILLS_DIR}`);
    }
    if (existsSync(CLAUDE_CMD_FILE)) {
        rmSync(CLAUDE_CMD_FILE, { force: true });
        log.info(`removed ${CLAUDE_CMD_FILE}`);
    }
    if (existsSync(WINDSURF_SKILL_DIR)) {
        rmSync(WINDSURF_SKILL_DIR, { recursive: true, force: true });
        log.info(`removed ${WINDSURF_SKILL_DIR}`);
    }
    if (existsSync(EXTEND_CLAUDE_DIR)) {
        rmSync(EXTEND_CLAUDE_DIR, { recursive: true, force: true });
        log.info(`removed ${EXTEND_CLAUDE_DIR}`);
    }
    if (existsSync(EXTEND_WINDSURF_DIR)) {
        rmSync(EXTEND_WINDSURF_DIR, { recursive: true, force: true });
        log.info(`removed ${EXTEND_WINDSURF_DIR}`);
    }

    // remove workflow files from registered repos
    const groups = listRegistered();
    for (const group of Object.keys(groups)) {
        const cfgPath = groups[group].config;
        if (!existsSync(cfgPath)) continue;
        const cfg = loadConfig(cfgPath);
        for (const r of cfg.repos) {
            const dst = repoWorkflowPath(r.path);
            if (existsSync(dst)) {
                rmSync(dst, { force: true });
            }
        }
    }
    log.ok('skill uninstalled.');
}

export function skillsUpdate() {
    log.info('updating skill from local graphify-fleet repo (re-copy)...');
    skillsInstall();
}

export function skillsStatus() {
    log.say(`${SKILL_NAME} skill — install status`);
    log.hr();

    const claudeOk   = existsSync(join(CLAUDE_SKILLS_DIR, 'SKILL.md'));
    const claudeCmdOk = existsSync(CLAUDE_CMD_FILE);
    const windsurfOk = existsSync(join(WINDSURF_SKILL_DIR, 'SKILL.md'));

    log.say(`  Claude Code skill:        ${claudeOk   ? '✓' : '✗'}  ${CLAUDE_SKILLS_DIR}`);
    log.say(`  Claude Code slash cmd:    ${claudeCmdOk? '✓' : '✗'}  ${CLAUDE_CMD_FILE}`);
    log.say(`  Windsurf skill:           ${windsurfOk ? '✓' : '✗'}  ${WINDSURF_SKILL_DIR}`);

    log.say('');
    log.say('Per-repo Windsurf workflows:');
    const groups = listRegistered();
    if (Object.keys(groups).length === 0) {
        log.info('(no groups registered)');
        return;
    }
    for (const group of Object.keys(groups)) {
        const cfgPath = groups[group].config;
        if (!existsSync(cfgPath)) continue;
        const cfg = loadConfig(cfgPath);
        for (const r of cfg.repos) {
            const dst = repoWorkflowPath(r.path);
            const ok = existsSync(dst);
            log.say(`  ${ok ? '✓' : '✗'}  ${group}/${r.slug}: ${dst}`);
        }
    }
}

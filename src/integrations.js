// Per-repo integrations: ignores, .mcp.json, Claude/Windsurf, git hooks, remerge helper.
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, rmdirSync, chmodSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
    TEMPLATES_DIR, LOCAL_BIN, GROUPS_DIR, IS_WIN,
    ensureDir, readJson, writeJson, log, run, runOrThrow, graphifyPython,
} from './util.js';

const STACK_TEMPLATES = ['react-native', 'python', 'node', 'go', 'generic'];

export function writeGraphifyignore(repo, stack) {
    const dst = join(repo, '.graphifyignore');
    if (existsSync(dst)) { log.info('.graphifyignore already exists, leaving as-is'); return; }
    const tplName = STACK_TEMPLATES.includes(stack) ? stack : 'generic';
    const src = join(TEMPLATES_DIR, `graphifyignore-${tplName}.txt`);
    copyFileSync(src, dst);
    log.info(`.graphifyignore written (${tplName} template)`);
}

export function updateGitignore(repo) {
    const f = join(repo, '.gitignore');
    const existing = existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (existing.includes('# graphify-fleet')) return;
    const block = `
# graphify-fleet
docs/
graphify-out/wiki/
graphify-out/manifest.json
graphify-out/cost.json
graphify-out/cache/
`;
    writeFileSync(f, existing + block);
    log.info('.gitignore updated (docs/ + graphify-out scratch)');
}

export function writeMcpJson(repo, groupGraph, repoSlug, group) {
    const f = join(repo, '.mcp.json');
    const py = graphifyPython();
    const repoGraph = join(repo, 'graphify-out', 'graph.json');
    const obj = existsSync(f) ? readJson(f) : { mcpServers: {} };
    obj.mcpServers = obj.mcpServers ?? {};
    // Per-repo MCP — focused queries, no cross-repo noise
    obj.mcpServers[`graphify-${repoSlug}`] = {
        command: py,
        args: ['-m', 'graphify.serve', repoGraph],
    };
    // Group MCP — for explicit cross-repo questions
    obj.mcpServers[`graphify-${group}`] = {
        command: py,
        args: ['-m', 'graphify.serve', groupGraph],
    };
    // Remove old single-key 'graphify' entry from previous gfleet versions (cleanup)
    delete obj.mcpServers.graphify;
    writeJson(f, obj);
    log.info(`.mcp.json: graphify-${repoSlug} (repo) + graphify-${group} (group)`);
}

export function installClaudeSkill(repo) {
    const r = run('graphify', ['claude', 'install'], { cwd: repo });
    if (r.code === 0) log.info('claude skill installed (CLAUDE.md + PreToolUse hook)');
    else log.warn('graphify claude install failed (continuing)');
}

const WINDSURF_WORKFLOW_TEMPLATE = join(TEMPLATES_DIR, 'windsurf-workflow.md');

export function writeWindsurfFiles(repo, group, groupGraph, allRepos = [], repoSlug = null) {
    const wf = join(repo, '.windsurf', 'workflows');
    ensureDir(wf);
    copyFileSync(WINDSURF_WORKFLOW_TEMPLATE, join(wf, 'graphify.md'));
    upsertAgentRulesBlock(join(repo, '.windsurfrules'), group, groupGraph, allRepos, null, repoSlug);
    log.info('windsurf workflow + rules written');
}

const RULES_TEMPLATE = join(TEMPLATES_DIR, 'agent-rules-block.md');
const RULES_START = '<!-- gfleet:graphify-rules:start -->';
const RULES_END   = '<!-- gfleet:graphify-rules:end -->';

function buildRulesBlock(group, groupGraph, allRepos, groupDocsPath, repoSlug) {
    const tpl = readFileSync(RULES_TEMPLATE, 'utf8');
    const reposList = allRepos.length === 0 ? '' :
        allRepos.map(r => `- ${r.slug} (${r.stack})  ${r.path}`).join('\n');
    return tpl
        .replace(/\{\{group\}\}/g, group)
        .replace(/\{\{repo_slug\}\}/g, repoSlug || '<this-repo>')
        .replace(/\{\{repos_list\}\}/g, reposList || `(other repos in group "${group}")`)
        .replace(/\{\{group_docs_path\}\}/g, groupDocsPath || `<group-docs-path>`);
}

// Idempotent: replaces the gfleet-managed block, preserves all other content.
export function upsertAgentRulesBlock(rulesFile, group, groupGraph, allRepos = [], groupDocsPath = null, repoSlug = null) {
    const block = buildRulesBlock(group, groupGraph, allRepos, groupDocsPath, repoSlug);
    const wrapped = `\n${RULES_START}\n${block}\n${RULES_END}\n`;

    let cur = existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8') : '';

    // 1. If our markers exist: replace between them
    if (cur.includes(RULES_START) && cur.includes(RULES_END)) {
        const re = new RegExp(`${RULES_START.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}[\\s\\S]*?${RULES_END.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`);
        cur = cur.replace(re, `${RULES_START}\n${block}\n${RULES_END}`);
    }
    // 2. If old thin block exists ("## graphify" without our markers): replace it
    else if (/^## graphify\b/m.test(cur)) {
        // strip from "## graphify" header to the next H2 (or EOF)
        cur = cur.replace(/(^|\n)## graphify\b[\s\S]*?(?=\n## |\n*$)/m, `$1${RULES_START}\n${block}\n${RULES_END}\n`);
    }
    // 3. Append fresh
    else {
        cur = cur + wrapped;
    }

    writeFileSync(rulesFile, cur);
}

export function ensureClaudeRules(repo, group, groupGraph, allRepos = [], groupDocsPath = null, repoSlug = null) {
    upsertAgentRulesBlock(join(repo, 'CLAUDE.md'), group, groupGraph, allRepos, groupDocsPath, repoSlug);
}
export function ensureAgentsRules(repo, group, groupGraph, allRepos = [], groupDocsPath = null, repoSlug = null) {
    upsertAgentRulesBlock(join(repo, 'AGENTS.md'), group, groupGraph, allRepos, groupDocsPath, repoSlug);
}

export function writeRemergeHelper(group, groupGraph, repos) {
    ensureDir(LOCAL_BIN);
    ensureDir(GROUPS_DIR);
    const helperPath = join(LOCAL_BIN, IS_WIN ? `graphify-fleet-merge-${group}.ps1` : `graphify-fleet-merge-${group}`);
    const graphs = repos.map(r => join(r.path, 'graphify-out', 'graph.json'));

    if (IS_WIN) {
        const list = graphs.map(g => `'${g.replace(/'/g, "''")}'`).join(',');
        const ps = `# auto-generated by gfleet — re-merge group '${group}'
$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Seconds 3
$graphs = @(${list})
$existing = $graphs | Where-Object { Test-Path $_ }
if ($existing.Count -ge 2) {
    & graphify merge-graphs $existing --out '${groupGraph}' | Out-Null
} elseif ($existing.Count -eq 1) {
    Copy-Item $existing[0] '${groupGraph}' -Force
}
`;
        writeFileSync(helperPath, ps);
    } else {
        const arrayLines = graphs.map(g => `GRAPHS+=("${g.replace(/"/g, '\\"')}")`).join('\n');
        const sh = `#!/usr/bin/env bash
# auto-generated by gfleet — re-merge group '${group}'
set -e
GROUP_GRAPH="${groupGraph}"
GRAPHS=()
${arrayLines}
sleep 3
EXISTING=()
for g in "\${GRAPHS[@]}"; do [ -f "$g" ] && EXISTING+=("$g"); done
if [ "\${#EXISTING[@]}" -ge 2 ]; then
    graphify merge-graphs "\${EXISTING[@]}" --out "$GROUP_GRAPH" >/dev/null 2>&1 || true
elif [ "\${#EXISTING[@]}" -eq 1 ]; then
    cp "\${EXISTING[0]}" "$GROUP_GRAPH"
fi
`;
        writeFileSync(helperPath, sh);
        chmodSync(helperPath, 0o755);
    }
    return helperPath;
}

const HOOK_NAMES = ['post-commit', 'post-checkout'];

export function installGitHooks(repo, group, helperPath) {
    const r = run('graphify', ['hook', 'install'], { cwd: repo });
    if (r.code !== 0) log.warn('graphify hook install failed (continuing)');
    for (const name of HOOK_NAMES) {
        const f = join(repo, '.git', 'hooks', name);
        if (!existsSync(f)) continue;
        const cur = readFileSync(f, 'utf8');
        if (cur.includes(`gfleet-start (${group})`)) continue;
        const block = IS_WIN
            ? `\n# gfleet-start (${group})\npwsh -NoProfile -File "${helperPath}" 2>$null &\n# gfleet-end (${group})\n`
            : `\n# gfleet-start (${group})\nnohup "${helperPath}" > /dev/null 2>&1 &\ndisown 2>/dev/null || true\n# gfleet-end (${group})\n`;
        appendFileSync(f, block);
        chmodSync(f, 0o755);
    }
    log.info('git hooks installed (+ group remerge)');
}

export function removeGitHooks(repo, group) {
    for (const name of HOOK_NAMES) {
        const f = join(repo, '.git', 'hooks', name);
        if (!existsSync(f)) continue;
        const cur = readFileSync(f, 'utf8');
        const re = new RegExp(`\\n?# gfleet-start \\(${group}\\)[\\s\\S]*?# gfleet-end \\(${group}\\)\\n?`, 'g');
        const cleaned = cur.replace(re, '');
        if (cleaned !== cur) writeFileSync(f, cleaned);
    }
}

export function removeMcpEntry(repo) {
    const f = join(repo, '.mcp.json');
    if (!existsSync(f)) return;
    const obj = readJson(f);
    if (!obj.mcpServers?.graphify) return;
    delete obj.mcpServers.graphify;
    if (Object.keys(obj.mcpServers).length === 0) {
        try { unlinkSync(f); log.info('.mcp.json removed (was empty)'); } catch {}
    } else {
        writeJson(f, obj);
        log.info('.mcp.json: graphify entry removed');
    }
}

export function removeWindsurfFiles(repo) {
    // Remove all workflow files we may have written
    for (const name of ['graphify.md', 'generate-docs.md']) {
        try { unlinkSync(join(repo, '.windsurf', 'workflows', name)); } catch {}
    }
    try { rmdirSync(join(repo, '.windsurf', 'workflows')); } catch {}
    try { rmdirSync(join(repo, '.windsurf')); } catch {}
    // Strip from rules files: marker block (new) + thin "## graphify" (legacy)
    for (const f of [join(repo, '.windsurfrules'), join(repo, 'CLAUDE.md'), join(repo, 'AGENTS.md')]) {
        if (!existsSync(f)) continue;
        let cur = readFileSync(f, 'utf8');
        const before = cur;
        // marker-wrapped block
        cur = cur.replace(/\n*<!-- gfleet:graphify-rules:start -->[\s\S]*?<!-- gfleet:graphify-rules:end -->\n*/g, '\n');
        // legacy thin "## graphify" section (terminate at next H2 or EOF)
        cur = cur.replace(/\n*## graphify\b[\s\S]*?(?=\n## |\n*$)/g, '\n');
        if (cur !== before) writeFileSync(f, cur);
    }
}

// Global Windsurf MCP entry. Windsurf has shipped two locations across versions:
//   - ~/.codeium/mcp_config.json          (newer / Cascade-era)
//   - ~/.codeium/windsurf/mcp_config.json (older / standalone Windsurf)
// We write to both so the right one is picked up regardless of build.
const WINDSURF_MCP_PATHS = [
    join(process.env.HOME ?? '', '.codeium', 'mcp_config.json'),
    join(process.env.HOME ?? '', '.codeium', 'windsurf', 'mcp_config.json'),
];

export function addWindsurfGlobalMcp(group, groupGraph, repos = []) {
    const py = graphifyPython();
    const groupServer = { command: py, args: ['-m', 'graphify.serve', groupGraph] };
    for (const p of WINDSURF_MCP_PATHS) {
        ensureDir(dirname(p));
        const obj = existsSync(p) ? readJson(p) : {};
        obj.mcpServers = obj.mcpServers ?? {};
        // Group MCP
        obj.mcpServers[`graphify-${group}`] = groupServer;
        // Per-repo MCPs
        for (const r of repos) {
            const repoGraph = join(r.path, 'graphify-out', 'graph.json');
            obj.mcpServers[`graphify-${r.slug}`] = {
                command: py,
                args: ['-m', 'graphify.serve', repoGraph],
            };
        }
        writeJson(p, obj);
    }
    log.info(`windsurf MCP: graphify-${group} (group) + ${repos.length} per-repo entries (×${WINDSURF_MCP_PATHS.length} paths)`);
}

export function removeWindsurfGlobalMcp(group) {
    for (const p of WINDSURF_MCP_PATHS) {
        if (!existsSync(p)) continue;
        const obj = readJson(p);
        if (obj.mcpServers?.[`graphify-${group}`]) {
            delete obj.mcpServers[`graphify-${group}`];
            writeJson(p, obj);
        }
    }
}

const WINDSURF_SKILL_DST = join(process.env.HOME ?? '', '.codeium', 'windsurf', 'skills', 'graphify', 'SKILL.md');
const WINDSURF_SKILL_URL = 'https://raw.githubusercontent.com/safishamsi/graphify/7c77a891939f889b99b48c0e8bc8cee5546a4c72/graphify/skill-windsurf.md';

export async function ensureWindsurfSkill() {
    if (existsSync(WINDSURF_SKILL_DST)) return;
    ensureDir(dirname(WINDSURF_SKILL_DST));
    try {
        const r = await fetch(WINDSURF_SKILL_URL);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        writeFileSync(WINDSURF_SKILL_DST, text);
        log.info('windsurf SKILL.md installed (from PR #574)');
    } catch (e) {
        log.warn(`could not fetch windsurf SKILL.md: ${e.message}`);
    }
}

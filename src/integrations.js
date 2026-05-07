// Per-repo integrations: ignores, .mcp.json, Claude/Windsurf, git hooks, remerge helper.
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, rmSync, rmdirSync, chmodSync, appendFileSync } from 'node:fs';
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
    const reposTable = allRepos.length === 0 ? '| (no repos in registry) | | |' :
        allRepos.map(r => `| ${r.slug === repoSlug ? '**' + r.slug + ' (this)**' : r.slug} | \`${r.slug}\` | ${r.path} |`).join('\n');
    return tpl
        .replace(/\{\{group\}\}/g, group)
        .replace(/\{\{repo_slug\}\}/g, repoSlug || '<this-repo>')
        .replace(/\{\{repos_list\}\}/g, reposList || `(other repos in group "${group}")`)
        .replace(/\{\{repos_table\}\}/g, reposTable)
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

// Merge driver registers `graphify merge-driver` for graph.json files,
// preventing conflicts when two devs commit graph rebuilds in parallel.
// graphify announced this in v0.7.0 but the auto-install was missing in 0.7.9
// — gfleet sets it up explicitly. Two parts:
//   (a) git config in .git/config (per-clone, NOT committed) — registers the driver
//   (b) .gitattributes (committed) — tells git to use the driver for graph.json
const MERGE_DRIVER_NAME = 'graphify graph.json union merger';
const MERGE_DRIVER_CMD  = 'graphify merge-driver %O %A %B';
const GITATTRIBUTES_LINE = '**/graphify-out/graph.json merge=graphify';

export function installMergeDriver(gitRoot) {
    // (a) Register driver in local .git/config (per-clone)
    const r1 = run('git', ['-C', gitRoot, 'config', 'merge.graphify.name', MERGE_DRIVER_NAME]);
    const r2 = run('git', ['-C', gitRoot, 'config', 'merge.graphify.driver', MERGE_DRIVER_CMD]);
    if (r1.code !== 0 || r2.code !== 0) { log.warn('failed to register merge driver in .git/config'); return false; }

    // (b) Ensure .gitattributes has the entry (committed)
    const f = join(gitRoot, '.gitattributes');
    const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (!cur.includes('merge=graphify')) {
        const sep = cur.endsWith('\n') || cur === '' ? '' : '\n';
        const block = `${sep}# graphify-fleet — union-merge graph.json instead of conflict markers\n${GITATTRIBUTES_LINE}\n`;
        writeFileSync(f, cur + block);
        log.info(`merge driver registered + .gitattributes updated (commit it: git add .gitattributes && git commit)`);
    } else {
        log.info(`merge driver registered (.gitattributes already has the entry)`);
    }
    return true;
}

export function removeMergeDriver(gitRoot) {
    run('git', ['-C', gitRoot, 'config', '--unset', 'merge.graphify.name']);
    run('git', ['-C', gitRoot, 'config', '--unset', 'merge.graphify.driver']);
    // .gitattributes: only remove the gfleet-added block (preserve any user lines)
    const f = join(gitRoot, '.gitattributes');
    if (!existsSync(f)) return;
    let cur = readFileSync(f, 'utf8');
    cur = cur.replace(/\n*# graphify-fleet[\s\S]*?\*\*\/graphify-out\/graph\.json merge=graphify\n/g, '\n');
    writeFileSync(f, cur);
}

export function checkMergeDriverStatus(gitRoot) {
    const r = run('git', ['-C', gitRoot, 'config', '--get', 'merge.graphify.driver']);
    const registered = r.code === 0 && r.stdout.trim() === MERGE_DRIVER_CMD;
    const f = join(gitRoot, '.gitattributes');
    const attribOk = existsSync(f) && readFileSync(f, 'utf8').includes('merge=graphify');
    return { registered, attribOk };
}

// ------------------------------------------------------------
// .gfleet/group.json — portable, committed manifest
// ------------------------------------------------------------
// Travels with the repo (committed). Contains group identity + siblings
// (slugs, stacks, optional clone_urls). Does NOT contain absolute paths,
// since those vary per teammate. `gfleet onboard` reads this to bootstrap
// a teammate after `git clone`.

export function writeGroupManifest(repo, group, options, thisRepo, allRepos) {
    const dir = join(repo, '.gfleet');
    ensureDir(dir);
    const manifest = {
        version: 1,
        group,
        this: { slug: thisRepo.slug, stack: thisRepo.stack },
        siblings: allRepos
            .filter(r => r.slug !== thisRepo.slug)
            .map(r => ({ slug: r.slug, stack: r.stack, clone_url: null })),
        options: {
            wiki_gitignored: options.wiki_gitignored,
            watchers:        options.watchers,
            windsurf:        options.windsurf,
            claude_code:     options.claude_code,
            docs:            options.docs ? { enabled: true } : null,
        },
    };
    // Preserve clone_urls if a previous manifest set them (don't overwrite manual edits)
    const f = join(dir, 'group.json');
    if (existsSync(f)) {
        try {
            const prev = readJson(f);
            for (const s of manifest.siblings) {
                const prevSibling = (prev.siblings ?? []).find(p => p.slug === s.slug);
                if (prevSibling?.clone_url) s.clone_url = prevSibling.clone_url;
            }
        } catch {}
    }
    writeJson(f, manifest);
    log.info(`.gfleet/group.json written (commit it so teammates can run gfleet onboard)`);
}

export function readGroupManifest(repo) {
    const f = join(repo, '.gfleet', 'group.json');
    if (!existsSync(f)) return null;
    return readJson(f);
}

export function removeGroupManifest(repo) {
    const f = join(repo, '.gfleet', 'group.json');
    if (existsSync(f)) {
        try { rmSync(f, { force: true }); } catch {}
    }
}

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
    // Windsurf's mcp_config.json is GLOBAL (loaded by every session). If we
    // register multiple graphify-* servers here, Windsurf can't disambiguate
    // their tool names ("Duplicate tool name: mcp0_get_community"). So in
    // Windsurf we register only the GROUP MCP. Repo-local queries in Windsurf
    // are done by passing { repo: "<slug>" } as a filter argument to the
    // group MCP — every node has a `repo` field. Claude Code uses per-project
    // .mcp.json which CAN safely host multiple graphify-* servers because
    // only one project's config is loaded per session.
    const py = graphifyPython();
    const groupServer = { command: py, args: ['-m', 'graphify.serve', groupGraph] };
    for (const p of WINDSURF_MCP_PATHS) {
        ensureDir(dirname(p));
        const obj = existsSync(p) ? readJson(p) : {};
        obj.mcpServers = obj.mcpServers ?? {};
        // Group MCP only
        obj.mcpServers[`graphify-${group}`] = groupServer;
        // Cleanup: remove any per-repo graphify-* entries from previous gfleet
        // versions that erroneously registered them in Windsurf's global config.
        for (const r of repos) {
            delete obj.mcpServers[`graphify-${r.slug}`];
        }
        writeJson(p, obj);
    }
    log.info(`windsurf MCP: graphify-${group} (group only — Windsurf is global; use repo-filter for repo-local queries)`);
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

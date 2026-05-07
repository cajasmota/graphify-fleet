// Patch: add repo_filter parameter to graphify's MCP server tools.
// Lets a single graphify-<group> MCP serve both repo-local and cross-repo
// queries (eliminates the dual-MCP workaround).
//
// Idempotent. Detects already-applied state via a marker comment.
// Drift-aware: gfleet doctor checks if graphify upgraded (lost the patch)
// and offers re-application.
//
// Affects: query_graph, get_neighbors, shortest_path tools.

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { graphifyPython, log } from '../util.js';

const PATCH_VERSION = 1;
const MARKER = `# gfleet-patched: graphify-repo-filter v${PATCH_VERSION}`;

// String replacements to apply, in order. Each must be either already-applied
// (check matches) or pre-patch (find matches). If neither, fail with diag.
const PATCHES = [
    // -----------------------------------------------------------
    // 1. _query_graph_text signature + filter logic
    // -----------------------------------------------------------
    {
        name: '_query_graph_text signature',
        find:
`    context_filters: list[str] | None = None,
) -> str:
    terms = [t.lower() for t in question.split() if len(t) > 2]`,
        replace:
`    context_filters: list[str] | None = None,
    repo_filter: str | None = None,  # ${MARKER}
) -> str:
    if repo_filter:
        G = G.subgraph([n for n, d in G.nodes(data=True) if d.get("repo") == repo_filter]).copy()
    terms = [t.lower() for t in question.split() if len(t) > 2]`,
        check: `repo_filter: str | None = None,  # ${MARKER}`,
    },

    // -----------------------------------------------------------
    // 2. query_graph inputSchema — add repo_filter property
    // -----------------------------------------------------------
    {
        name: 'query_graph inputSchema repo_filter',
        find:
`                        "context_filter": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional explicit edge-context filter, e.g. ['call', 'field']",
                        },
                    },
                    "required": ["question"],`,
        replace:
`                        "context_filter": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional explicit edge-context filter, e.g. ['call', 'field']",
                        },
                        "repo_filter": {  # ${MARKER}
                            "type": "string",
                            "description": "Optional. Restrict traversal to nodes from this repo (matches the 'repo' field on each node). Use in cross-repo merged graphs to scope queries to one repo.",
                        },
                    },
                    "required": ["question"],`,
        check: `"repo_filter": {  # ${MARKER}`,
    },

    // -----------------------------------------------------------
    // 3. _tool_query_graph — read + forward repo_filter
    // -----------------------------------------------------------
    {
        name: '_tool_query_graph forwards repo_filter',
        find:
`        context_filter = arguments.get("context_filter")
        return _query_graph_text(
            G,
            question,
            mode=mode,
            depth=depth,
            token_budget=budget,
            context_filters=context_filter,
        )`,
        replace:
`        context_filter = arguments.get("context_filter")
        repo_filter = arguments.get("repo_filter")  # ${MARKER}
        return _query_graph_text(
            G,
            question,
            mode=mode,
            depth=depth,
            token_budget=budget,
            context_filters=context_filter,
            repo_filter=repo_filter,
        )`,
        check: `repo_filter = arguments.get("repo_filter")  # ${MARKER}`,
    },

    // -----------------------------------------------------------
    // 4. get_neighbors inputSchema — add repo_filter
    // -----------------------------------------------------------
    {
        name: 'get_neighbors inputSchema repo_filter',
        find:
`                inputSchema={
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "relation_filter": {"type": "string", "description": "Optional: filter by relation type"},
                    },
                    "required": ["label"],
                },
            ),
            types.Tool(
                name="get_community",`,
        replace:
`                inputSchema={
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "relation_filter": {"type": "string", "description": "Optional: filter by relation type"},
                        "repo_filter": {"type": "string", "description": "Optional. Restrict to neighbors from this repo. ${MARKER}"},
                    },
                    "required": ["label"],
                },
            ),
            types.Tool(
                name="get_community",`,
        check: `"description": "Optional. Restrict to neighbors from this repo. ${MARKER}"`,
    },

    // -----------------------------------------------------------
    // 5. shortest_path inputSchema — add repo_filter
    // -----------------------------------------------------------
    {
        name: 'shortest_path inputSchema repo_filter',
        find:
`                        "source": {"type": "string", "description": "Source concept label or keyword"},
                        "target": {"type": "string", "description": "Target concept label or keyword"},
                        "max_hops": {"type": "integer", "default": 8, "description": "Maximum hops to consider"},
                    },
                    "required": ["source", "target"],`,
        replace:
`                        "source": {"type": "string", "description": "Source concept label or keyword"},
                        "target": {"type": "string", "description": "Target concept label or keyword"},
                        "max_hops": {"type": "integer", "default": 8, "description": "Maximum hops to consider"},
                        "repo_filter": {"type": "string", "description": "Optional. Restrict path search to a single repo. ${MARKER}"},
                    },
                    "required": ["source", "target"],`,
        check: `"description": "Optional. Restrict path search to a single repo. ${MARKER}"`,
    },
];

function locateServe() {
    const py = graphifyPython();
    if (!py) return null;
    const r = spawnSync(py, ['-c', 'import graphify.serve; print(graphify.serve.__file__)'], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    return r.stdout.trim();
}

export function checkPatchStatus() {
    const path = locateServe();
    if (!path) return { state: 'no-graphify', path: null };
    if (!existsSync(path)) return { state: 'no-graphify', path };
    const src = readFileSync(path, 'utf8');
    const applied = PATCHES.filter(p => src.includes(p.check)).length;
    if (applied === 0) return { state: 'unpatched', path, applied: 0, total: PATCHES.length };
    if (applied === PATCHES.length) return { state: 'patched', path, applied, total: PATCHES.length };
    return { state: 'partial', path, applied, total: PATCHES.length };
}

export function applyPatch({ verbose = true } = {}) {
    const status = checkPatchStatus();
    if (status.state === 'no-graphify') {
        log.warn('graphify not installed — skipping patch');
        return false;
    }
    if (status.state === 'patched') {
        if (verbose) log.ok(`graphify already patched (repo-filter v${PATCH_VERSION})`);
        return true;
    }

    if (verbose) {
        log.info(`patching ${status.path}`);
        log.info(`  current: ${status.applied}/${status.total} hunks applied`);
    }

    let src = readFileSync(status.path, 'utf8');

    // Backup once per machine. Subsequent patches don't overwrite the backup
    // so we always have the as-installed graphify available.
    const backupPath = `${status.path}.gfleet-orig`;
    if (!existsSync(backupPath)) {
        copyFileSync(status.path, backupPath);
        if (verbose) log.info(`  backup: ${backupPath}`);
    }

    for (const hunk of PATCHES) {
        if (src.includes(hunk.check)) continue;  // already applied
        if (!src.includes(hunk.find)) {
            log.warn(`  hunk did not match: ${hunk.name} (graphify upstream may have changed; skipping)`);
            continue;
        }
        src = src.replace(hunk.find, hunk.replace);
        if (verbose) log.info(`  applied: ${hunk.name}`);
    }

    writeFileSync(status.path, src);
    const after = checkPatchStatus();
    if (after.state === 'patched') {
        if (verbose) log.ok(`graphify patched (repo_filter parameter on query_graph, get_neighbors, shortest_path)`);
        return true;
    } else {
        log.warn(`partial patch applied: ${after.applied}/${after.total} hunks. Some hunks didn't match — graphify upstream may have changed.`);
        return false;
    }
}

export function revertPatch() {
    const status = checkPatchStatus();
    if (status.state === 'no-graphify') { log.warn('graphify not installed'); return false; }
    const backupPath = `${status.path}.gfleet-orig`;
    if (!existsSync(backupPath)) {
        log.warn(`no backup found at ${backupPath} — cannot revert. Reinstall graphifyy: uv tool install graphifyy --reinstall`);
        return false;
    }
    copyFileSync(backupPath, status.path);
    log.ok(`reverted ${status.path} from backup`);
    return true;
}

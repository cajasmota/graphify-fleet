// Patch: add repo_filter parameter to graphify's MCP server tools.
// Lets a single graphify-<group> MCP serve both repo-local and cross-repo
// queries (eliminates the dual-MCP workaround).
//
// Idempotent. Detects already-applied state via a marker comment.
// Drift-aware: gfleet doctor checks if graphify upgraded (lost the patch)
// and offers re-application.
//
// Affects: query_graph, get_neighbors, shortest_path tools.

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { graphifyPython, log } from '../util.js';

// Persistent state across patch operations: tracks which gfleet version (and
// installed graphify version) created the backup file, so we can invalidate
// the backup when graphifyy is upgraded out from under us.
const PATCH_STATE_PATH = join(homedir(), '.graphify-fleet', 'patch-state.json');

function readPatchState() {
    if (!existsSync(PATCH_STATE_PATH)) return {};
    try { return JSON.parse(readFileSync(PATCH_STATE_PATH, 'utf8')); }
    catch { return {}; }
}

function writePatchState(obj) {
    try {
        mkdirSync(dirname(PATCH_STATE_PATH), { recursive: true });
        writeFileSync(PATCH_STATE_PATH, JSON.stringify(obj, null, 2) + '\n');
    } catch {}
}

function getInstalledGraphifyVersion() {
    const py = graphifyPython();
    if (!py) return null;
    const r = spawnSync(py, ['-c', `from importlib.metadata import version; print(version('graphifyy'))`], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}

// v2 = adds live-reload-on-mtime hunks (6-9) to keep MCP queries fresh after
// per-repo or group graph rebuilds without restarting the server.
const PATCH_VERSION = 2;
const MARKER = `# gfleet-patched: graphify-mcp-enhancements v${PATCH_VERSION}`;
// Backward-compat marker still recognized so v1-patched installs are picked up
// as "partial" and re-applied cleanly on next `gfleet update` / `gfleet patch graphify`.
const LEGACY_MARKER_V1 = `# gfleet-patched: graphify-repo-filter v1`;

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
        // Marker-agnostic check: matches v1 and v2 patched output (the body
        // `if repo_filter: G = G.subgraph...` is stable across versions).
        check: `if repo_filter:\n        G = G.subgraph([n for n, d in G.nodes(data=True) if d.get("repo") == repo_filter]).copy()`,
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
        // Marker-agnostic: this exact description string is stable across versions.
        check: `"description": "Optional. Restrict traversal to nodes from this repo (matches the 'repo' field on each node). Use in cross-repo merged graphs to scope queries to one repo.",`,
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
        // Marker-agnostic: forwarding the kwarg to _query_graph_text is stable.
        check: `repo_filter = arguments.get("repo_filter")`,
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
        // Marker-agnostic: stable prefix shared by v1/v2 outputs.
        check: `"description": "Optional. Restrict to neighbors from this repo.`,
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
        // Marker-agnostic: stable prefix shared by v1/v2 outputs.
        check: `"description": "Optional. Restrict path search to a single repo.`,
    },

    // -----------------------------------------------------------
    // 6. Capture initial graph mtime + helper for live reload
    //    Inserted right after the initial G = _load_graph(...) line.
    // -----------------------------------------------------------
    {
        name: 'live-reload: capture initial mtime + reloader',
        find:
`    G = _load_graph(graph_path)
    communities = _communities_from_graph(G)`,
        replace:
`    G = _load_graph(graph_path)
    communities = _communities_from_graph(G)
    # ${MARKER}
    # Live-reload: re-read graph.json when its mtime advances. Stat is sub-ms;
    # full reload only fires when the file actually changed (post-commit hook,
    # watcher rebuild, or watcher-triggered group merge). Single-threaded
    # enough that no mutex is required.
    import os as _gfleet_os
    try:
        _graph_mtime = _gfleet_os.stat(graph_path).st_mtime
    except OSError:
        _graph_mtime = 0.0

    def _gfleet_reload_if_stale() -> None:
        nonlocal G, communities, _graph_mtime
        try:
            current = _gfleet_os.stat(graph_path).st_mtime
        except OSError:
            return
        if current > _graph_mtime:
            try:
                G = _load_graph(graph_path)
                communities = _communities_from_graph(G)
                _graph_mtime = current
            except SystemExit:
                # _load_graph calls sys.exit on bad JSON — swallow so the
                # MCP server keeps serving the previously loaded graph.
                pass`,
        check: `def _gfleet_reload_if_stale() -> None:`,
    },

    // -----------------------------------------------------------
    // 7. Reload-before-call hook in _tool_query_graph
    // -----------------------------------------------------------
    {
        name: 'live-reload: query_graph reload check',
        find:
`    def _tool_query_graph(arguments: dict) -> str:
        question = arguments["question"]`,
        replace:
`    def _tool_query_graph(arguments: dict) -> str:
        _gfleet_reload_if_stale()  # ${MARKER}
        question = arguments["question"]`,
        check: `_gfleet_reload_if_stale()  # ${MARKER}`,
    },

    // -----------------------------------------------------------
    // 8. Reload-before-call hook in _tool_get_node + _tool_get_neighbors
    // -----------------------------------------------------------
    {
        name: 'live-reload: get_node reload check',
        find:
`    def _tool_get_node(arguments: dict) -> str:
        label = arguments["label"].lower()`,
        replace:
`    def _tool_get_node(arguments: dict) -> str:
        _gfleet_reload_if_stale()
        label = arguments["label"].lower()`,
        check: `def _tool_get_node(arguments: dict) -> str:\n        _gfleet_reload_if_stale()`,
    },

    {
        name: 'live-reload: get_neighbors reload check',
        find:
`    def _tool_get_neighbors(arguments: dict) -> str:
        label = arguments["label"].lower()`,
        replace:
`    def _tool_get_neighbors(arguments: dict) -> str:
        _gfleet_reload_if_stale()
        label = arguments["label"].lower()`,
        check: `def _tool_get_neighbors(arguments: dict) -> str:\n        _gfleet_reload_if_stale()`,
    },

    // -----------------------------------------------------------
    // 9. Reload-before-call hook in _tool_shortest_path
    // -----------------------------------------------------------
    {
        name: 'live-reload: shortest_path reload check',
        find:
`    def _tool_shortest_path(arguments: dict) -> str:
        src_scored = _score_nodes(G, [t.lower() for t in arguments["source"].split()])`,
        replace:
`    def _tool_shortest_path(arguments: dict) -> str:
        _gfleet_reload_if_stale()
        src_scored = _score_nodes(G, [t.lower() for t in arguments["source"].split()])`,
        check: `def _tool_shortest_path(arguments: dict) -> str:\n        _gfleet_reload_if_stale()`,
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
        if (verbose) log.ok(`graphify already patched (mcp-enhancements v${PATCH_VERSION}: repo_filter + live-reload)`);
        return true;
    }

    if (verbose) {
        log.info(`patching ${status.path}`);
        log.info(`  current: ${status.applied}/${status.total} hunks applied`);
    }

    let src = readFileSync(status.path, 'utf8');

    // Backup policy:
    //   - Only write the backup if the file is currently UNPATCHED (zero
    //     hunks applied). After a `gfleet patch revert` the file should be
    //     unpatched, so a fresh patch+revert cycle keeps the original intact.
    //   - If hunks are already applied (state == 'partial' or 'patched'),
    //     leave the existing backup alone — overwriting would lose the
    //     original.
    //   - If the installed graphifyy version differs from what was recorded
    //     when the backup was created, invalidate it and re-take a fresh
    //     backup (the prior backup belongs to a different graphifyy version
    //     and is no longer useful as a "revert to as-installed" source).
    const backupPath = `${status.path}.gfleet-orig`;
    const installedVer = getInstalledGraphifyVersion();
    const state = readPatchState();
    const stateForPath = state[status.path] || {};
    const versionMismatch = stateForPath.graphifyy_version &&
                            installedVer &&
                            stateForPath.graphifyy_version !== installedVer;
    if (versionMismatch && existsSync(backupPath)) {
        log.warn(`  backup is from graphifyy ${stateForPath.graphifyy_version}; installed is ${installedVer} — invalidating and re-taking.`);
        try { copyFileSync(status.path, backupPath); } catch {}  // overwrite (current is unpatched at this point if status.applied===0)
    } else if (!existsSync(backupPath)) {
        if (status.applied === 0) {
            copyFileSync(status.path, backupPath);
            if (verbose) log.info(`  backup: ${backupPath}`);
        } else {
            // No backup AND already-partly-patched — best-effort note; we
            // can't reconstruct the original. Continue patching anyway.
            log.warn(`  no backup at ${backupPath} but file is partly patched — proceeding without writing backup`);
        }
    }
    // Record provenance of the backup (or current patch attempt).
    state[status.path] = {
        graphifyy_version: installedVer,
        last_apply_at: new Date().toISOString(),
    };
    writePatchState(state);

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
        if (verbose) log.ok(`graphify patched (repo_filter parameter + live-reload-on-mtime for save→query freshness)`);
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
    // Keep the backup file in place after revert (so a subsequent re-apply
    // doesn't try to back up an already-reverted file). Record the revert
    // event in patch-state.json so we can detect upgrade-via-`uv tool
    // upgrade graphifyy` and invalidate the backup on the next apply.
    const state = readPatchState();
    state[status.path] = {
        ...(state[status.path] || {}),
        graphifyy_version: getInstalledGraphifyVersion(),
        last_revert_at: new Date().toISOString(),
    };
    writePatchState(state);
    log.ok(`reverted ${status.path} from backup`);
    return true;
}

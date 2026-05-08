# gfleet-managed MCP stdio server. Forked from upstream graphify `serve.py`
# and modularized into the `mcp_server` package — see `__init__.py` for the
# package layout.
#
# CLI:  python -m mcp_server <graphs-dir> [--group <tag>]
# or:   python <gfleet>/src/mcp_server/__main__.py <graphs-dir> [--group <tag>]
#
# Tools (same surface as upstream graphify, plus repo_filter on every tool
# that traverses, plus the gfleet-native `save_result`):
#   query_graph(question, mode, depth, token_budget, context_filter, repo_filter)
#   get_node(label, repo_filter)
#   get_neighbors(label, relation_filter, repo_filter)
#   get_community(community_id, repo_filter)
#   list_communities(repo_filter)
#   god_nodes(top_n, repo_filter)
#   graph_stats(repo_filter)
#   shortest_path(source, target, max_hops, repo_filter)
#   save_result(question, answer, type, nodes, repo_filter)
#   get_node_source(node_id, context_lines)
#   recent_activity(since, repo_filter, limit)
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional

from . import tools as _tools
from .state import GraphState

# Shared inputSchema fragment for `repo_filter` across every tool that accepts
# it. Accepts: a single repo slug (legacy), a list of slugs (multi-repo
# scope), or the special string "*" meaning "all repos". When omitted, the
# server falls back to `--default-repo` so per-project MCPs scope to their
# own repo by default — see `state.resolve_repo_filter`.
_REPO_FILTER_SCHEMA = {
    "oneOf": [
        {"type": "string", "description": "Single repo slug, or '*' for all repos."},
        {"type": "array", "items": {"type": "string"}, "description": "List of repo slugs to scope to."},
    ],
    "description": "Default: caller's repo (auto-inferred from --default-repo). Pass '*' or a list to widen.",
}
from .telemetry import debug_level, get_telemetry, verbose_log
from .utils import _filter_blank_stdin


def serve(graphs_dir: Path, group: Optional[str], links_path: Optional[Path], candidates_path: Optional[Path] = None, rejections_path: Optional[Path] = None, default_repo: Optional[str] = None) -> None:
    try:
        from mcp.server import Server
        from mcp.server.stdio import stdio_server
        from mcp import types
    except ImportError as e:
        raise ImportError("mcp not installed. Run: pip install mcp") from e

    state = GraphState(graphs_dir, links_path, candidates_path, rejections_path)
    state.default_repo = default_repo
    state.initial_load()
    if default_repo:
        print(f"default-repo: {default_repo} (omitted repo_filter scopes here; pass '*' for all repos)", file=sys.stderr)
    print(
        f"loaded {len(state.graphs)} repo graphs from {graphs_dir}"
        + (f" (group={group})" if group else "")
        + (f" links={len(state.xrepo_edges.edges())}" if state.xrepo_edges else "")
        + (f" unavailable={sorted(state.unavailable.keys())}" if state.unavailable else ""),
        file=sys.stderr,
    )

    # Telemetry / debug-knob announcement.
    _level = debug_level()
    if _level == 0:
        print("[telemetry] debug=off", file=sys.stderr)
    elif _level == 1:
        print("[telemetry] debug=on (level 1: warnings + summary)", file=sys.stderr)
    else:
        print(f"[telemetry] debug=on (level {_level}: verbose per-call)", file=sys.stderr)

    # Install a SIGUSR1 handler (POSIX only) that dumps the telemetry summary
    # to stderr on demand. Allows `kill -USR1 <pid>` for live introspection.
    try:
        import signal as _signal
        if hasattr(_signal, "SIGUSR1"):
            def _dump(_signum, _frame) -> None:  # noqa: ANN001
                print(get_telemetry().summary(state=state), file=sys.stderr)
            _signal.signal(_signal.SIGUSR1, _dump)
    except (ValueError, OSError):
        # Not the main thread, or platform without signals — skip silently.
        pass

    # On normal shutdown, dump the summary if debug is enabled.
    import atexit as _atexit
    def _atexit_dump() -> None:
        if debug_level() >= 1:
            try:
                print(get_telemetry().summary(state=state), file=sys.stderr)
            except Exception:  # noqa: BLE001
                pass
    _atexit.register(_atexit_dump)

    server_name = f"gfleet-{group}" if group else "gfleet"
    server = Server(server_name)

    @server.list_tools()
    async def list_tools() -> list:  # type: ignore[override]
        return [
            types.Tool(
                name="query_graph",
                description="Search the knowledge graph using BFS or DFS. Scoping defaults to the caller's repo (auto-inferred from --default-repo); pass repo_filter='*' for all repos, or a list to scope to a subset.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "question": {"type": "string", "description": "Natural language question or keyword search"},
                        "mode": {"type": "string", "enum": ["bfs", "dfs"], "default": "bfs"},
                        "depth": {"type": "integer", "default": 3},
                        "token_budget": {"type": "integer", "default": 800},
                        "context_filter": {"type": "array", "items": {"type": "string"}},
                        "repo_filter": _REPO_FILTER_SCHEMA,
                        "full": {"type": "boolean", "default": False, "description": "When true, skip the per-repo summary on cross-repo queries and dump the full result. No-op when scoped to a single repo."},
                    },
                    "required": ["question"],
                },
            ),
            types.Tool(
                name="get_node",
                description="Get full details for a node by label or ID. Searches across all repos unless repo_filter is set.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "repo_filter": _REPO_FILTER_SCHEMA,
                    },
                    "required": ["label"],
                },
            ),
            types.Tool(
                name="get_neighbors",
                description="Direct neighbors of a node, including cross-repo neighbors via the link table.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "relation_filter": {"type": "string"},
                        "repo_filter": _REPO_FILTER_SCHEMA,
                    },
                    "required": ["label"],
                },
            ),
            types.Tool(
                name="get_community",
                description="Get all nodes in a community by community ID. Requires repo_filter (community IDs are per-repo).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "community_id": {"type": "integer"},
                        "repo_filter": {"type": "string"},
                    },
                    "required": ["community_id"],
                },
            ),
            types.Tool(
                name="list_communities",
                description="List community IDs and node counts. Defaults to caller's repo; pass '*' or a list for multi-repo.",
                inputSchema={
                    "type": "object",
                    "properties": {"repo_filter": _REPO_FILTER_SCHEMA},
                },
            ),
            types.Tool(
                name="god_nodes",
                description="Most-connected nodes (per repo if repo_filter, else across the composite).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "top_n": {"type": "integer", "default": 10},
                        "repo_filter": _REPO_FILTER_SCHEMA,
                    },
                },
            ),
            types.Tool(
                name="graph_stats",
                description="Summary stats: nodes, edges, communities. Defaults to caller's repo; pass '*' or a list for multi-repo aggregation.",
                inputSchema={
                    "type": "object",
                    "properties": {"repo_filter": _REPO_FILTER_SCHEMA},
                },
            ),
            types.Tool(
                name="shortest_path",
                description="Shortest path between two concepts. Without repo_filter, the composite (per-repo + cross-repo links) is searched.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "max_hops": {"type": "integer", "default": 8},
                        "repo_filter": _REPO_FILTER_SCHEMA,
                    },
                    "required": ["source", "target"],
                },
            ),
            types.Tool(
                name="list_link_candidates",
                description="List entries from `<group>-link-candidates.json`, filtered by repo/channel/method and sorted by confidence desc then discovered_at asc. Returns {total, shown, candidates}.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "repo_filter": _REPO_FILTER_SCHEMA,
                        "channel": {"type": "string", "description": "Exact channel match (e.g. 'http', 'redis_key')."},
                        "method": {"type": "string", "description": "Exact method match (e.g. 'label_match', 'string')."},
                        "limit": {"type": "integer", "default": 20},
                    },
                },
            ),
            types.Tool(
                name="resolve_link_candidate",
                description="Resolve a candidate by id. `confirm` promotes it to <group>-links.json with method+'+resolved' and confidence 1.0; `reject` moves it to <group>-link-rejections.json so future link passes skip it.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "candidate_id": {"type": "string", "description": "The candidate's id field (sha8 of source→target:method)."},
                        "decision": {"type": "string", "enum": ["confirm", "reject"]},
                        "reason": {"type": "string"},
                        "override_target": {"type": "string", "description": "On confirm, replace the candidate's target with this value before promoting."},
                    },
                    "required": ["candidate_id", "decision"],
                },
            ),
            types.Tool(
                name="get_node_source",
                description="Return the source code surrounding a node's `source_location`. Saves a separate `Read` call when investigating a node. `node_id` may be `<repo>::<local_id>` or unprefixed (errors if ambiguous across repos).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "node_id": {"type": "string", "description": "Node id, optionally prefixed with `<repo>::`."},
                        "context_lines": {"type": "integer", "default": 20, "description": "Lines of context above and below the target line. Clamped to 0..200."},
                    },
                    "required": ["node_id"],
                },
            ),
            types.Tool(
                name="recent_activity",
                description="Return nodes whose `source_file` mtime is at or after a cutoff. `since` accepts a relative duration (`24h`, `7d`, `2w`, `1m`), an ISO 8601 timestamp, or a git ref (resolved per-repo; OLDEST resolved timestamp is used as cutoff).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "since": {"type": "string", "description": "Relative duration, ISO 8601 timestamp, or git ref."},
                        "repo_filter": _REPO_FILTER_SCHEMA,
                        "limit": {"type": "integer", "default": 50},
                    },
                    "required": ["since"],
                },
            ),
            types.Tool(
                name="get_telemetry",
                description="Return a one-shot summary of the gfleet MCP server's runtime telemetry: per-tool call counts and latencies, reload counts, link-table sizes, error tallies, and current graph memory.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            types.Tool(
                name="save_result",
                description="Persist a question/answer pair (and the supporting node IDs) so the agent can refer back to it later. Writes to ~/.graphify/groups/<group>-memory/<timestamp>-<sha8>.json. Returns the absolute path.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "answer": {"type": "string"},
                        "type": {"type": "string", "enum": ["query", "path_query", "explain"], "default": "query"},
                        "nodes": {"type": "array", "items": {"type": "string"}, "default": []},
                        "repo_filter": _REPO_FILTER_SCHEMA,
                    },
                    "required": ["question", "answer"],
                },
            ),
        ]

    _handlers = {
        "query_graph": lambda args: _tools.query_graph(state, args),
        "get_node": lambda args: _tools.get_node(state, args),
        "get_neighbors": lambda args: _tools.get_neighbors(state, args),
        "get_community": lambda args: _tools.get_community(state, args),
        "list_communities": lambda args: _tools.list_communities(state, args),
        "god_nodes": lambda args: _tools.god_nodes(state, args),
        "graph_stats": lambda args: _tools.graph_stats(state, args),
        "shortest_path": lambda args: _tools.shortest_path(state, args),
        "save_result": lambda args: _tools.save_result(state, args, group=group),
        "get_node_source": lambda args: _tools.get_node_source(state, args),
        "recent_activity": lambda args: _tools.recent_activity(state, args),
        "list_link_candidates": lambda args: _tools.list_link_candidates(state, args),
        "resolve_link_candidate": lambda args: _tools.resolve_link_candidate(state, args),
        # Synthetic introspection tool: returns the telemetry summary as text.
        "get_telemetry": lambda args: get_telemetry().summary(state=state),
    }

    import time as _time

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):  # type: ignore[override]
        handler = _handlers.get(name)
        if not handler:
            get_telemetry().incr("error.unknown_tool")
            return [types.TextContent(type="text", text=f"Unknown tool: {name}")]
        tel = get_telemetry()
        tel.incr(f"tool.{name}.calls")
        verbose_log(f"call {name} args={list((arguments or {}).keys())}")
        t0 = _time.monotonic()
        try:
            result = handler(arguments)
            elapsed_ms = (_time.monotonic() - t0) * 1000.0
            tel.record_latency(name, elapsed_ms)
            verbose_log(f"done {name} in {elapsed_ms:.1f}ms")
            return [types.TextContent(type="text", text=result)]
        except Exception as exc:  # noqa: BLE001 — tool errors must not kill the server
            elapsed_ms = (_time.monotonic() - t0) * 1000.0
            tel.record_latency(name, elapsed_ms)
            tel.incr(f"error.{name}.{type(exc).__name__}")
            verbose_log(f"error {name} after {elapsed_ms:.1f}ms: {type(exc).__name__}: {exc}")
            return [types.TextContent(type="text", text=f"Error executing {name}: {exc}")]

    _filter_blank_stdin()

    import asyncio

    async def main() -> None:
        async with stdio_server() as streams:
            await server.run(streams[0], streams[1], server.create_initialization_options())

    asyncio.run(main())


def _resolve_links_path(graphs_dir: Path, group: Optional[str]) -> Optional[Path]:
    """Mirror gfleet's convention: `~/.graphify/groups/<group>-links.json`."""
    if not group:
        return None
    home = Path(os.path.expanduser("~"))
    return home / ".graphify" / "groups" / f"{group}-links.json"


def _resolve_candidates_path(group: Optional[str]) -> Optional[Path]:
    if not group:
        return None
    home = Path(os.path.expanduser("~"))
    return home / ".graphify" / "groups" / f"{group}-link-candidates.json"


def _resolve_rejections_path(group: Optional[str]) -> Optional[Path]:
    if not group:
        return None
    home = Path(os.path.expanduser("~"))
    return home / ".graphify" / "groups" / f"{group}-link-rejections.json"


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="mcp_server", description="gfleet MCP stdio server (per-repo graphs + cross-repo link overlay)")
    p.add_argument("graphs_dir", help="Directory containing per-repo <slug>.json graph files (typically symlinks)")
    p.add_argument("--group", default=None, help="Group tag (used to resolve <group>-links.json)")
    p.add_argument("--default-repo", default=None, help="Caller's repo slug. When set, omitted repo_filter on tool calls scopes to this repo (pass repo_filter='*' to widen).")
    return p.parse_args(argv)


def main_cli(argv: Optional[list[str]] = None) -> None:
    ns = _parse_args(argv if argv is not None else sys.argv[1:])
    graphs_dir = Path(ns.graphs_dir).resolve()
    if not graphs_dir.exists() or not graphs_dir.is_dir():
        print(f"error: graphs_dir not found or not a directory: {graphs_dir}", file=sys.stderr)
        sys.exit(1)
    group = ns.group
    if group is None:
        # Best-effort fallback: <graphs-dir>/.. /<group>/graphs
        parent = graphs_dir.parent
        if parent.name and parent.parent.name == "groups":
            group = parent.name
    links_path = _resolve_links_path(graphs_dir, group)
    candidates_path = _resolve_candidates_path(group)
    rejections_path = _resolve_rejections_path(group)
    serve(graphs_dir, group, links_path, candidates_path, rejections_path, default_repo=ns.default_repo)


if __name__ == "__main__":
    main_cli()

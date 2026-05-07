# gfleet-managed MCP stdio server. Forked from upstream graphify `serve.py`
# (commit referenced in graphify-fleet README) and adapted to a dict-of-graphs
# model: one nx.Graph per registered repo, plus a synthetic cross-repo edge
# overlay loaded from `~/.graphify/groups/<group>-links.json`.
#
# Why fork? The upstream `serve.py` loads a single merged graph file. gfleet
# previously synthesized that merged file with a daemon polling per-repo
# graphs and running `graphify merge-graphs`. The merge does pure
# `nx.compose` of repo-prefixed IDs — zero cross-repo edges — so the merged
# file was N disconnected islands in one container. This server skips the
# merge entirely: it loads each repo graph in memory, prefixes IDs only when
# emitting cross-repo results, and consults the cross-repo edge overlay
# (populated by `src/links.js`) to walk inter-repo edges.
#
# CLI: python -m mcp-server.server <graphs-dir> [--group <tag>]
#
# Tools (same surface as upstream graphify, plus repo_filter on every tool
# that traverses):
#   query_graph(question, mode, depth, token_budget, context_filter, repo_filter)
#   get_node(label, repo_filter)
#   get_neighbors(label, relation_filter, repo_filter)
#   get_community(community_id, repo_filter)
#   god_nodes(top_n, repo_filter)
#   graph_stats(repo_filter)
#   shortest_path(source, target, max_hops, repo_filter)
#
#   list_communities(repo_filter)  — convenience helper, lists community ids per repo
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import unicodedata
from pathlib import Path
from typing import Optional

import networkx as nx
from networkx.readwrite import json_graph


# ----------------------------------------------------------------------------
# graph io
# ----------------------------------------------------------------------------

def _load_one_graph(graph_path: Path) -> Optional[nx.Graph]:
    """Load one repo graph file. Returns None on failure (logged to stderr)."""
    try:
        if not graph_path.exists():
            return None
        data = json.loads(graph_path.read_text(encoding="utf-8"))
        try:
            return json_graph.node_link_graph(data, edges="links")
        except TypeError:
            return json_graph.node_link_graph(data)
    except (ValueError, OSError) as exc:
        print(f"warn: failed to load {graph_path}: {exc}", file=sys.stderr)
        return None
    except json.JSONDecodeError as exc:
        print(f"warn: {graph_path} corrupted ({exc}); skipping", file=sys.stderr)
        return None


def _scan_graphs_dir(graphs_dir: Path) -> list[Path]:
    if not graphs_dir.exists():
        return []
    return sorted(p for p in graphs_dir.glob("*.json"))


# ----------------------------------------------------------------------------
# strings + scoring (preserved verbatim from upstream graphify serve.py)
# ----------------------------------------------------------------------------

_EXACT_MATCH_BONUS = 100.0


def _strip_diacritics(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _sanitize_label(s: str) -> str:
    # Mirrors graphify.security.sanitize_label minimally — collapse whitespace
    # and drop control chars. Avoids importing graphify so the server can run
    # against a graphify env or any python with networkx + mcp.
    if not s:
        return ""
    out = []
    for ch in s:
        if ord(ch) < 32 or ord(ch) == 127:
            continue
        out.append(ch)
    return "".join(out).strip()


def _score_nodes(G: nx.Graph, terms: list[str]) -> list[tuple[float, str]]:
    scored: list[tuple[float, str]] = []
    norm_terms = [_strip_diacritics(t).lower() for t in terms]
    for nid, data in G.nodes(data=True):
        norm_label = data.get("norm_label") or _strip_diacritics(data.get("label") or "").lower()
        source = (data.get("source_file") or "").lower()
        score = sum(1 for t in norm_terms if t in norm_label) + sum(0.5 for t in norm_terms if t in source)
        if any(t == norm_label or t == norm_label.rstrip("()") for t in norm_terms):
            score += _EXACT_MATCH_BONUS
        if score > 0:
            scored.append((score, nid))
    return sorted(scored, reverse=True)


_CONTEXT_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("call", ("call", "calls", "called", "invoke", "invokes", "invoked")),
    ("import", ("import", "imports", "imported", "module", "modules")),
    ("field", ("field", "fields", "member", "members", "property", "properties")),
    ("parameter_type", ("parameter", "parameters", "param", "params", "argument", "arguments")),
    ("return_type", ("return", "returns", "returned")),
    ("generic_arg", ("generic", "generics", "template", "templates")),
)


def _normalize_context_filters(filters: Optional[list[str]]) -> list[str]:
    if not filters:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for value in filters:
        key = _strip_diacritics(str(value)).strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _infer_context_filters(question: str) -> list[str]:
    lowered = {
        _strip_diacritics(token).lower()
        for token in question.replace("?", " ").replace(",", " ").split()
    }
    inferred: list[str] = []
    for context, hints in _CONTEXT_HINTS:
        if any(hint in lowered for hint in hints):
            inferred.append(context)
    return inferred


def _resolve_context_filters(question: str, explicit: Optional[list[str]] = None) -> tuple[list[str], Optional[str]]:
    norm = _normalize_context_filters(explicit)
    if norm:
        return norm, "explicit"
    inferred = _infer_context_filters(question)
    if inferred:
        return inferred, "heuristic"
    return [], None


def _filter_graph_by_context(G: nx.Graph, context_filters: Optional[list[str]]) -> nx.Graph:
    filters = set(_normalize_context_filters(context_filters))
    if not filters:
        return G
    H = G.__class__()
    H.add_nodes_from(G.nodes(data=True))
    if isinstance(G, (nx.MultiGraph, nx.MultiDiGraph)):
        for u, v, key, data in G.edges(keys=True, data=True):
            if data.get("context") in filters:
                H.add_edge(u, v, key=key, **data)
    else:
        for u, v, data in G.edges(data=True):
            if data.get("context") in filters:
                H.add_edge(u, v, **data)
    return H


def _bfs(G: nx.Graph, start_nodes: list[str], depth: int) -> tuple[set[str], list[tuple]]:
    visited: set[str] = set(start_nodes)
    frontier = set(start_nodes)
    edges_seen: list[tuple] = []
    for _ in range(depth):
        next_frontier: set[str] = set()
        for n in frontier:
            if n not in G:
                continue
            for neighbor in G.neighbors(n):
                if neighbor not in visited:
                    next_frontier.add(neighbor)
                    edges_seen.append((n, neighbor))
        visited.update(next_frontier)
        frontier = next_frontier
    return visited, edges_seen


def _dfs(G: nx.Graph, start_nodes: list[str], depth: int) -> tuple[set[str], list[tuple]]:
    visited: set[str] = set()
    edges_seen: list[tuple] = []
    stack = [(n, 0) for n in reversed(start_nodes)]
    while stack:
        node, d = stack.pop()
        if node in visited or d > depth:
            continue
        visited.add(node)
        if node not in G:
            continue
        for neighbor in G.neighbors(node):
            if neighbor not in visited:
                stack.append((neighbor, d + 1))
                edges_seen.append((node, neighbor))
    return visited, edges_seen


def _communities_from_graph(G: nx.Graph) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    for node_id, data in G.nodes(data=True):
        cid = data.get("community")
        if cid is not None:
            try:
                out.setdefault(int(cid), []).append(node_id)
            except (TypeError, ValueError):
                continue
    return out


# ----------------------------------------------------------------------------
# state — a dict of repo graphs + a synthetic cross-repo edge overlay
# ----------------------------------------------------------------------------

class GraphState:
    """Holds per-repo graphs, communities, mtimes, and the cross-repo overlay.

    All mutations happen under a single lock to keep MCP request handling
    safe; reloads are sub-second so the lock contention is negligible.
    """

    def __init__(self, graphs_dir: Path, links_path: Optional[Path]) -> None:
        self.graphs_dir = graphs_dir
        self.links_path = links_path
        self.graphs: dict[str, nx.Graph] = {}
        self.communities: dict[str, dict[int, list[str]]] = {}
        self.mtimes: dict[str, float] = {}
        self.xrepo_edges = nx.Graph()  # nodes use the prefixed-id namespace
        self.links_mtime: float = 0.0
        self._lock = threading.Lock()

    def initial_load(self) -> None:
        with self._lock:
            self._reload_all_graphs()
            self._reload_links()

    # --- graphs ---

    def _reload_all_graphs(self) -> None:
        files = _scan_graphs_dir(self.graphs_dir)
        seen_tags: set[str] = set()
        for f in files:
            tag = f.stem
            seen_tags.add(tag)
            try:
                m = f.stat().st_mtime
            except OSError:
                continue
            if tag in self.graphs and self.mtimes.get(tag) == m:
                continue
            G = _load_one_graph(f)
            if G is None:
                continue
            self.graphs[tag] = G
            self.communities[tag] = _communities_from_graph(G)
            self.mtimes[tag] = m
        # Drop tags that disappeared
        for tag in list(self.graphs.keys()):
            if tag not in seen_tags:
                self.graphs.pop(tag, None)
                self.communities.pop(tag, None)
                self.mtimes.pop(tag, None)

    def _reload_one_if_stale(self, tag: str, path: Path) -> None:
        try:
            m = path.stat().st_mtime
        except OSError:
            return
        if self.mtimes.get(tag) == m:
            return
        G = _load_one_graph(path)
        if G is None:
            return
        self.graphs[tag] = G
        self.communities[tag] = _communities_from_graph(G)
        self.mtimes[tag] = m

    def refresh_if_stale(self) -> None:
        """Stat each graph file + the links file; reload only what changed."""
        with self._lock:
            files = _scan_graphs_dir(self.graphs_dir)
            seen: set[str] = set()
            for f in files:
                tag = f.stem
                seen.add(tag)
                if tag not in self.graphs:
                    G = _load_one_graph(f)
                    if G is not None:
                        try:
                            self.mtimes[tag] = f.stat().st_mtime
                        except OSError:
                            self.mtimes[tag] = 0.0
                        self.graphs[tag] = G
                        self.communities[tag] = _communities_from_graph(G)
                else:
                    self._reload_one_if_stale(tag, f)
            # purge removed
            for tag in list(self.graphs.keys()):
                if tag not in seen:
                    self.graphs.pop(tag, None)
                    self.communities.pop(tag, None)
                    self.mtimes.pop(tag, None)
            # links
            self._reload_links()

    # --- links / cross-repo overlay ---

    def _reload_links(self) -> None:
        if not self.links_path:
            return
        try:
            m = self.links_path.stat().st_mtime
        except OSError:
            # File missing: keep whatever overlay we had (caller may delete it
            # explicitly via empty links); a new pass will recreate it.
            if self.links_mtime != 0.0:
                self.xrepo_edges = nx.Graph()
                self.links_mtime = 0.0
            return
        if m == self.links_mtime:
            return
        try:
            data = json.loads(self.links_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"warn: links file unreadable ({exc})", file=sys.stderr)
            return
        H = nx.Graph()
        for link in data.get("links", []) or []:
            src = link.get("source")
            tgt = link.get("target")
            if not src or not tgt:
                continue
            # Skip silently if either endpoint is missing in current graphs.
            if not self._has_prefixed_node(src) or not self._has_prefixed_node(tgt):
                continue
            H.add_edge(
                src,
                tgt,
                relation=link.get("relation", "links"),
                method=link.get("method", "unknown"),
                confidence=link.get("confidence", 1.0),
                channel=link.get("channel"),
                identifier=link.get("identifier"),
            )
        self.xrepo_edges = H
        self.links_mtime = m

    def _has_prefixed_node(self, prefixed_id: str) -> bool:
        if "::" not in prefixed_id:
            return False
        repo, local = prefixed_id.split("::", 1)
        G = self.graphs.get(repo)
        return G is not None and local in G

    # --- helpers for cross-repo composite views ---

    def composite_view(self) -> nx.Graph:
        """Return a single graph that prefixes every per-repo node ID with
        `<tag>::` and overlays the cross-repo edges. Computed on demand; with
        typical fleet sizes (handful of repos) this is fast enough per call.
        Callers are expected to be the multi-repo (no `repo_filter`) path.
        """
        H = nx.Graph()
        for tag, G in self.graphs.items():
            for nid, data in G.nodes(data=True):
                full_id = f"{tag}::{nid}"
                d = dict(data)
                d.setdefault("repo", tag)
                d.setdefault("local_id", nid)
                H.add_node(full_id, **d)
            if isinstance(G, (nx.MultiGraph, nx.MultiDiGraph)):
                for u, v, _key, data in G.edges(keys=True, data=True):
                    H.add_edge(f"{tag}::{u}", f"{tag}::{v}", **data)
            else:
                for u, v, data in G.edges(data=True):
                    H.add_edge(f"{tag}::{u}", f"{tag}::{v}", **data)
        for u, v, data in self.xrepo_edges.edges(data=True):
            if u in H and v in H:
                H.add_edge(u, v, **data)
        return H


# ----------------------------------------------------------------------------
# render
# ----------------------------------------------------------------------------

def _subgraph_to_text(G: nx.Graph, nodes: set[str], edges: list[tuple], token_budget: int = 2000, *, seeds: Optional[list[str]] = None) -> str:
    char_budget = token_budget * 3
    lines: list[str] = []
    seed_set = set(seeds or [])
    ordered = [n for n in (seeds or []) if n in nodes] + sorted(
        nodes - seed_set, key=lambda n: G.degree(n) if n in G else 0, reverse=True
    )
    for nid in ordered:
        if nid not in G:
            continue
        d = G.nodes[nid]
        line = (
            f"NODE {_sanitize_label(d.get('label', nid))} "
            f"[src={d.get('source_file', '')} loc={d.get('source_location', '')} "
            f"community={d.get('community', '')} repo={d.get('repo', '')}]"
        )
        lines.append(line)
    for u, v in edges:
        if u in nodes and v in nodes and G.has_edge(u, v):
            raw = G[u][v]
            d = next(iter(raw.values()), {}) if isinstance(G, (nx.MultiGraph, nx.MultiDiGraph)) else raw
            context = d.get("context")
            context_suffix = f" context={context}" if context else ""
            method = d.get("method")
            method_suffix = f" method={method}" if method else ""
            line = (
                f"EDGE {_sanitize_label(G.nodes[u].get('label', u))} "
                f"--{d.get('relation', '')} [{d.get('confidence', '')}{context_suffix}{method_suffix}]--> "
                f"{_sanitize_label(G.nodes[v].get('label', v))}"
            )
            lines.append(line)
    output = "\n".join(lines)
    if len(output) > char_budget:
        output = output[:char_budget] + f"\n... (truncated to ~{token_budget} token budget)"
    return output


# ----------------------------------------------------------------------------
# server
# ----------------------------------------------------------------------------

def serve(graphs_dir: Path, group: Optional[str], links_path: Optional[Path]) -> None:
    try:
        from mcp.server import Server
        from mcp.server.stdio import stdio_server
        from mcp import types
    except ImportError as e:
        raise ImportError("mcp not installed. Run: pip install mcp") from e

    state = GraphState(graphs_dir, links_path)
    state.initial_load()
    print(
        f"loaded {len(state.graphs)} repo graphs from {graphs_dir}"
        + (f" (group={group})" if group else "")
        + (f" links={len(state.xrepo_edges.edges())}" if state.xrepo_edges else ""),
        file=sys.stderr,
    )

    server_name = f"gfleet-{group}" if group else "gfleet"
    server = Server(server_name)

    # ----- tool list -----
    @server.list_tools()
    async def list_tools() -> list:  # type: ignore[override]
        return [
            types.Tool(
                name="query_graph",
                description="Search the knowledge graph using BFS or DFS. With repo_filter, scopes to one repo's local graph; without, walks the cross-repo composite (per-repo graphs joined by link-table edges).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "question": {"type": "string", "description": "Natural language question or keyword search"},
                        "mode": {"type": "string", "enum": ["bfs", "dfs"], "default": "bfs"},
                        "depth": {"type": "integer", "default": 3},
                        "token_budget": {"type": "integer", "default": 2000},
                        "context_filter": {"type": "array", "items": {"type": "string"}},
                        "repo_filter": {"type": "string", "description": "Restrict to a single repo's graph (matches the graph file stem in graphs-dir)."},
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
                        "repo_filter": {"type": "string"},
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
                        "repo_filter": {"type": "string"},
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
                description="List community IDs and node counts. With repo_filter, scopes to one repo.",
                inputSchema={
                    "type": "object",
                    "properties": {"repo_filter": {"type": "string"}},
                },
            ),
            types.Tool(
                name="god_nodes",
                description="Most-connected nodes (per repo if repo_filter, else across the composite).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "top_n": {"type": "integer", "default": 10},
                        "repo_filter": {"type": "string"},
                    },
                },
            ),
            types.Tool(
                name="graph_stats",
                description="Summary stats: nodes, edges, communities. Aggregated across all repos unless repo_filter is set.",
                inputSchema={
                    "type": "object",
                    "properties": {"repo_filter": {"type": "string"}},
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
                        "repo_filter": {"type": "string"},
                    },
                    "required": ["source", "target"],
                },
            ),
        ]

    # ----- helpers shared by handlers -----
    def _pick_graph(repo_filter: Optional[str]) -> tuple[nx.Graph, bool]:
        """Return (graph, is_composite). When repo_filter is set, returns the
        per-repo graph (raw IDs). When unset, returns the composite view with
        prefixed IDs and cross-repo edges overlaid.
        """
        if repo_filter:
            G = state.graphs.get(repo_filter)
            if G is None:
                return nx.Graph(), False
            return G, False
        return state.composite_view(), True

    def _find_node(G: nx.Graph, label: str) -> list[str]:
        term = _strip_diacritics(label).lower()
        return [
            nid
            for nid, d in G.nodes(data=True)
            if term in (d.get("norm_label") or _strip_diacritics(d.get("label") or "").lower())
            or term == nid.lower()
        ]

    # ----- handlers -----
    def _tool_query_graph(arguments: dict) -> str:
        state.refresh_if_stale()
        question = arguments["question"]
        mode = arguments.get("mode", "bfs")
        depth = min(int(arguments.get("depth", 3)), 6)
        budget = int(arguments.get("token_budget", 2000))
        context_filter = arguments.get("context_filter")
        repo_filter = arguments.get("repo_filter")

        G, _composite = _pick_graph(repo_filter)
        if G.number_of_nodes() == 0:
            if repo_filter:
                return f"No graph loaded for repo_filter='{repo_filter}'. Available: {sorted(state.graphs.keys())}"
            return "No graphs loaded."

        terms = [t.lower() for t in question.split() if len(t) > 2]
        scored = _score_nodes(G, terms)
        start_nodes = [nid for _, nid in scored[:3]]
        if not start_nodes:
            return "No matching nodes found."
        resolved, source = _resolve_context_filters(question, context_filter)
        traversal = _filter_graph_by_context(G, resolved)
        nodes, edges = (
            _dfs(traversal, start_nodes, depth) if mode == "dfs" else _bfs(traversal, start_nodes, depth)
        )
        header = (
            f"Traversal: {mode.upper()} depth={depth} "
            f"| Start: {[G.nodes[n].get('label', n) for n in start_nodes]} "
        )
        if resolved:
            header += f"| Context: {', '.join(resolved)} ({source}) "
        header += f"| {len(nodes)} nodes\n\n"
        return header + _subgraph_to_text(traversal, nodes, edges, budget, seeds=start_nodes)

    def _tool_get_node(arguments: dict) -> str:
        state.refresh_if_stale()
        label = arguments["label"]
        repo_filter = arguments.get("repo_filter")
        term = label.lower()
        matches: list[tuple[str, str, dict]] = []  # (repo, nid, data)
        if repo_filter:
            G = state.graphs.get(repo_filter)
            if G is None:
                return f"No graph loaded for repo_filter='{repo_filter}'."
            for nid, d in G.nodes(data=True):
                if term in (d.get("label") or "").lower() or term == nid.lower():
                    matches.append((repo_filter, nid, d))
        else:
            for tag, G in state.graphs.items():
                for nid, d in G.nodes(data=True):
                    if term in (d.get("label") or "").lower() or term == nid.lower():
                        matches.append((tag, nid, d))
        if not matches:
            return f"No node matching '{label}' found."
        if len(matches) > 1:
            head = [f"Found {len(matches)} matches across repos:"]
            for tag, nid, d in matches[:25]:
                head.append(f"  [{tag}] {d.get('label', nid)}  (id={nid})")
            return "\n".join(head)
        tag, nid, d = matches[0]
        G = state.graphs[tag]
        return "\n".join(
            [
                f"Node: {d.get('label', nid)}",
                f"  ID: {tag}::{nid}",
                f"  Repo: {tag}",
                f"  Source: {d.get('source_file', '')} {d.get('source_location', '')}",
                f"  Type: {d.get('file_type', '')}",
                f"  Community: {d.get('community', '')}",
                f"  Degree: {G.degree(nid)}",
            ]
        )

    def _tool_get_neighbors(arguments: dict) -> str:
        state.refresh_if_stale()
        label = arguments["label"]
        rel_filter = (arguments.get("relation_filter") or "").lower()
        repo_filter = arguments.get("repo_filter")
        if repo_filter:
            G = state.graphs.get(repo_filter)
            if G is None:
                return f"No graph loaded for repo_filter='{repo_filter}'."
            matches = _find_node(G, label)
            if not matches:
                return f"No node matching '{label}' found in {repo_filter}."
            nid = matches[0]
            lines = [f"Neighbors of {G.nodes[nid].get('label', nid)} (in {repo_filter}):"]
            for neighbor in G.neighbors(nid):
                d = G.edges[nid, neighbor]
                rel = d.get("relation", "")
                if rel_filter and rel_filter not in rel.lower():
                    continue
                lines.append(
                    f"  --> {G.nodes[neighbor].get('label', neighbor)} [{rel}] [{d.get('confidence', '')}]"
                )
            return "\n".join(lines)
        # composite path: search across repos, plus cross-repo edges
        G = state.composite_view()
        matches = _find_node(G, label)
        if not matches:
            return f"No node matching '{label}' found across {len(state.graphs)} repos."
        nid = matches[0]
        lines = [f"Neighbors of {G.nodes[nid].get('label', nid)} ({nid}):"]
        for neighbor in G.neighbors(nid):
            d = G.edges[nid, neighbor]
            rel = d.get("relation", "")
            if rel_filter and rel_filter not in rel.lower():
                continue
            method = d.get("method")
            tag = f" via {method}" if method else ""
            lines.append(
                f"  --> {G.nodes[neighbor].get('label', neighbor)} ({neighbor}) [{rel}{tag}] [{d.get('confidence', '')}]"
            )
        return "\n".join(lines)

    def _tool_get_community(arguments: dict) -> str:
        state.refresh_if_stale()
        cid = int(arguments["community_id"])
        repo_filter = arguments.get("repo_filter")
        if not repo_filter:
            return "get_community requires repo_filter — community IDs are per-repo."
        comms = state.communities.get(repo_filter, {})
        nodes = comms.get(cid, [])
        if not nodes:
            return f"Community {cid} not found in repo '{repo_filter}'."
        G = state.graphs.get(repo_filter)
        lines = [f"Community {cid} in {repo_filter} ({len(nodes)} nodes):"]
        for n in nodes:
            d = G.nodes[n] if G is not None and n in G else {}
            lines.append(f"  {d.get('label', n)} [{d.get('source_file', '')}]")
        return "\n".join(lines)

    def _tool_list_communities(arguments: dict) -> str:
        state.refresh_if_stale()
        repo_filter = arguments.get("repo_filter")
        if repo_filter:
            comms = state.communities.get(repo_filter, {})
            if not comms:
                return f"No communities for repo '{repo_filter}'."
            lines = [f"Communities in {repo_filter}:"]
            for cid, members in sorted(comms.items(), key=lambda kv: -len(kv[1])):
                lines.append(f"  {cid}: {len(members)} nodes")
            return "\n".join(lines)
        lines = ["Communities (per repo):"]
        for tag in sorted(state.communities.keys()):
            comms = state.communities[tag]
            lines.append(f"  [{tag}] {len(comms)} communities")
        return "\n".join(lines)

    def _tool_god_nodes(arguments: dict) -> str:
        state.refresh_if_stale()
        top_n = int(arguments.get("top_n", 10))
        repo_filter = arguments.get("repo_filter")
        G, _composite = _pick_graph(repo_filter)
        if G.number_of_nodes() == 0:
            return "No graph available."
        ranked = sorted(G.nodes(data=True), key=lambda nd: G.degree(nd[0]), reverse=True)[:top_n]
        lines = ["God nodes (most connected):"]
        for i, (nid, d) in enumerate(ranked, 1):
            lines.append(f"  {i}. {d.get('label', nid)} - {G.degree(nid)} edges  ({nid})")
        return "\n".join(lines)

    def _tool_graph_stats(arguments: dict) -> str:
        state.refresh_if_stale()
        repo_filter = arguments.get("repo_filter")
        if repo_filter:
            G = state.graphs.get(repo_filter)
            if G is None:
                return f"No graph for '{repo_filter}'."
            comms = state.communities.get(repo_filter, {})
            return (
                f"Repo: {repo_filter}\n"
                f"Nodes: {G.number_of_nodes()}\n"
                f"Edges: {G.number_of_edges()}\n"
                f"Communities: {len(comms)}\n"
            )
        total_nodes = sum(g.number_of_nodes() for g in state.graphs.values())
        total_edges = sum(g.number_of_edges() for g in state.graphs.values())
        return (
            f"Repos loaded: {len(state.graphs)}\n"
            f"Nodes (sum): {total_nodes}\n"
            f"Edges (sum, excluding cross-repo): {total_edges}\n"
            f"Cross-repo links: {state.xrepo_edges.number_of_edges()}\n"
        )

    def _tool_shortest_path(arguments: dict) -> str:
        state.refresh_if_stale()
        repo_filter = arguments.get("repo_filter")
        max_hops = int(arguments.get("max_hops", 8))
        G, composite = _pick_graph(repo_filter)
        if G.number_of_nodes() == 0:
            return "No graph available."
        src_scored = _score_nodes(G, [t.lower() for t in arguments["source"].split()])
        tgt_scored = _score_nodes(G, [t.lower() for t in arguments["target"].split()])
        if not src_scored:
            return f"No node matching source '{arguments['source']}' found."
        if not tgt_scored:
            return f"No node matching target '{arguments['target']}' found."
        src_nid, tgt_nid = src_scored[0][1], tgt_scored[0][1]
        try:
            path_nodes = nx.shortest_path(G, src_nid, tgt_nid)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            hint = (
                " (cross-repo paths require entries in the link table; see `<group>-links.json`)"
                if composite
                else ""
            )
            return f"No path between '{src_nid}' and '{tgt_nid}'.{hint}"
        hops = len(path_nodes) - 1
        if hops > max_hops:
            return f"Path exceeds max_hops={max_hops} ({hops} hops found)."
        segments = []
        for i in range(len(path_nodes) - 1):
            u, v = path_nodes[i], path_nodes[i + 1]
            edata = G.edges[u, v]
            rel = edata.get("relation", "")
            conf = edata.get("confidence", "")
            method = edata.get("method")
            tag = f" via {method}" if method else ""
            conf_str = f" [{conf}]" if conf else ""
            if i == 0:
                segments.append(G.nodes[u].get("label", u))
            segments.append(f"--{rel}{tag}{conf_str}--> {G.nodes[v].get('label', v)}")
        return f"Shortest path ({hops} hops):\n  " + " ".join(segments)

    _handlers = {
        "query_graph": _tool_query_graph,
        "get_node": _tool_get_node,
        "get_neighbors": _tool_get_neighbors,
        "get_community": _tool_get_community,
        "list_communities": _tool_list_communities,
        "god_nodes": _tool_god_nodes,
        "graph_stats": _tool_graph_stats,
        "shortest_path": _tool_shortest_path,
    }

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):  # type: ignore[override]
        handler = _handlers.get(name)
        if not handler:
            return [types.TextContent(type="text", text=f"Unknown tool: {name}")]
        try:
            return [types.TextContent(type="text", text=handler(arguments))]
        except Exception as exc:  # noqa: BLE001 — tool errors must not kill the server
            return [types.TextContent(type="text", text=f"Error executing {name}: {exc}")]

    # Filter blank lines from stdin (preserved verbatim from upstream serve.py
    # — Claude Desktop and some other MCP clients send bare newlines that
    # otherwise blow up Pydantic JSONRPC parsing).
    _filter_blank_stdin()

    import asyncio

    async def main() -> None:
        async with stdio_server() as streams:
            await server.run(streams[0], streams[1], server.create_initialization_options())

    asyncio.run(main())


def _filter_blank_stdin() -> None:
    r_fd, w_fd = os.pipe()
    saved_fd = os.dup(sys.stdin.fileno())

    def _relay() -> None:
        try:
            with open(saved_fd, "rb") as src, open(w_fd, "wb") as dst:
                for line in src:
                    if line.strip():
                        dst.write(line)
                        dst.flush()
        except Exception:
            pass

    threading.Thread(target=_relay, daemon=True).start()
    os.dup2(r_fd, sys.stdin.fileno())
    os.close(r_fd)
    sys.stdin = open(0, "r", closefd=False)


def _resolve_links_path(graphs_dir: Path, group: Optional[str]) -> Optional[Path]:
    """Mirror gfleet's convention: `~/.graphify/groups/<group>-links.json`."""
    if not group:
        return None
    home = Path(os.path.expanduser("~"))
    return home / ".graphify" / "groups" / f"{group}-links.json"


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="mcp-server", description="gfleet MCP stdio server (per-repo graphs + cross-repo link overlay)")
    p.add_argument("graphs_dir", help="Directory containing per-repo <slug>.json graph files (typically symlinks)")
    p.add_argument("--group", default=None, help="Group tag (used to resolve <group>-links.json)")
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
    serve(graphs_dir, group, links_path)


if __name__ == "__main__":
    main_cli()

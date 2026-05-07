# Tool handler implementations. Each `_tool_*` function takes the parsed
# `arguments` dict and the shared `GraphState`, and returns a string that
# server.py wraps in TextContent.
#
# Tier A item 1 — `save_result`: persists Q/A pairs the agent wants to recall
# later. File format documented inline below.
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Optional

import networkx as nx

from .context_filter import _filter_graph_by_context, _resolve_context_filters
from .scoring import _score_nodes, _strip_diacritics
from .state import GraphState
from .traversal import _bfs, _dfs
from .utils import _sanitize_label


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def _pick_graph(state: GraphState, repo_filter: Optional[str]) -> tuple[nx.Graph, bool]:
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


def _unavailable_response(repo: str, reason: str) -> str:
    """Structured warning shape returned when a tool is invoked against a
    repo that failed to load. Matches the spec: a JSON line so callers can
    parse it programmatically alongside the human-readable text.
    """
    payload = {"warning": f"repo {repo} unavailable: {reason}", "results": []}
    return json.dumps(payload)


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


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def query_graph(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    question = arguments["question"]
    mode = arguments.get("mode", "bfs")
    depth = min(int(arguments.get("depth", 3)), 6)
    budget = int(arguments.get("token_budget", 2000))
    context_filter = arguments.get("context_filter")
    repo_filter = arguments.get("repo_filter")

    if repo_filter:
        reason = state.is_unavailable(repo_filter)
        if reason:
            return _unavailable_response(repo_filter, reason)

    G, _composite = _pick_graph(state, repo_filter)
    if G.number_of_nodes() == 0:
        if repo_filter:
            return f"No graph loaded for repo_filter='{repo_filter}'. Available: {state.available_repos()}"
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


def get_node(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    label = arguments["label"]
    repo_filter = arguments.get("repo_filter")
    if repo_filter:
        reason = state.is_unavailable(repo_filter)
        if reason:
            return _unavailable_response(repo_filter, reason)

    # Tier A item 2: consult the LabelIndex first for an O(1) hit.
    matches: list[tuple[str, str, dict]] = []
    index_hits = state.label_index.lookup_substring(label)
    for repo, nid, _orig in index_hits:
        if repo_filter and repo != repo_filter:
            continue
        if state.is_unavailable(repo):
            continue
        G = state.graphs.get(repo)
        if G is None or nid not in G:
            continue
        matches.append((repo, nid, G.nodes[nid]))

    # Fallback: legacy substring scan over (label) + (id) for the rare cases
    # where label scoring picks up something the index missed. Skipped if the
    # index already hit — keeps the fast path fast.
    if not matches:
        term = label.lower()
        scope = [repo_filter] if repo_filter else state.available_repos()
        for tag in scope:
            G = state.graphs.get(tag)
            if G is None:
                continue
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


def get_neighbors(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    label = arguments["label"]
    rel_filter = (arguments.get("relation_filter") or "").lower()
    repo_filter = arguments.get("repo_filter")
    if repo_filter:
        reason = state.is_unavailable(repo_filter)
        if reason:
            return _unavailable_response(repo_filter, reason)
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


def get_community(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    cid = int(arguments["community_id"])
    repo_filter = arguments.get("repo_filter")
    if not repo_filter:
        return "get_community requires repo_filter — community IDs are per-repo."
    reason = state.is_unavailable(repo_filter)
    if reason:
        return _unavailable_response(repo_filter, reason)
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


def list_communities(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    repo_filter = arguments.get("repo_filter")
    if repo_filter:
        reason = state.is_unavailable(repo_filter)
        if reason:
            return _unavailable_response(repo_filter, reason)
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
    if state.unavailable:
        for tag in sorted(state.unavailable):
            lines.append(f"  [{tag}] unavailable: {state.unavailable[tag]}")
    return "\n".join(lines)


def god_nodes(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    top_n = int(arguments.get("top_n", 10))
    repo_filter = arguments.get("repo_filter")
    if repo_filter:
        reason = state.is_unavailable(repo_filter)
        if reason:
            return _unavailable_response(repo_filter, reason)
    G, _composite = _pick_graph(state, repo_filter)
    if G.number_of_nodes() == 0:
        return "No graph available."
    ranked = sorted(G.nodes(data=True), key=lambda nd: G.degree(nd[0]), reverse=True)[:top_n]
    lines = ["God nodes (most connected):"]
    for i, (nid, d) in enumerate(ranked, 1):
        lines.append(f"  {i}. {d.get('label', nid)} - {G.degree(nid)} edges  ({nid})")
    return "\n".join(lines)


def graph_stats(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    repo_filter = arguments.get("repo_filter")
    if repo_filter:
        reason = state.is_unavailable(repo_filter)
        if reason:
            return _unavailable_response(repo_filter, reason)
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
    out = (
        f"Repos loaded: {len(state.graphs)}\n"
        f"Nodes (sum): {total_nodes}\n"
        f"Edges (sum, excluding cross-repo): {total_edges}\n"
        f"Cross-repo links: {state.xrepo_edges.number_of_edges()}\n"
    )
    if state.unavailable:
        out += f"Unavailable repos: {sorted(state.unavailable.keys())}\n"
    return out


def shortest_path(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    repo_filter = arguments.get("repo_filter")
    if repo_filter:
        reason = state.is_unavailable(repo_filter)
        if reason:
            return _unavailable_response(repo_filter, reason)
    max_hops = int(arguments.get("max_hops", 8))
    G, composite = _pick_graph(state, repo_filter)
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


# ---------------------------------------------------------------------------
# Tier A item 1 — save_result
# ---------------------------------------------------------------------------

_VALID_SAVE_TYPES = ("query", "path_query", "explain")
_SAFE_GROUP_RE = re.compile(r"[^A-Za-z0-9_.-]")


def _memory_dir(group: Optional[str]) -> Path:
    home = Path(os.path.expanduser("~"))
    if group:
        safe = _SAFE_GROUP_RE.sub("_", group)
        leaf = f"{safe}-memory"
    else:
        leaf = "default-memory"
    return home / ".graphify" / "groups" / leaf


def save_result(state: GraphState, arguments: dict, *, group: Optional[str]) -> str:
    """Persist a Q/A pair to ~/.graphify/groups/<group>-memory/.

    Returns a JSON line: {"saved_at": "...", "memory_path": "..."}.
    """
    question = str(arguments.get("question") or "").strip()
    answer = str(arguments.get("answer") or "").strip()
    qtype = str(arguments.get("type") or "query").strip().lower()
    nodes = arguments.get("nodes") or []
    repo_filter = arguments.get("repo_filter")
    if not question:
        return json.dumps({"error": "save_result: 'question' is required"})
    if not answer:
        return json.dumps({"error": "save_result: 'answer' is required"})
    if qtype not in _VALID_SAVE_TYPES:
        return json.dumps({"error": f"save_result: 'type' must be one of {list(_VALID_SAVE_TYPES)}"})
    if not isinstance(nodes, list) or not all(isinstance(n, str) for n in nodes):
        return json.dumps({"error": "save_result: 'nodes' must be a list of strings"})

    saved_at = _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    timestamp_safe = saved_at.replace(":", "-")
    digest = hashlib.sha1(
        f"{saved_at}|{question}|{answer}".encode("utf-8")
    ).hexdigest()[:8]

    out_dir = _memory_dir(group)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{timestamp_safe}-{digest}.json"

    payload = {
        "version": 1,
        "saved_at": saved_at,
        "type": qtype,
        "question": question,
        "answer": answer,
        "nodes": nodes,
        "repo_filter": repo_filter,
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return json.dumps({"saved_at": saved_at, "memory_path": str(out_path)})

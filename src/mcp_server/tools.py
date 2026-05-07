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
import subprocess
from pathlib import Path
from typing import Optional

import networkx as nx

from .context_filter import _filter_graph_by_context, _resolve_context_filters
from .links_loader import (
    derive_candidate_id,
    load_candidates_file,
    load_links_file,
    load_rejections_file,
    write_json_atomic,
)
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


# ---------------------------------------------------------------------------
# Link candidate review tools (list_link_candidates / resolve_link_candidate)
# ---------------------------------------------------------------------------

def _matches_repo_filter(prefixed: str, repo_filter: str) -> bool:
    """`<repo>::...` prefix match on either source or target."""
    if not isinstance(prefixed, str) or "::" not in prefixed:
        return False
    return prefixed.split("::", 1)[0] == repo_filter


def list_link_candidates(state: GraphState, arguments: dict) -> str:
    """Return filtered + sorted candidates from `<group>-link-candidates.json`."""
    state.refresh_if_stale()
    repo_filter = arguments.get("repo_filter")
    channel = arguments.get("channel")
    method = arguments.get("method")
    limit = int(arguments.get("limit", 20))

    path = state.candidates_path
    if path is None or not path.exists():
        return json.dumps({"total": 0, "shown": 0, "candidates": []})

    _version, entries = load_candidates_file(path)
    filtered: list[dict] = []
    for entry in entries:
        if repo_filter and not (
            _matches_repo_filter(entry.get("source", ""), repo_filter)
            or _matches_repo_filter(entry.get("target", ""), repo_filter)
        ):
            continue
        if channel is not None and entry.get("channel") != channel:
            continue
        if method is not None and entry.get("method") != method:
            continue
        filtered.append(entry)

    # Sort: confidence desc, then discovered_at asc (older first as tiebreak).
    filtered.sort(key=lambda e: (-(e.get("confidence") or 0.0), e.get("discovered_at") or ""))
    total = len(filtered)
    shown = filtered[: max(0, limit)]
    return json.dumps({"total": total, "shown": len(shown), "candidates": shown})


def _now_iso() -> str:
    return _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def resolve_link_candidate(state: GraphState, arguments: dict) -> str:
    """Confirm or reject a candidate. Persists to disk atomically."""
    state.refresh_if_stale()
    candidate_id = str(arguments.get("candidate_id") or "").strip()
    decision = str(arguments.get("decision") or "").strip().lower()
    reason = arguments.get("reason")
    override_target = arguments.get("override_target")

    if not candidate_id:
        return json.dumps({"error": "resolve_link_candidate: 'candidate_id' is required"})
    if decision not in ("confirm", "reject"):
        return json.dumps({"error": "resolve_link_candidate: 'decision' must be 'confirm' or 'reject'"})

    cand_path = state.candidates_path
    links_path = state.links_path
    rej_path = state.rejections_path
    if cand_path is None:
        return json.dumps({"error": "resolve_link_candidate: candidates path not configured (run with --group)"})

    _cv, candidates = load_candidates_file(cand_path) if cand_path.exists() else (None, [])

    target_idx = next(
        (i for i, c in enumerate(candidates) if c.get("id") == candidate_id),
        None,
    )
    if target_idx is None:
        return json.dumps({"error": "candidate not found", "candidate_id": candidate_id})

    candidate = candidates.pop(target_idx)
    resolution = {
        "by": "agent",
        "at": _now_iso(),
        "reason": reason,
    }

    if decision == "confirm":
        if links_path is None:
            return json.dumps({"error": "resolve_link_candidate: links path not configured"})
        if isinstance(override_target, str) and override_target:
            candidate["target"] = override_target
        original_method = candidate.get("method") or ""
        if not original_method.endswith("+resolved"):
            candidate["method"] = f"{original_method}+resolved"
        candidate["confidence"] = 1.0
        candidate["resolution"] = resolution
        # Recompute id since target/method may have changed.
        candidate["id"] = derive_candidate_id(
            candidate["source"], candidate["target"], candidate["method"]
        )

        _lv, existing_links = load_links_file(links_path) if links_path.exists() else (None, [])
        existing_links.append(candidate)
        write_json_atomic(links_path, {"version": 1, "links": existing_links})
        write_json_atomic(cand_path, {"version": 1, "candidates": candidates})
        return json.dumps({
            "resolved": True,
            "candidate_id": candidate_id,
            "decision": "confirm",
            "moved_to": "links",
        })

    # decision == "reject"
    if rej_path is None:
        return json.dumps({"error": "resolve_link_candidate: rejections path not configured"})
    candidate["resolution"] = resolution
    _rv, existing_rej = load_rejections_file(rej_path) if rej_path.exists() else (None, [])
    existing_rej.append(candidate)
    write_json_atomic(rej_path, {"version": 1, "rejections": existing_rej})
    write_json_atomic(cand_path, {"version": 1, "candidates": candidates})
    return json.dumps({
        "resolved": True,
        "candidate_id": candidate_id,
        "decision": "reject",
        "moved_to": "rejections",
    })


# ---------------------------------------------------------------------------
# get_node_source — return source code surrounding a node's location
# ---------------------------------------------------------------------------

_LANGUAGE_BY_EXT = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".go": "go",
    ".rb": "ruby",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rs": "rust",
    ".c": "c",
    ".h": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".php": "php",
    ".scala": "scala",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".md": "markdown",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".json": "json",
    ".toml": "toml",
}

_GET_NODE_SOURCE_MAX_CONTEXT = 200
_GET_NODE_SOURCE_MAX_FILE_BYTES = 10 * 1024 * 1024


def _detect_language(path: str) -> str:
    ext = Path(path).suffix.lower()
    return _LANGUAGE_BY_EXT.get(ext, "text")


def _parse_source_location(loc: str) -> Optional[int]:
    """`source_location` is typically `"L<line>"` (e.g. `"L142"`)."""
    if not loc:
        return None
    m = re.match(r"^L(\d+)", loc.strip())
    if not m:
        # Plain integer also accepted.
        if loc.strip().isdigit():
            return int(loc.strip())
        return None
    return int(m.group(1))


def _repo_root_for(state: GraphState, repo: str) -> Optional[Path]:
    """Best-effort: each graph file is `<repo-root>/graphify-out/graph.json`
    (typically symlinked into the gfleet `graphs_dir`). Resolve the symlink
    and walk up two levels to find the repo root.
    """
    graph_path = state.graphs_dir / f"{repo}.json"
    try:
        real = graph_path.resolve()
    except OSError:
        return None
    if real.parent.name == "graphify-out":
        return real.parent.parent
    return None


def _resolve_source_path(state: GraphState, repo: str, source_file: str) -> Path:
    p = Path(source_file)
    if p.is_absolute():
        return p
    root = _repo_root_for(state, repo)
    if root is not None:
        return (root / source_file).resolve()
    return p


def _resolve_node_id(state: GraphState, node_id: str) -> tuple[Optional[str], Optional[str], Optional[dict]]:
    """Return (repo, local_id, error_message). Either (repo, local_id, None)
    on success, or (None, None, error) on failure."""
    if "::" in node_id:
        repo, local = node_id.split("::", 1)
        G = state.graphs.get(repo)
        if G is None or local not in G:
            return None, None, "node not found"
        return repo, local, None
    # Unprefixed: search across all repos for an exact node-id match.
    matches: list[tuple[str, str]] = []
    for repo, G in state.graphs.items():
        if node_id in G:
            matches.append((repo, node_id))
    if not matches:
        return None, None, "node not found"
    if len(matches) > 1:
        return None, None, "ambiguous node_id (require <repo>::<id> prefix)"
    repo, local = matches[0]
    return repo, local, None


def get_node_source(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    node_id = str(arguments.get("node_id") or "").strip()
    if not node_id:
        return json.dumps({"error": "get_node_source: 'node_id' is required"})
    raw_ctx = arguments.get("context_lines", 20)
    try:
        context_lines = int(raw_ctx)
    except (TypeError, ValueError):
        context_lines = 20
    if context_lines < 0:
        context_lines = 0
    if context_lines > _GET_NODE_SOURCE_MAX_CONTEXT:
        context_lines = _GET_NODE_SOURCE_MAX_CONTEXT

    repo, local, err = _resolve_node_id(state, node_id)
    if err is not None:
        return json.dumps({"error": err, "node_id": node_id})

    G = state.graphs[repo]
    d = G.nodes[local]
    source_file = d.get("source_file") or ""
    source_location = d.get("source_location") or ""
    label = d.get("label", local)

    if not source_file:
        return json.dumps({"error": "node has no source_file", "node_id": node_id})

    line = _parse_source_location(source_location)
    if line is None:
        return json.dumps({"error": "could not parse source_location", "source_location": source_location})

    resolved = _resolve_source_path(state, repo, source_file)
    if not resolved.exists() or not resolved.is_file():
        return json.dumps({"error": "source file missing", "source_file": str(resolved)})

    try:
        size = resolved.stat().st_size
    except OSError as exc:
        return json.dumps({"error": f"stat failed ({exc})", "source_file": str(resolved)})
    if size > _GET_NODE_SOURCE_MAX_FILE_BYTES:
        return json.dumps({"error": "file too large", "size_bytes": size})

    try:
        text = resolved.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return json.dumps({"error": f"read failed ({exc})", "source_file": str(resolved)})

    file_lines = text.splitlines()
    total = len(file_lines)
    if total == 0:
        return json.dumps({"error": "source file empty", "source_file": str(resolved)})

    # 1-indexed clamping.
    start = max(1, line - context_lines)
    end = min(total, line + context_lines)
    snippet = "\n".join(file_lines[start - 1:end])

    return json.dumps({
        "node_id": f"{repo}::{local}",
        "source_file": str(resolved),
        "source_location": source_location,
        "language": _detect_language(str(resolved)),
        "snippet": snippet,
        "snippet_start_line": start,
        "snippet_end_line": end,
        "node_label": label,
        "repo": repo,
    })


# ---------------------------------------------------------------------------
# recent_activity — nodes whose source files changed since a cutoff
# ---------------------------------------------------------------------------

_DURATION_RE = re.compile(r"^(\d+)([hdwm])$")
_DURATION_SECS = {
    "h": 3600,
    "d": 86400,
    "w": 7 * 86400,
    "m": 30 * 86400,
}


def _resolve_since(state: GraphState, since: str) -> Optional[float]:
    """Return a unix timestamp cutoff or None if unresolvable."""
    s = (since or "").strip()
    if not s:
        return None
    # Relative duration.
    m = _DURATION_RE.match(s)
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        return _dt.datetime.now().timestamp() - n * _DURATION_SECS[unit]
    # ISO 8601.
    try:
        iso = s.replace("Z", "+00:00")
        dt = _dt.datetime.fromisoformat(iso)
        return dt.timestamp()
    except ValueError:
        pass
    # Git ref: try resolving in each repo's working dir; take the OLDEST.
    timestamps: list[float] = []
    for repo in state.graphs.keys():
        root = _repo_root_for(state, repo)
        if root is None:
            continue
        try:
            r = subprocess.run(
                ["git", "log", "-1", "--format=%ct", s],
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if r.returncode != 0:
            continue
        out = r.stdout.strip()
        if not out:
            continue
        try:
            timestamps.append(float(out))
        except ValueError:
            continue
    if not timestamps:
        return None
    return min(timestamps)


def recent_activity(state: GraphState, arguments: dict) -> str:
    state.refresh_if_stale()
    since = str(arguments.get("since") or "").strip()
    repo_filter = arguments.get("repo_filter")
    try:
        limit = int(arguments.get("limit", 50))
    except (TypeError, ValueError):
        limit = 50
    if limit < 0:
        limit = 0

    if not since:
        return json.dumps({"error": "recent_activity: 'since' is required"})

    cutoff = _resolve_since(state, since)
    if cutoff is None:
        return json.dumps({"error": "could not resolve 'since'", "since": since})

    repos: list[str]
    if repo_filter:
        if repo_filter not in state.graphs:
            return json.dumps({
                "since": since,
                "resolved_since_ts": cutoff,
                "total_changed_files": 0,
                "shown": 0,
                "nodes": [],
            })
        repos = [repo_filter]
    else:
        repos = list(state.graphs.keys())

    file_mtime_cache: dict[str, Optional[float]] = {}

    def _file_mtime(path: str) -> Optional[float]:
        if path in file_mtime_cache:
            return file_mtime_cache[path]
        try:
            mt = os.stat(path).st_mtime
        except OSError:
            mt = None
        file_mtime_cache[path] = mt
        return mt

    matched: list[dict] = []
    changed_files: set[str] = set()
    for repo in repos:
        G = state.graphs.get(repo)
        if G is None:
            continue
        for nid, d in G.nodes(data=True):
            source_file = d.get("source_file") or ""
            if not source_file:
                continue
            resolved = _resolve_source_path(state, repo, source_file)
            mt = _file_mtime(str(resolved))
            if mt is None:
                continue
            if mt < cutoff:
                continue
            changed_files.add(str(resolved))
            matched.append({
                "node_id": f"{repo}::{nid}",
                "label": d.get("label", nid),
                "source_file": str(resolved),
                "mtime": mt,
            })

    matched.sort(key=lambda e: e["mtime"], reverse=True)
    truncated = matched[:limit]
    return json.dumps({
        "since": since,
        "resolved_since_ts": cutoff,
        "total_changed_files": len(changed_files),
        "shown": len(truncated),
        "nodes": truncated,
    })

# Schema sniff for per-repo graph.json files.
#
# gfleet no longer pins graphify to an exact version; the only contract we
# rely on is the NetworkX `node_link_data` shape:
#
#   { "nodes": [{ "id": ..., "label": ..., "repo": ..., "source_file": ...,
#                 "source_location": ... }, ...],
#     "links" | "edges": [{ "source": ..., "target": ..., "relation": ... }, ...] }
#
# Required: nodes[].id (any non-None scalar). Edges' source/target must be
# strings. Everything else is optional but type-checked when present.
#
# This sniff runs at MCP load time. If a sampled node is missing `id`
# entirely we fail the load with a clear error so the agent doesn't silently
# answer from a half-loaded graph. Other type mismatches log a warning to
# stderr (always — not gated on debug) and surface via
# `GraphState.graph_schema_warnings`.
from __future__ import annotations

import random
import sys
from typing import Optional


_OPTIONAL_NODE_STR_FIELDS = ("label", "repo", "source_file", "source_location")


def _sample_indices(total: int, head: int = 50, tail: int = 50, mid: int = 200) -> list[int]:
    """Return up to head + tail + mid distinct indices to sample."""
    if total <= head + tail + mid:
        return list(range(total))
    seen = set(range(head)) | set(range(total - tail, total))
    middle_pool = list(range(head, total - tail))
    if mid > 0 and middle_pool:
        # Deterministic-ish but not seeded — sampling exists to catch egregious
        # schema drift, not to be reproducible.
        for i in random.sample(middle_pool, min(mid, len(middle_pool))):
            seen.add(i)
    return sorted(seen)


def validate_graph_schema(data: dict, repo_tag: str) -> tuple[bool, Optional[str], list[str]]:
    """Sniff a parsed graph.json payload.

    Returns (ok, fatal_reason, warnings).
      ok == True  → graph is loadable (warnings may still be non-empty).
      ok == False → fatal_reason is a short string suitable for surfacing
                    via GraphState.unavailable; warnings is the list of
                    additional findings.
    """
    warnings: list[str] = []

    if not isinstance(data, dict):
        return False, "graph.json is not a JSON object", warnings

    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        return False, "graph.json missing list field 'nodes'", warnings

    edges = data.get("edges")
    if edges is None:
        edges = data.get("links")
    if not isinstance(edges, list):
        return False, "graph.json missing list field 'edges' or 'links'", warnings

    # Empty graph is valid.
    if not nodes and not edges:
        return True, None, warnings

    # ---- Node sniff ----------------------------------------------------
    node_indices = _sample_indices(len(nodes))
    nodes_with_id = 0
    nodes_sampled = 0
    for i in node_indices:
        n = nodes[i]
        if not isinstance(n, dict):
            warnings.append(f"node[{i}] is not an object ({type(n).__name__})")
            continue
        nodes_sampled += 1
        nid = n.get("id")
        if nid is None:
            continue
        nodes_with_id += 1
        for f in _OPTIONAL_NODE_STR_FIELDS:
            v = n.get(f)
            if v is not None and not isinstance(v, str):
                warnings.append(f"node[{i}].{f} is not a string ({type(v).__name__})")

    if nodes_sampled > 0 and nodes_with_id == 0:
        return (
            False,
            f"repo {repo_tag} graph.json is missing required field 'id' on nodes — incompatible graphify version?",
            warnings,
        )

    # ---- Edge sniff ----------------------------------------------------
    edge_indices = _sample_indices(len(edges))
    bad_edge_endpoints = 0
    edges_sampled = 0
    for i in edge_indices:
        e = edges[i]
        if not isinstance(e, dict):
            warnings.append(f"edge[{i}] is not an object ({type(e).__name__})")
            continue
        edges_sampled += 1
        src = e.get("source")
        tgt = e.get("target")
        if not isinstance(src, str) or not isinstance(tgt, str):
            bad_edge_endpoints += 1
            continue
        rel = e.get("relation")
        if rel is not None and not isinstance(rel, str):
            warnings.append(f"edge[{i}].relation is not a string ({type(rel).__name__})")

    if edges_sampled > 0 and bad_edge_endpoints == edges_sampled:
        return (
            False,
            f"repo {repo_tag} graph.json edges are missing string source/target — incompatible graphify version?",
            warnings,
        )

    return True, None, warnings


def emit_warnings(repo_tag: str, warnings: list[str]) -> None:
    """Always-on stderr emit (not debug-gated). Schema drift is loud."""
    if not warnings:
        return
    head = warnings[:5]
    extra = len(warnings) - len(head)
    for w in head:
        print(f"warn: graph_schema[{repo_tag}]: {w}", file=sys.stderr)
    if extra > 0:
        print(f"warn: graph_schema[{repo_tag}]: ... and {extra} more warning(s)", file=sys.stderr)

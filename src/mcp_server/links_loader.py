# Cross-repo link / candidate loader.
#
# File schema (matches `src/links.js`):
#   {
#     "version": 1,
#     "links": [
#       {
#         "source": "<repo>::<node_id>",   required
#         "target": "<repo>::<node_id>",   required
#         "relation": "calls" | "imports" | ...,   required
#         "method":   "import" | "openapi" | ...,  required
#         "confidence": 0..1,                       required
#         "discovered_at": ISO-8601,                required
#         "channel":     null | str,                optional
#         "identifier":  null | str,                optional
#         "source_locations": [ ... ],              optional
#         "reason":      null | str                 optional
#       },
#       ...
#     ]
#   }
#
# Candidate files use `"candidates"` as the top-level key with the same row
# schema. This loader is tolerant: a malformed individual entry is skipped
# (debug-logged) and the remaining valid entries are served. An unparseable
# JSON file produces an empty overlay.
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import networkx as nx

from .utils import debug_log, warn


_REQUIRED = ("source", "target", "relation", "method", "confidence", "discovered_at")


def _validate_entry(entry: dict, idx: int) -> bool:
    """Return True iff `entry` has all required fields with non-None values."""
    if not isinstance(entry, dict):
        debug_log(f"links: row {idx} is not an object; skipping")
        return False
    for k in _REQUIRED:
        if entry.get(k) in (None, ""):
            debug_log(f"links: row {idx} missing required field '{k}'; skipping")
            return False
    return True


def load_links_file(path: Path, key: str = "links") -> tuple[Optional[int], list[dict]]:
    """Load and schema-validate a links/candidates JSON file.

    Returns (version, valid_entries). On unparseable JSON returns (None, []).
    Missing optional fields are filled in with defaults so downstream code
    can read them unconditionally.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warn(f"links file unreadable ({exc}); serving empty overlay")
        return None, []
    if not isinstance(data, dict):
        warn(f"links file {path} is not a JSON object; serving empty overlay")
        return None, []
    version = data.get("version")
    raw = data.get(key)
    if not isinstance(raw, list):
        debug_log(f"links: top-level '{key}' is not a list; treating as empty")
        return version, []
    valid: list[dict] = []
    for i, entry in enumerate(raw):
        if not _validate_entry(entry, i):
            continue
        # Fill optional defaults so callers can read them unconditionally.
        normalized = {
            "source": entry["source"],
            "target": entry["target"],
            "relation": entry["relation"],
            "method": entry["method"],
            "confidence": entry["confidence"],
            "discovered_at": entry["discovered_at"],
            "channel": entry.get("channel"),
            "identifier": entry.get("identifier"),
            "source_locations": entry.get("source_locations") or [],
            "reason": entry.get("reason"),
        }
        valid.append(normalized)
    return version, valid


def build_xrepo_graph(entries: list[dict], has_node) -> nx.Graph:
    """Build a synthetic cross-repo edge overlay from validated entries.

    `has_node(prefixed_id)` is a callback that returns True if the prefixed
    `<repo>::<node_id>` exists in the currently-loaded per-repo graphs. Edges
    where either endpoint is missing are skipped silently — the link table
    can run ahead of the graphs and the missing endpoint may appear after
    the next reload.
    """
    H = nx.Graph()
    for link in entries:
        src = link["source"]
        tgt = link["target"]
        if not has_node(src) or not has_node(tgt):
            continue
        H.add_edge(
            src,
            tgt,
            relation=link["relation"],
            method=link["method"],
            confidence=link["confidence"],
            channel=link["channel"],
            identifier=link["identifier"],
        )
    return H

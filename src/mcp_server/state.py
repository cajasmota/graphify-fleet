# GraphState: per-repo graphs, mtime tracking, lock, link overlay.
#
# Tier A item 5 — graceful per-repo failure: when an individual graph file
# fails to load (missing, corrupt, empty) we mark the repo as `unavailable`
# with a reason string. Tool handlers consult `is_unavailable(repo)` to
# return a structured warning shape rather than crashing. On the next mtime
# check, a successful load clears the unavailable mark.
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Optional

import networkx as nx
from networkx.readwrite import json_graph

from .communities import communities_for, evict_repo
from .index import LabelIndex
from .links_loader import build_xrepo_graph, load_links_file
from .utils import debug_log, warn


def _scan_graphs_dir(graphs_dir: Path) -> list[Path]:
    if not graphs_dir.exists():
        return []
    return sorted(p for p in graphs_dir.glob("*.json"))


def _load_one_graph(graph_path: Path) -> tuple[Optional[nx.Graph], Optional[str]]:
    """Load one repo graph file. Returns (graph, error_reason).

    On success: (G, None). On failure: (None, reason) where `reason` is a
    short human-readable string suitable for surfacing in tool responses.
    """
    try:
        if not graph_path.exists():
            return None, "file missing"
        text = graph_path.read_text(encoding="utf-8")
        if not text.strip():
            return None, "file empty"
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return None, f"corrupt JSON ({exc})"
    except OSError as exc:
        return None, f"unreadable ({exc})"
    try:
        try:
            G = json_graph.node_link_graph(data, edges="links")
        except TypeError:
            G = json_graph.node_link_graph(data)
        return G, None
    except (ValueError, KeyError) as exc:
        return None, f"malformed graph ({exc})"


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
        # Tier A item 5: per-repo unavailability tracking.
        self.unavailable: dict[str, str] = {}  # repo -> reason
        self.label_index = LabelIndex()
        self.xrepo_edges = nx.Graph()
        self.links_mtime: float = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def initial_load(self) -> None:
        with self._lock:
            self._reload_all_graphs()
            self._reload_links()

    def refresh_if_stale(self) -> None:
        """Stat each graph file + the links file; reload only what changed."""
        with self._lock:
            files = _scan_graphs_dir(self.graphs_dir)
            seen: set[str] = set()
            for f in files:
                tag = f.stem
                seen.add(tag)
                if tag not in self.graphs or tag in self.unavailable:
                    self._try_load_repo(tag, f)
                else:
                    self._reload_one_if_stale(tag, f)
            # purge removed
            for tag in list(self.graphs.keys()):
                if tag not in seen:
                    self._drop_repo(tag)
            # purge unavailable entries whose files disappeared
            for tag in list(self.unavailable.keys()):
                if tag not in seen:
                    self.unavailable.pop(tag, None)
            self._reload_links()

    # ------------------------------------------------------------------
    # Per-repo helpers
    # ------------------------------------------------------------------

    def _try_load_repo(self, tag: str, path: Path) -> None:
        try:
            m = path.stat().st_mtime
        except OSError as exc:
            self.unavailable[tag] = f"stat failed ({exc})"
            return
        G, reason = _load_one_graph(path)
        if G is None:
            self.unavailable[tag] = reason or "unknown error"
            debug_log(f"repo '{tag}' unavailable: {self.unavailable[tag]}")
            return
        # Success — clear any prior unavailable mark.
        self.unavailable.pop(tag, None)
        self.graphs[tag] = G
        self.mtimes[tag] = m
        self.communities[tag] = communities_for(tag, m, G)
        self.label_index.reload_repo(tag, G)

    def _reload_one_if_stale(self, tag: str, path: Path) -> None:
        try:
            m = path.stat().st_mtime
        except OSError as exc:
            warn(f"stat failed for {path}: {exc}")
            return
        if self.mtimes.get(tag) == m:
            return
        self._try_load_repo(tag, path)

    def _reload_all_graphs(self) -> None:
        files = _scan_graphs_dir(self.graphs_dir)
        seen_tags: set[str] = set()
        for f in files:
            tag = f.stem
            seen_tags.add(tag)
            self._try_load_repo(tag, f)
        for tag in list(self.graphs.keys()):
            if tag not in seen_tags:
                self._drop_repo(tag)

    def _drop_repo(self, tag: str) -> None:
        self.graphs.pop(tag, None)
        self.communities.pop(tag, None)
        self.mtimes.pop(tag, None)
        self.unavailable.pop(tag, None)
        self.label_index.clear_repo(tag)
        evict_repo(tag)

    # ------------------------------------------------------------------
    # Unavailability API
    # ------------------------------------------------------------------

    def is_unavailable(self, repo: str) -> Optional[str]:
        """Return a reason string if the repo is currently unavailable; else None."""
        return self.unavailable.get(repo)

    def available_repos(self) -> list[str]:
        return sorted(self.graphs.keys())

    # ------------------------------------------------------------------
    # Links overlay
    # ------------------------------------------------------------------

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
        _version, entries = load_links_file(self.links_path, key="links")
        self.xrepo_edges = build_xrepo_graph(entries, self._has_prefixed_node)
        self.links_mtime = m

    def _has_prefixed_node(self, prefixed_id: str) -> bool:
        if "::" not in prefixed_id:
            return False
        repo, local = prefixed_id.split("::", 1)
        G = self.graphs.get(repo)
        return G is not None and local in G

    # ------------------------------------------------------------------
    # Composite view (multi-repo no-filter path)
    # ------------------------------------------------------------------

    def composite_view(self) -> nx.Graph:
        """Return a single graph that prefixes every per-repo node ID with
        `<tag>::` and overlays the cross-repo edges. Computed on demand; with
        typical fleet sizes (handful of repos) this is fast enough per call.
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

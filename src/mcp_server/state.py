# GraphState: per-repo graphs, mtime tracking, lock, link overlay.
#
# Tier A item 5 — graceful per-repo failure: when an individual graph file
# fails to load (missing, corrupt, empty) we mark the repo as `unavailable`
# with a reason string. Tool handlers consult `is_unavailable(repo)` to
# return a structured warning shape rather than crashing. On the next mtime
# check, a successful load clears the unavailable mark.
from __future__ import annotations

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import networkx as nx
from networkx.readwrite import json_graph

from .communities import communities_for, evict_repo
from .graph_schema import emit_warnings, validate_graph_schema
from .index import LabelIndex
from .links_loader import build_xrepo_graph, load_links_file
from .telemetry import get_telemetry
from .utils import debug_log, warn


def resolve_repo_filter(
    value,  # noqa: ANN001 — accepts None | str | list[str]
    default_repo: Optional[str],
) -> Optional[list[str]]:
    """Normalize a caller-supplied `repo_filter` to a concrete repo-list scope.

    Returns:
        - `None` — no scope (search all loaded repos).
        - `list[str]` — restrict to exactly these repos.

    Rules:
        - `None` (omitted): fall back to `[default_repo]` if set, else `None`.
        - `str`: `"*"` widens to all repos (`None`); any other value scopes
          to that single repo for backward compat.
        - `list[str]`: scope to those repos; an empty / all-blank list widens
          to `None` so callers can opt in defensively.
    """
    if value is None:
        return [default_repo] if default_repo else None
    if isinstance(value, str):
        if value == "*":
            return None
        return [value]
    if isinstance(value, list):
        cleaned = [r for r in value if isinstance(r, str) and r]
        return cleaned or None
    raise ValueError(f"repo_filter must be str | list[str] | None, got {type(value).__name__}")


def _scan_graphs_dir(graphs_dir: Path) -> list[Path]:
    if not graphs_dir.exists():
        return []
    return sorted(p for p in graphs_dir.glob("*.json"))


def _load_one_graph(graph_path: Path, repo_tag: str = "") -> tuple[Optional[nx.Graph], Optional[str], list[str]]:
    """Load one repo graph file. Returns (graph, error_reason, schema_warnings).

    On success: (G, None, warnings). On failure: (None, reason, warnings).
    `reason` is a short human-readable string suitable for surfacing in tool
    responses. `warnings` is non-empty when the schema sniff flagged
    non-fatal type issues (always emitted to stderr by the caller).
    """
    try:
        if not graph_path.exists():
            return None, "file missing", []
        text = graph_path.read_text(encoding="utf-8")
        if not text.strip():
            return None, "file empty", []
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return None, f"corrupt JSON ({exc})", []
    except OSError as exc:
        return None, f"unreadable ({exc})", []

    tag = repo_tag or graph_path.stem
    ok, fatal, warnings = validate_graph_schema(data, tag)
    if not ok:
        return None, fatal or "schema validation failed", warnings
    try:
        try:
            G = json_graph.node_link_graph(data, edges="links")
        except TypeError:
            G = json_graph.node_link_graph(data)
        return G, None, warnings
    except (ValueError, KeyError) as exc:
        return None, f"malformed graph ({exc})", warnings


class GraphState:
    """Holds per-repo graphs, communities, mtimes, and the cross-repo overlay.

    All mutations happen under a single lock to keep MCP request handling
    safe; reloads are sub-second so the lock contention is negligible.
    """

    def __init__(self, graphs_dir: Path, links_path: Optional[Path], candidates_path: Optional[Path] = None, rejections_path: Optional[Path] = None) -> None:
        self.graphs_dir = graphs_dir
        self.links_path = links_path
        self.candidates_path = candidates_path
        self.rejections_path = rejections_path
        self.graphs: dict[str, nx.Graph] = {}
        self.communities: dict[str, dict[int, list[str]]] = {}
        self.mtimes: dict[str, float] = {}
        # Tier A item 5: per-repo unavailability tracking.
        self.unavailable: dict[str, str] = {}  # repo -> reason
        # Per-repo schema warnings surfaced by the graph_schema sniff. Read by
        # graph_stats and (eventually) `gfleet doctor` to flag silent drift.
        self.graph_schema_warnings: dict[str, list[str]] = {}
        self.label_index = LabelIndex()
        self.xrepo_edges = nx.Graph()
        self.links_mtime: float = 0.0
        self.candidates_mtime: float = 0.0
        self.rejections_mtime: float = 0.0
        # Caller-inferred repo slug from `--default-repo`. When tool callers
        # omit `repo_filter`, `resolve_repo_filter` falls back to this slug so
        # per-project MCP invocations scope to their own repo by default.
        self.default_repo: Optional[str] = None
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
            self._refresh_candidate_rejection_mtimes()

    # ------------------------------------------------------------------
    # Per-repo helpers
    # ------------------------------------------------------------------

    def _try_load_repo(self, tag: str, path: Path) -> None:
        try:
            m = path.stat().st_mtime
        except OSError as exc:
            self.unavailable[tag] = f"stat failed ({exc})"
            get_telemetry().incr(f"repo.unavailable.stat_failed")
            return
        G, reason, schema_warnings = _load_one_graph(path, tag)
        if schema_warnings:
            emit_warnings(tag, schema_warnings)
            self.graph_schema_warnings[tag] = schema_warnings
        else:
            self.graph_schema_warnings.pop(tag, None)
        if G is None:
            self.unavailable[tag] = reason or "unknown error"
            debug_log(f"repo '{tag}' unavailable: {self.unavailable[tag]}")
            get_telemetry().incr("repo.unavailable.load_failed")
            return
        # Success — clear any prior unavailable mark.
        self.unavailable.pop(tag, None)
        self.graphs[tag] = G
        self.mtimes[tag] = m
        self.communities[tag] = communities_for(tag, m, G)
        self.label_index.reload_repo(tag, G)
        get_telemetry().incr(f"reload.repo.{tag}")

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
        """Load every graph file under `graphs_dir`.

        The JSON read + parse (the slow part) runs on a thread pool so a
        50-module monorepo doesn't pay 30s of sequential I/O at startup.
        State mutation (graphs dict, communities cache, label index)
        happens single-threaded on the caller's thread once all parses
        resolve, in graph-name order so stderr stays readable. Per-repo
        failures stay contained per worker (Tier A item 5).
        """
        files = _scan_graphs_dir(self.graphs_dir)
        seen_tags: set[str] = {f.stem for f in files}

        max_workers = min(8, os.cpu_count() or 4)

        def _worker(path: Path) -> tuple[str, Path, Optional[float], Optional[nx.Graph], Optional[str], list[str]]:
            try:
                m = path.stat().st_mtime
            except OSError as exc:
                return path.stem, path, None, None, f"stat failed ({exc})", []
            G, reason, warnings = _load_one_graph(path, path.stem)
            return path.stem, path, m, G, reason, warnings

        results: list[tuple[str, Path, Optional[float], Optional[nx.Graph], Optional[str], list[str]]] = []
        if files:
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                results = list(pool.map(_worker, files))

        # Apply results in graph-name order for predictable stderr.
        for tag, path, m, G, reason, schema_warnings in sorted(results, key=lambda r: r[0]):
            if schema_warnings:
                emit_warnings(tag, schema_warnings)
                self.graph_schema_warnings[tag] = schema_warnings
            else:
                self.graph_schema_warnings.pop(tag, None)
            if G is None:
                self.unavailable[tag] = reason or "unknown error"
                debug_log(f"repo '{tag}' unavailable: {self.unavailable[tag]}")
                get_telemetry().incr("repo.unavailable.load_failed")
                continue
            self.unavailable.pop(tag, None)
            self.graphs[tag] = G
            self.mtimes[tag] = m  # type: ignore[assignment]
            self.communities[tag] = communities_for(tag, m, G)
            self.label_index.reload_repo(tag, G)
            get_telemetry().incr(f"reload.repo.{tag}")

        for tag in list(self.graphs.keys()):
            if tag not in seen_tags:
                self._drop_repo(tag)

    def _drop_repo(self, tag: str) -> None:
        self.graphs.pop(tag, None)
        self.communities.pop(tag, None)
        self.mtimes.pop(tag, None)
        self.unavailable.pop(tag, None)
        self.graph_schema_warnings.pop(tag, None)
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
        get_telemetry().incr("reload.links")

    def _refresh_candidate_rejection_mtimes(self) -> None:
        """Stat candidates/rejections files so callers can detect changes since
        the last refresh. The actual entries are loaded on-demand by the
        tool handlers (small files, low frequency) — we only track mtimes
        here so the watch is uniform with the existing links overlay.
        """
        for path_attr, mtime_attr in (
            ("candidates_path", "candidates_mtime"),
            ("rejections_path", "rejections_mtime"),
        ):
            path = getattr(self, path_attr)
            if not path:
                continue
            try:
                m = path.stat().st_mtime
            except OSError:
                if getattr(self, mtime_attr) != 0.0:
                    setattr(self, mtime_attr, 0.0)
                continue
            if m != getattr(self, mtime_attr):
                setattr(self, mtime_attr, m)
                get_telemetry().incr(f"reload.{path_attr.removesuffix('_path')}")

    def _has_prefixed_node(self, prefixed_id: str) -> bool:
        if "::" not in prefixed_id:
            return False
        repo, local = prefixed_id.split("::", 1)
        G = self.graphs.get(repo)
        return G is not None and local in G

    # ------------------------------------------------------------------
    # Composite view (multi-repo no-filter path)
    # ------------------------------------------------------------------

    def composite_view(self, *, weighted: bool = False) -> nx.Graph:
        """Return a single graph that prefixes every per-repo node ID with
        `<tag>::` and overlays the cross-repo edges. Computed on demand; with
        typical fleet sizes (handful of repos) this is fast enough per call.

        When `weighted=True`, edges carry a `weight` attribute used by
        `shortest_path` so cross-repo hops are priced by their link
        confidence (`1 / max(0.1, confidence)`) — high-confidence cross-repo
        edges feel cheap, low-confidence ones feel expensive. Internal
        per-repo edges weight 1.0. Each cross-repo edge is also tagged
        `cross_repo=True` so callers can identify the hop afterwards.
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
                edge_iter = ((u, v, data) for u, v, _k, data in G.edges(keys=True, data=True))
            else:
                edge_iter = G.edges(data=True)
            for u, v, data in edge_iter:
                attrs = dict(data)
                if weighted:
                    attrs["weight"] = 1.0
                    attrs.setdefault("cross_repo", False)
                H.add_edge(f"{tag}::{u}", f"{tag}::{v}", **attrs)
        for u, v, data in self.xrepo_edges.edges(data=True):
            if u in H and v in H:
                attrs = dict(data)
                if weighted:
                    conf = attrs.get("confidence")
                    try:
                        c = float(conf) if conf is not None else 0.1
                    except (TypeError, ValueError):
                        c = 0.1
                    attrs["weight"] = 1.0 / max(0.1, c)
                    attrs["cross_repo"] = True
                H.add_edge(u, v, **attrs)
        return H

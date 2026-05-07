# Community extraction + mtime-keyed cache.
#
# Communities are stored on each node as a `community` attribute by the
# upstream graphify pipeline. This module only buckets node IDs by that
# attribute — it does not run a community-detection algorithm. Caching keyed
# on (repo, mtime) avoids re-bucketing when a repo graph hasn't changed.
from __future__ import annotations

import networkx as nx


_COMMUNITY_CACHE: dict[tuple[str, float], dict[int, list[str]]] = {}


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


def communities_for(repo: str, mtime: float, G: nx.Graph) -> dict[int, list[str]]:
    """Cached lookup. Reuses prior computation for the same (repo, mtime).
    Evicts older entries for the same repo so the cache stays bounded.
    """
    key = (repo, mtime)
    cached = _COMMUNITY_CACHE.get(key)
    if cached is not None:
        return cached
    # Evict any stale entries for this repo (mtime != current).
    stale = [k for k in _COMMUNITY_CACHE if k[0] == repo and k != key]
    for k in stale:
        _COMMUNITY_CACHE.pop(k, None)
    computed = _communities_from_graph(G)
    _COMMUNITY_CACHE[key] = computed
    return computed


def evict_repo(repo: str) -> None:
    """Drop all cache entries for a repo (used when a repo disappears)."""
    keys = [k for k in _COMMUNITY_CACHE if k[0] == repo]
    for k in keys:
        _COMMUNITY_CACHE.pop(k, None)


def cache_size() -> int:
    return len(_COMMUNITY_CACHE)

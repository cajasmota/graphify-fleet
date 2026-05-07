# LabelIndex: inverted index from lowercased label -> [(repo, node_id, original_label)].
#
# Built at graph-load time per repo. On per-repo reload, the entries for that
# repo are dropped and rebuilt. In-memory only — no persistence.
#
# Used by `get_node` (and any future label-lookup tools) to skip the O(N)
# scan over every node in every repo on each call.
from __future__ import annotations

from typing import Iterable

import networkx as nx

from .scoring import _strip_diacritics


class LabelIndex:
    """Inverted label -> list of (repo, node_id, original_label)."""

    def __init__(self) -> None:
        # Key is the diacritic-stripped lowercase label. Value is a list of
        # (repo, node_id, original_label) tuples — labels can collide across
        # repos and across nodes within a repo.
        self._by_label: dict[str, list[tuple[str, str, str]]] = {}
        # Track per-repo entries so we can drop them cheaply on reload.
        self._by_repo: dict[str, list[tuple[str, str]]] = {}

    def clear_repo(self, repo: str) -> None:
        keys = self._by_repo.pop(repo, [])
        for label_key, _node_id in keys:
            entries = self._by_label.get(label_key)
            if not entries:
                continue
            entries[:] = [e for e in entries if e[0] != repo]
            if not entries:
                self._by_label.pop(label_key, None)

    def add_repo(self, repo: str, G: nx.Graph) -> None:
        # Caller is expected to have already cleared this repo's entries.
        repo_keys: list[tuple[str, str]] = []
        for nid, data in G.nodes(data=True):
            label = data.get("label") or nid
            norm = (data.get("norm_label") or _strip_diacritics(label).lower()).strip()
            if not norm:
                continue
            self._by_label.setdefault(norm, []).append((repo, nid, label))
            repo_keys.append((norm, nid))
            # Also index the bare node-id (lowercased) so lookups by id work.
            nid_key = nid.lower()
            if nid_key != norm:
                self._by_label.setdefault(nid_key, []).append((repo, nid, label))
                repo_keys.append((nid_key, nid))
        self._by_repo[repo] = repo_keys

    def reload_repo(self, repo: str, G: nx.Graph) -> None:
        self.clear_repo(repo)
        self.add_repo(repo, G)

    def lookup(self, label: str) -> list[tuple[str, str, str]]:
        """Exact (case-insensitive, diacritic-stripped) lookup."""
        key = _strip_diacritics(label or "").strip().lower()
        if not key:
            return []
        return list(self._by_label.get(key, ()))

    def lookup_substring(self, label: str) -> list[tuple[str, str, str]]:
        """Substring fallback for callers that want loose matching."""
        key = _strip_diacritics(label or "").strip().lower()
        if not key:
            return []
        # Fast path: exact hit
        exact = self._by_label.get(key)
        if exact:
            return list(exact)
        out: list[tuple[str, str, str]] = []
        for k, entries in self._by_label.items():
            if key in k:
                out.extend(entries)
        return out

    def __len__(self) -> int:
        return sum(len(v) for v in self._by_label.values())

    def repos(self) -> Iterable[str]:
        return self._by_repo.keys()

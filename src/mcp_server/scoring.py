# Label scoring + diacritic stripping. Preserved verbatim from upstream
# graphify serve.py to keep ranking behavior stable.
from __future__ import annotations

import unicodedata

import networkx as nx


_EXACT_MATCH_BONUS = 100.0


def _strip_diacritics(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in nfkd if not unicodedata.combining(c))


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

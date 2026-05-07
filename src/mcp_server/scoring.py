# Label scoring + diacritic stripping.
#
# BM25-style ranking over a per-graph corpus. Each node's "document" is its
# label tokens plus tokens from its source_file basename. Tokens are formed
# by splitting on punctuation/whitespace AND on camelCase boundaries so a
# query like "order viewset" matches `OrderViewSet`.
#
# Corpus statistics (df, N, avg_doc_len) are cached per-graph object id +
# node count so repeated queries against the same loaded graph reuse the
# same stats. Reload of a graph yields a fresh networkx.Graph object, so
# id() flips and the cache key naturally invalidates.
from __future__ import annotations

import math
import re
import unicodedata

import networkx as nx


# BM25 parameters. k1 controls term-frequency saturation; b controls the
# strength of length normalization. Standard IR defaults.
_BM25_K1 = 1.5
_BM25_B = 0.75

# Bonuses layered on top of the BM25 score.
_EXACT_MATCH_BONUS = 5.0   # node label equals a query term
_PREFIX_BONUS = 1.5        # node label starts with a query term

# Filter threshold: BM25 < 0.1 is essentially noise.
_SCORE_THRESHOLD = 0.1

_TOKEN_SPLIT_RE = re.compile(r"[_\-\.\s/]+")
# CamelCase boundary: a lowercase/digit followed by an uppercase. Also splits
# acronym-then-Word boundaries (HTTPHandler -> HTTP, Handler).
_CAMEL_RE_1 = re.compile(r"([a-z0-9])([A-Z])")
_CAMEL_RE_2 = re.compile(r"([A-Z]+)([A-Z][a-z])")
_NUMERIC_RE = re.compile(r"^\d+$")


def _strip_diacritics(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _split_camel(token: str) -> list[str]:
    if not token:
        return []
    s = _CAMEL_RE_2.sub(r"\1 \2", token)
    s = _CAMEL_RE_1.sub(r"\1 \2", s)
    return [p for p in s.split(" ") if p]


def _tokenize(text: str) -> list[str]:
    """Tokenize a label/source_file for BM25.

    Lowercase + diacritic-strip. Split on `[_\\-\\.\\s/]`, then split each
    chunk on camelCase boundaries. Drop pure-numeric tokens.
    """
    if not text:
        return []
    cleaned = _strip_diacritics(text)
    out: list[str] = []
    for chunk in _TOKEN_SPLIT_RE.split(cleaned):
        if not chunk:
            continue
        for piece in _split_camel(chunk):
            if not piece:
                continue
            if _NUMERIC_RE.match(piece):
                continue
            out.append(piece.lower())
    return out


def _node_basename(source: str) -> str:
    """Return the basename (no extension) of a source_file path-like string."""
    if not source:
        return ""
    s = source.replace("\\", "/")
    if "/" in s:
        s = s.rsplit("/", 1)[1]
    if "." in s:
        s = s.rsplit(".", 1)[0]
    return s


def _node_doc_tokens(data: dict) -> list[str]:
    """Build the token list that constitutes a node's BM25 'document'."""
    label = data.get("label") or ""
    source = data.get("source_file") or ""
    base = _node_basename(source)
    return _tokenize(label) + _tokenize(base)


# ---------------------------------------------------------------------------
# CorpusStats — per-graph BM25 statistics
# ---------------------------------------------------------------------------


class CorpusStats:
    """Document-frequency / length statistics over a single graph.

    Recomputed by walking `G.nodes(data=True)` once. Cheap relative to the
    graph load cost. Stored on the `_score_nodes` module-level cache keyed
    by `id(G)` + `G.number_of_nodes()` so repeated queries against the same
    loaded graph reuse it.
    """

    __slots__ = ("df", "doc_lens", "total_nodes", "avg_doc_len", "_node_count_at_build")

    def __init__(self, G: nx.Graph) -> None:
        self.df: dict[str, int] = {}
        self.doc_lens: dict[str, int] = {}
        total_len = 0
        n = 0
        for nid, data in G.nodes(data=True):
            tokens = _node_doc_tokens(data)
            self.doc_lens[nid] = len(tokens)
            total_len += len(tokens)
            n += 1
            for term in set(tokens):
                self.df[term] = self.df.get(term, 0) + 1
        self.total_nodes = n
        self.avg_doc_len = (total_len / n) if n > 0 else 0.0
        self._node_count_at_build = n

    def idf(self, term: str) -> float:
        df = self.df.get(term, 0)
        # +1 inside the log keeps IDF non-negative even for terms appearing
        # in more than half the corpus.
        return math.log((self.total_nodes - df + 0.5) / (df + 0.5) + 1.0)


_corpus_cache: dict[tuple[int, int], CorpusStats] = {}


def _corpus_for(G: nx.Graph) -> CorpusStats:
    key = (id(G), G.number_of_nodes())
    stats = _corpus_cache.get(key)
    if stats is None:
        stats = CorpusStats(G)
        # Keep the cache small: only the most recent ~32 graph objects.
        if len(_corpus_cache) >= 32:
            _corpus_cache.pop(next(iter(_corpus_cache)))
        _corpus_cache[key] = stats
    return stats


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def _score_nodes(G: nx.Graph, terms: list[str]) -> list[tuple[float, str]]:
    """BM25-style scoring with exact-match + prefix bonuses.

    Returns a list of (score, node_id) sorted descending. Filters out
    anything below `_SCORE_THRESHOLD` so callers don't pick up noise.
    Signature is preserved from the previous implementation for callers.
    """
    if not terms:
        return []
    # Tokenize the query the same way we tokenize documents so camelCase
    # query terms break apart and match.
    query_tokens: list[str] = []
    for t in terms:
        query_tokens.extend(_tokenize(t))
    if not query_tokens:
        return []
    # Dedup while preserving order.
    seen: set[str] = set()
    q_unique: list[str] = []
    for t in query_tokens:
        if t not in seen:
            seen.add(t)
            q_unique.append(t)

    stats = _corpus_for(G)
    if stats.total_nodes == 0 or stats.avg_doc_len == 0:
        return []

    # Precompute IDF for each query term.
    idfs = {t: stats.idf(t) for t in q_unique}

    norm_terms = [_strip_diacritics(t).lower() for t in terms]
    scored: list[tuple[float, str]] = []

    for nid, data in G.nodes(data=True):
        doc_tokens = _node_doc_tokens(data)
        if not doc_tokens:
            continue
        doc_len = len(doc_tokens)
        # Term frequency for query terms only.
        tf: dict[str, int] = {}
        for tok in doc_tokens:
            if tok in idfs:
                tf[tok] = tf.get(tok, 0) + 1
        if not tf:
            # Allow exact-match bonus to still fire even when no token
            # overlap — e.g. if the label is a single-character literal.
            score = 0.0
        else:
            score = 0.0
            denom_norm = _BM25_K1 * (1 - _BM25_B + _BM25_B * doc_len / stats.avg_doc_len)
            for term, freq in tf.items():
                idf = idfs[term]
                score += idf * (freq * (_BM25_K1 + 1)) / (freq + denom_norm)

        # Exact-match + prefix bonuses (computed against the full label).
        norm_label = (data.get("norm_label") or _strip_diacritics(data.get("label") or "").lower()).strip()
        if norm_label:
            stripped = norm_label.rstrip("()")
            for nt in norm_terms:
                if not nt:
                    continue
                if nt == norm_label or nt == stripped:
                    score += _EXACT_MATCH_BONUS
                    break
            for nt in norm_terms:
                if nt and norm_label.startswith(nt) and nt != norm_label:
                    score += _PREFIX_BONUS
                    break

        if score >= _SCORE_THRESHOLD:
            scored.append((score, nid))

    return sorted(scored, reverse=True)

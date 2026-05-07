# gfleet-managed MCP stdio server (modularized).
#
# This package was refactored from the single-file `src/mcp-server/server.py`
# (now removed; a backward-compat shim is preserved there). The package layout:
#
#   __main__.py       — CLI entry: `python -m mcp_server <graphs-dir>`
#   server.py         — Server creation + tool registration + serve()
#   state.py          — GraphState: per-repo graphs, mtimes, lock, link overlay
#   tools.py          — Tool handler implementations
#   scoring.py        — Label scoring + diacritics + exact-match bonus
#   traversal.py      — BFS / DFS helpers
#   context_filter.py — context_filter resolution + graph filtering
#   index.py          — LabelIndex inverted index (Tier A item 2)
#   links_loader.py   — Cross-repo link/candidate loader + schema validation
#   communities.py    — Community extraction + mtime-keyed cache (Tier A 3)
#   utils.py          — _filter_blank_stdin, _sanitize_label, debug logging

__all__ = ["serve", "main_cli"]


def __getattr__(name):  # pragma: no cover — lazy re-export
    if name in ("serve", "main_cli"):
        from . import server
        return getattr(server, name)
    raise AttributeError(name)

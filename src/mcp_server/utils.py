# Small stdlib-only helpers shared across modules.
from __future__ import annotations

import os
import sys
import threading


def debug_enabled() -> bool:
    """Whether GFLEET_MCP_DEBUG=1 is set. Used to gate verbose stderr logging."""
    return os.environ.get("GFLEET_MCP_DEBUG") == "1"


def debug_log(msg: str) -> None:
    """Print a debug line to stderr only when GFLEET_MCP_DEBUG=1."""
    if debug_enabled():
        print(f"[mcp_server] {msg}", file=sys.stderr)


def warn(msg: str) -> None:
    """Always-on stderr warning (kept for parity with the pre-refactor server)."""
    print(f"warn: {msg}", file=sys.stderr)


def _sanitize_label(s: str) -> str:
    """Mirrors graphify.security.sanitize_label minimally — collapse whitespace
    and drop control chars. Avoids importing graphify so the server can run
    against a graphify env or any python with networkx + mcp.
    """
    if not s:
        return ""
    out = []
    for ch in s:
        if ord(ch) < 32 or ord(ch) == 127:
            continue
        out.append(ch)
    return "".join(out).strip()


def _filter_blank_stdin() -> None:
    """Filter blank lines from stdin (preserved verbatim from upstream
    serve.py). Claude Desktop and some other MCP clients send bare newlines
    that otherwise blow up Pydantic JSONRPC parsing.
    """
    r_fd, w_fd = os.pipe()
    saved_fd = os.dup(sys.stdin.fileno())

    def _relay() -> None:
        try:
            with open(saved_fd, "rb") as src, open(w_fd, "wb") as dst:
                for line in src:
                    if line.strip():
                        dst.write(line)
                        dst.flush()
        except Exception:
            pass

    threading.Thread(target=_relay, daemon=True).start()
    os.dup2(r_fd, sys.stdin.fileno())
    os.close(r_fd)
    sys.stdin = open(0, "r", closefd=False)

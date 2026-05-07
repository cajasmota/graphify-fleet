# In-memory telemetry counters + bounded latency samples.
#
# Goal: when something feels off, the user can run `GFLEET_MCP_DEBUG=1 ...`
# and get a one-shot summary of what the server has been doing — total tool
# calls, mean / p95 / max latency per tool, reload counts, link-table sizes,
# error tallies, and rough graph-memory size.
#
# Stdlib only. Counters are not strictly thread-safe but in CPython our
# `dict[key] += 1` increments are atomic enough for the read-mostly summary
# workload here.
from __future__ import annotations

import math
import os
import sys
import time
from typing import Optional


_LATENCY_CAP = 100  # samples retained per tool (FIFO rotation)


class Telemetry:
    """Lightweight counter + latency tracker. Single-process, in-memory."""

    def __init__(self) -> None:
        self.counters: dict[str, int] = {}
        # `latencies_ms[tool]` is a bounded list (cap=_LATENCY_CAP, FIFO).
        self.latencies_ms: dict[str, list[float]] = {}
        self.started_at: float = time.time()

    def incr(self, key: str, by: int = 1) -> None:
        if not key:
            return
        self.counters[key] = self.counters.get(key, 0) + by

    def record_latency(self, tool: str, ms: float) -> None:
        if not tool:
            return
        bucket = self.latencies_ms.setdefault(tool, [])
        bucket.append(float(ms))
        if len(bucket) > _LATENCY_CAP:
            # FIFO: drop the oldest. List slice is O(n) but n<=100 so fine.
            del bucket[: len(bucket) - _LATENCY_CAP]

    # ------------------------------------------------------------------
    # Summary rendering
    # ------------------------------------------------------------------

    def _percentile(self, samples: list[float], pct: float) -> float:
        if not samples:
            return 0.0
        s = sorted(samples)
        # Nearest-rank percentile; deterministic and stdlib-only.
        k = max(0, min(len(s) - 1, int(math.ceil(pct / 100.0 * len(s))) - 1))
        return s[k]

    def summary(self, *, state: Optional[object] = None) -> str:
        """Return a multi-line, stderr-friendly summary string."""
        lines: list[str] = []
        uptime = max(0.0, time.time() - self.started_at)
        lines.append("=== gfleet MCP telemetry ===")
        lines.append(f"uptime: {_fmt_seconds(uptime)}")

        # Per-tool latency breakdown.
        if self.latencies_ms:
            lines.append("")
            lines.append("tool calls:")
            for tool in sorted(self.latencies_ms.keys()):
                samples = self.latencies_ms[tool]
                if not samples:
                    continue
                count = self.counters.get(f"tool.{tool}.calls", len(samples))
                mean = sum(samples) / len(samples)
                p95 = self._percentile(samples, 95.0)
                mx = max(samples)
                lines.append(
                    f"  {tool}: calls={count} mean={mean:.1f}ms p95={p95:.1f}ms max={mx:.1f}ms"
                )
        else:
            lines.append("")
            lines.append("tool calls: none recorded")

        # Reload counts.
        reload_keys = sorted(k for k in self.counters if k.startswith("reload."))
        if reload_keys:
            lines.append("")
            lines.append("reloads:")
            for k in reload_keys:
                lines.append(f"  {k.removeprefix('reload.')}: {self.counters[k]}")

        # Repo unavailability events.
        unavail_keys = sorted(k for k in self.counters if k.startswith("repo.unavailable."))
        if unavail_keys:
            lines.append("")
            lines.append("repo unavailability events:")
            for k in unavail_keys:
                lines.append(f"  {k.removeprefix('repo.unavailable.')}: {self.counters[k]}")

        # Errors.
        err_keys = sorted(k for k in self.counters if k.startswith("error."))
        if err_keys:
            lines.append("")
            lines.append("errors:")
            for k in err_keys:
                lines.append(f"  {k.removeprefix('error.')}: {self.counters[k]}")

        # State-derived snapshot (current sizes — not counters).
        if state is not None:
            lines.append("")
            lines.append("current state:")
            graphs = getattr(state, "graphs", {}) or {}
            try:
                total_nodes = sum(g.number_of_nodes() for g in graphs.values())
                total_edges = sum(g.number_of_edges() for g in graphs.values())
            except Exception:  # noqa: BLE001 — summary must never crash
                total_nodes = 0
                total_edges = 0
            lines.append(f"  repos loaded: {len(graphs)}")
            lines.append(f"  nodes (sum): {total_nodes}")
            lines.append(f"  edges (sum, excluding cross-repo): {total_edges}")
            xrepo = getattr(state, "xrepo_edges", None)
            try:
                xrepo_count = xrepo.number_of_edges() if xrepo is not None else 0
            except Exception:  # noqa: BLE001
                xrepo_count = 0
            lines.append(f"  cross-repo links: {xrepo_count}")
            unavail = getattr(state, "unavailable", {}) or {}
            if unavail:
                lines.append(f"  unavailable repos: {sorted(unavail.keys())}")

            # Best-effort: candidate / rejection counts. These files are read on
            # demand by tool handlers; we read them here only if they exist and
            # are tiny. Failures are silent (summary must not crash).
            for label, attr, key in (
                ("candidates", "candidates_path", "candidates"),
                ("rejections", "rejections_path", "rejections"),
            ):
                path = getattr(state, attr, None)
                if path is None:
                    continue
                try:
                    if path.exists():
                        import json as _json
                        data = _json.loads(path.read_text(encoding="utf-8"))
                        n = len(data.get(key) or []) if isinstance(data, dict) else 0
                        lines.append(f"  {label}: {n}")
                except Exception:  # noqa: BLE001
                    continue

        # Misc counters not covered above.
        misc_keys = sorted(
            k for k in self.counters
            if not k.startswith(("tool.", "reload.", "repo.unavailable.", "error."))
        )
        if misc_keys:
            lines.append("")
            lines.append("other counters:")
            for k in misc_keys:
                lines.append(f"  {k}: {self.counters[k]}")

        return "\n".join(lines)


def _fmt_seconds(s: float) -> str:
    s = int(s)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}h{m}m{sec}s"
    if m:
        return f"{m}m{sec}s"
    return f"{sec}s"


# ---------------------------------------------------------------------------
# Module-global telemetry singleton
# ---------------------------------------------------------------------------

_telemetry = Telemetry()


def get_telemetry() -> Telemetry:
    """Return the process-wide telemetry singleton."""
    return _telemetry


def reset_telemetry() -> None:
    """Test helper: replace the singleton with a fresh instance."""
    global _telemetry
    _telemetry = Telemetry()


# ---------------------------------------------------------------------------
# Debug-knob helpers (formalize GFLEET_MCP_DEBUG levels)
# ---------------------------------------------------------------------------

def debug_level() -> int:
    """Parse `GFLEET_MCP_DEBUG`. `0` (default), `1` summary + warnings,
    `2`+ verbose per-call. Non-numeric values are treated as 0.
    """
    raw = os.environ.get("GFLEET_MCP_DEBUG", "")
    if not raw:
        return 0
    try:
        return int(raw)
    except ValueError:
        # Backwards compat: accept "1" only; anything else is 0.
        return 1 if raw == "1" else 0


def verbose_log(msg: str) -> None:
    """Per-call entry/exit logging gated on GFLEET_MCP_DEBUG>=2."""
    if debug_level() >= 2:
        print(f"[mcp_server.verbose] {msg}", file=sys.stderr)

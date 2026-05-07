# Module entry: `python -m mcp_server <graphs-dir> [--group <tag>]`.
#
# Also runnable as a direct script via the file path:
#   python <gfleet>/src/mcp_server/__main__.py <graphs-dir> --group <tag>
# This dual-mode is required because integrations.js writes the file path
# directly into .mcp.json args (no PYTHONPATH gymnastics), but `python -m`
# remains supported for manual invocation when the gfleet repo is on
# sys.path.
from __future__ import annotations

import os
import sys
from pathlib import Path


def _bootstrap_path_for_direct_invocation() -> None:
    # When invoked as `python /path/to/src/mcp_server/__main__.py ...`,
    # Python sets sys.path[0] to `.../src/mcp_server` (the script's dir),
    # which makes `from .server import ...` fail because there is no parent
    # package on sys.path. Detect this case and prepend the parent (`src/`)
    # so the package is importable.
    here = Path(__file__).resolve().parent  # .../src/mcp_server
    parent = here.parent  # .../src
    if __package__ in (None, ""):
        sys.path.insert(0, str(parent))


_bootstrap_path_for_direct_invocation()

# After bootstrap we can import via the package name regardless of how we
# were invoked.
from mcp_server.server import main_cli  # noqa: E402


if __name__ == "__main__":
    main_cli()

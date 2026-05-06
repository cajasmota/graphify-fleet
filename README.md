# graphify-fleet

Orchestrate [graphify](https://github.com/safishamsi/graphify) across **multiple related repos** (e.g. backend + frontend + mobile). Keeps each repo's knowledge graph current and merges them into a single group-scoped graph that your AI assistants (Claude Code, Windsurf) can query.

Unrelated projects stay isolated: each fleet config produces its own merged graph file, so a "platform" group never sees a "client B" group's nodes.

## What it sets up per repo in a group

- `.graphifyignore` (tailored per stack: node, python, react-native, generic)
- Initial AST-only graph (`graphify update`) — no API key needed
- Git hooks (post-commit, post-checkout) that rebuild the graph and remerge the group
- File watcher (launchd on macOS, systemd-user on Linux, Scheduled Task on Windows) for save-time freshness
- `.mcp.json` entry pointing both Claude Code and Windsurf at the group's merged graph
- `graphify claude install` for the Claude Code skill
- Manual Windsurf workflow + rules (until [PR #574](https://github.com/safishamsi/graphify/pull/574) merges)
- Sane `.gitignore` additions (`graphify-out/wiki/`, `manifest.json`, `cost.json`, `cache/`)

The merged group graph lives at `~/.graphify/groups/<group>.json` (or `%USERPROFILE%\.graphify\groups\<group>.json` on Windows).

## Requirements

- **macOS / Linux**: `bash`, `jq`, `git`, Python 3.10+, [`uv`](https://docs.astral.sh/uv/)
- **Windows**: PowerShell 7+, `git`, Python 3.10+, `uv`

`gfleet doctor` checks all of these.

## Install

```bash
git clone https://github.com/<you>/graphify-fleet.git ~/.graphify-fleet
ln -s ~/.graphify-fleet/bin/gfleet ~/.local/bin/gfleet      # macOS / Linux
# or on Windows (PowerShell, one time):
# $env:Path += ";$HOME\.graphify-fleet\bin"
```

## Configure

Create a JSON config describing one project group. Multiple groups = multiple config files.

```json
{
  "group": "upvate",
  "repos": [
    {"path": "~/Projects/UpVate/core-mobile",          "slug": "upvate-mobile",   "stack": "react-native"},
    {"path": "~/Projects/UpVate/upvate_core",          "slug": "upvate-core",     "stack": "python"},
    {"path": "~/Projects/UpVate/upvate_core_frontend", "slug": "upvate-frontend", "stack": "node"}
  ],
  "options": {
    "wiki_gitignored": true,
    "watchers": true,
    "windsurf": true,
    "claude_code": true
  }
}
```

`stack` picks the `.graphifyignore` template (`node`, `python`, `react-native`, `go`, `generic`).

## Usage

```bash
gfleet doctor                            # check prerequisites
gfleet install   ./upvate.fleet.json     # idempotent — safe to re-run
gfleet uninstall ./upvate.fleet.json     # remove hooks/watchers/configs
gfleet status    ./upvate.fleet.json     # watcher state + graph node counts
gfleet rebuild   ./upvate.fleet.json     # force AST rebuild (use after deletions)
gfleet rebuild   ./upvate.fleet.json upvate-core   # one repo only
gfleet start     ./upvate.fleet.json     # load watchers
gfleet stop      ./upvate.fleet.json     # unload watchers
gfleet restart   ./upvate.fleet.json
gfleet remerge   ./upvate.fleet.json     # rerun merge-graphs over all repos in group
```

## Multiple groups, one machine

```bash
gfleet install ~/configs/upvate.fleet.json
gfleet install ~/configs/clientB.fleet.json
gfleet install ~/configs/personal.fleet.json
```

Each group writes a separate merged graph at `~/.graphify/groups/<group>.json`. Each repo's `.mcp.json` points at its own group's file — no cross-contamination.

## Uninstall

```bash
gfleet uninstall ./upvate.fleet.json
```

Removes watchers, git hooks, `.windsurf/workflows/graphify.md`, the graphify block from `.windsurfrules`, the graphify entry from `.mcp.json`, and the merged group graph file. Leaves `graphify-out/` (per-repo graphs) intact unless you pass `--purge`.

## Sharing with teammates

Commit your fleet config(s) somewhere accessible (a shared dotfiles repo, or alongside the project). Teammates clone graphify-fleet, edit paths to match their machine, run `gfleet install`. Done.

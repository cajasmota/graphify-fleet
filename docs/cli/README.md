# gfleet CLI reference

Detailed reference for every `gfleet` subcommand, organized by topic. The
top-level [README](../../README.md) is intentionally brief — this folder is
the source of truth for flags, arguments, side effects, and examples.

The primary `gfleet help` view shows the five sections most users care about;
`gfleet help advanced` lists every public command. A handful of dispatcher
cases are aliases or internal-only and are noted explicitly below.

## Argument convention

Most commands accept a single positional argument that resolves to a fleet
config:

- a registered **group name** (e.g. `upvate`)
- an explicit **path to a `*.fleet.json`** config
- **omitted** — fan out across every registered group

When omitted, commands run sequentially across all configs from
`~/.graphify-fleet/registry.json`. Some commands take a second positional
argument (e.g. a repo `slug`) — see the per-command pages.

## Topics

| File | Commands |
|------|----------|
| [setup.md](setup.md) | `wizard` (alias `new`), `onboard`, `install` |
| [operate.md](operate.md) | `update`, `doctor`, `status`, `list` (alias `ls`), `help` |
| [watchers.md](watchers.md) | `start`, `stop`, `restart` |
| [repair.md](repair.md) | `rebuild`, `reset`, `remerge`, `uninstall` |
| [docs.md](docs.md) | `docs status` / `run` / `path` / `init-cli` / `silence` / `unsilence` / `clear-stale` / `mark-stale`, plus `/generate-docs` skill flags |
| [monorepo.md](monorepo.md) | `monorepo add` / `remove` / `list` |
| [advanced.md](advanced.md) | `skills`, `conventions`, `patch`, hidden aliases, env vars |

## One-line summary

| Command | Summary |
|---------|---------|
| `wizard` | Interactive first-time setup. |
| `onboard [path]` | Join an existing group after `git clone` (reads `.gfleet/group.json`). |
| `install <config.json>` | Install a fleet group from an explicit config (normally invoked by the wizard). |
| `update [--refresh-rules\|--refresh-rules-lite] [--force]` | Pull latest gfleet, redeploy skills, repatch graphify. |
| `doctor` | Verify graphify, hooks, paths, and patch state. |
| `list` / `ls` | List registered groups + node counts. |
| `status [group]` | Watcher state + node/edge counts. |
| `start [group]` | Load watchers (launchd / systemd / Scheduled Tasks). |
| `stop [group]` | Unload watchers. |
| `restart [group]` | Stop then start. |
| `rebuild [group] [slug]` | Force AST rebuild (after deletions). |
| `reset [group] [slug]` | Wipe `graphify-out/` and rebuild from scratch. |
| `remerge [group]` | Re-merge the group graph (no per-repo rebuild). |
| `uninstall [group] [--purge]` | Remove watchers, hooks, configs (and per-repo `graphify-out/` with `--purge`). |
| `skills {install\|uninstall\|update\|status}` | Manage the `/generate-docs` skill globally. |
| `conventions {list\|add\|remove}` | Manage stack conventions for `/generate-docs`. |
| `docs status [group]` | Show generated docs + stale section count. |
| `docs run <group>` | Print `/generate-docs` instructions. |
| `docs path <group>` | Print the configured group docs path. |
| `docs init-cli <group>` | Headless CLI Q&A (prefer `/generate-docs --setup-only`). |
| `docs silence <group> [--ttl 4h]` | Silence stale-doc prompts in the current workspace. |
| `docs unsilence <group>` | Remove silenced-session entries. |
| `docs clear-stale <group>` | Wipe `.stale.md` + `stale.json`. |
| `docs mark-stale --stdin --group <g> ...` | Internal hook entry point. |
| `monorepo add [group] [path] [--modules ...]` | Detect a monorepo and pick modules to index. |
| `monorepo remove [group] [path] [--modules ...]` | Deselect modules. |
| `monorepo list` | List indexed modules across all groups. |
| `patch graphify` (or `patch apply`) | Apply repo_filter patch to graphify. |
| `patch status` | Show patch state (patched / partial / unpatched). |
| `patch revert` | Restore graphify from `.gfleet-orig` backup. |
| `help [advanced]` | Show command help. |

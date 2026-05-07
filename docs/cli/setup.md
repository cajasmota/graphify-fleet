# Setup commands

Commands that bring a new machine, a new group, or a new teammate online.

- [`gfleet wizard`](#gfleet-wizard) (alias: `new`)
- [`gfleet onboard`](#gfleet-onboard)
- [`gfleet install`](#gfleet-install)

See also: [operate.md](operate.md) for `update` / `doctor`,
[advanced.md](advanced.md) for the `skills` and `patch` machinery the wizard
also runs.

---

## `gfleet wizard`

```
gfleet wizard
gfleet new        # alias
```

Interactive first-time setup. Discovers git repos under a parent folder (or
accepts manual paths), auto-detects each stack, writes a fleet config to
`~/configs/<group>.fleet.json` (or `~/.config/gfleet/<group>.fleet.json` on
fresh machines), and offers to run `gfleet install` immediately.

### Prompts

| Prompt | Notes |
|--------|-------|
| Group name | letters/digits/`_`/`-` only |
| Add repos by | `discover` (parent folder + multiselect) or `manual` (comma-separated paths) |
| Per-repo slug + stack | optional review pass; defaults from filename + auto-detection |
| Features | `watchers`, `windsurf`, `claude_code`, `docs` (default: all on) |
| Group docs path | only asked if `docs` is selected |
| Save config to | defaults to `~/configs/<group>.fleet.json` if `~/configs` exists, else XDG path |
| Install now? | yes by default — runs `install` immediately |

### Auto-detected stacks

`react-native`, `node`, `python`, `go`, `generic`. Detection reads
`package.json`, `go.mod`, `requirements.txt` / `pyproject.toml` / `manage.py`
/ `setup.py`.

### Side effects

- Writes `<configDir>/<group>.fleet.json`.
- If `Install now?` is yes: runs everything `install` runs (see below).
- If the `docs` feature is selected: also installs the `/generate-docs`
  skill and writes a stub `~/.graphify-fleet/groups/<group>/docs-config.json`
  + creates the group docs folder.

### Examples

```bash
gfleet wizard          # full interactive run
gfleet new             # same thing, shorter
```

See also: [onboard](#gfleet-onboard) for teammates joining an existing group,
[install](#gfleet-install) for non-interactive installs.

---

## `gfleet onboard`

```
gfleet onboard [path]
```

Bootstraps a teammate after they `git clone` a repo that's part of a
gfleet-managed group. Walks up from `path` (default `.`) looking for
`.gfleet/group.json` (the manifest committed by the original `install`).

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `path` | no | `.` | Where to start the search for `.gfleet/group.json`. |

### Behavior

1. Locates the nearest `.gfleet/group.json` walking up the tree.
2. If the group is already registered AND this repo's path is already in the
   fleet config: offers to re-run `install` to refresh local state.
3. Otherwise, prompts for each sibling repo's path. If you paste a URL
   (containing `://` or ending in `.git`), or accept a `clone_url` from the
   manifest, it offers to `git clone` the sibling for you.
4. Writes a local fleet config to `~/.gfleet/<group>.fleet.json`.
5. Offers to run `install` immediately (default yes), then installs the
   `/generate-docs` skill.

### Side effects

- Reads (does not modify) `.gfleet/group.json`.
- May `git clone` sibling repos.
- Writes `~/.gfleet/<group>.fleet.json`.
- If install is confirmed: same effects as [install](#gfleet-install).

### Examples

```bash
cd ~/code/myapp-backend
gfleet onboard

gfleet onboard ~/code/myapp-backend
```

See also: [install](#gfleet-install), [setup.md](setup.md), and the
`writeGroupManifest` integration that produces the `.gfleet/group.json` file.

---

## `gfleet install`

```
gfleet install <config.json>
```

Install a fleet group from an explicit config. Normally invoked
**automatically** by `wizard`, `onboard`, and the `--refresh-rules` mode of
`update` — most users never type this directly.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `<config.json>` | yes | — | Path to the `*.fleet.json` to install. |

### Per-repo work

For every repo in the config:

1. Skip with a warning if `path` does not exist or has no `.git`.
2. Write `.graphifyignore` (stack-aware) and update `.gitignore`.
3. Build initial AST graph if `graphify-out/graph.json` is absent.
4. Write per-repo `.mcp.json` for Claude Code (one entry per repo + group).
5. If `claude_code` enabled: install the Claude skill + ensure `CLAUDE.md`
   and `AGENTS.md` rule blocks (idempotent, marker-wrapped).
6. If `windsurf` enabled: write `.windsurf/` workflow and rules.
7. Install git hooks (`post-commit`, `post-merge`, `post-checkout`) and the
   `union` merge driver — once per `.git` root (monorepo modules share).
8. If `watchers` enabled: install per-repo watcher (launchd / systemd /
   Scheduled Tasks).
9. Write `.gfleet/group.json` manifest (committed) for teammate onboarding.

After all repos: runs the per-group remerge helper at
`~/.local/bin/graphify-fleet-merge-<group>` to produce the merged
`<group>.json` graph, registers the group in `~/.graphify-fleet/registry.json`,
and (if windsurf) adds a global Windsurf MCP entry.

### Side effects (cumulative)

- Files: `<repo>/.graphifyignore`, `<repo>/.gitignore`, `<repo>/.mcp.json`,
  `<repo>/.gfleet/group.json`, `<repo>/.windsurf/...`, `<repo>/CLAUDE.md`,
  `<repo>/AGENTS.md`, `<repo>/graphify-out/graph.json`.
- Git: hooks at `<gitRoot>/.git/hooks/{post-commit,post-merge,post-checkout}`,
  `merge.union` driver entry in `.git/config`.
- Services: launchd plists / systemd `--user` units / Windows Scheduled Tasks.
- Global: `~/.graphify-fleet/registry.json`, `~/.graphify-fleet/groups/<group>.json`,
  `~/.local/bin/graphify-fleet-merge-<group>(.ps1)`.
- Patches: re-applies the graphify `repo_filter` patch via `ensureGraphify`.

### Examples

```bash
gfleet install ~/configs/upvate.fleet.json
gfleet install ./my-team.fleet.json
```

See also: [update](operate.md#gfleet-update) (`--refresh-rules` re-runs install
across every registered group), [uninstall](repair.md#gfleet-uninstall),
[doctor](operate.md#gfleet-doctor).

# Operate commands

Day-to-day commands for inspecting state and pulling updates. None of them
mutate per-repo graphs unless explicitly requested.

- [`gfleet update`](#gfleet-update)
- [`gfleet doctor`](#gfleet-doctor)
- [`gfleet status`](#gfleet-status)
- [`gfleet list`](#gfleet-list) (alias: `gfleet ls`)
- [`gfleet help`](#gfleet-help)

See also: [setup.md](setup.md), [repair.md](repair.md), [watchers.md](watchers.md).

---

## `gfleet update`

```bash
gfleet update [--refresh-rules] [--refresh-rules-lite] [--force]
```

Pulls the latest `graphify-fleet` repo (resolved via `ROOT_DIR`, normally
`~/.graphify-fleet`), runs `npm install` only when `package.json` /
`package-lock.json` changed, re-deploys the `/generate-docs` skill, and
verifies the graphify `repo_filter` patch state. Optionally re-applies fleet
rules across every registered group.

### Flags

| Flag | Description |
|------|-------------|
| `--refresh-rules` | After updating, re-runs full `install` against every registered group (rebuilds AST graphs, reinstalls watchers, re-applies rules + hooks + MCP). |
| `--refresh-rules-lite` | Lightweight: rewrites only `CLAUDE.md` / `AGENTS.md` blocks, `.windsurf/` files, `.mcp.json`, `.gfleet/group.json` manifests, and git hook block contents. Skips graph rebuilds, skill registration, watcher reinstalls, and the python install path. |
| `--force` | Discards local uncommitted changes in the gfleet install dir (`git reset --hard origin/<branch>`) before pulling. Without this, a dirty tree skips the pull and only re-deploys skills + patch. |

### Side effects

- `git fetch` + `git pull --ff-only` inside `ROOT_DIR`.
- `npm install` in `ROOT_DIR` (only on lockfile drift).
- Re-runs [`gfleet skills install`](advanced.md#gfleet-skills) (which re-applies the graphify patch).
- Verifies / re-applies the graphify `repo_filter` patch via `applyPatch`.
- With `--refresh-rules`: full `install()` per group (see [setup.md](setup.md#gfleet-install)).
- With `--refresh-rules-lite`: per-repo file rewrites only — see `refreshRulesLite()` in `src/update.js`.

### Examples

```bash
gfleet update
gfleet update --refresh-rules-lite
gfleet update --refresh-rules
gfleet update --force                 # discard local edits in ~/.graphify-fleet
```

See also: [`gfleet doctor`](#gfleet-doctor), [`gfleet skills`](advanced.md#gfleet-skills), [`gfleet patch`](advanced.md#gfleet-patch).

---

## `gfleet doctor`

```bash
gfleet doctor
```

Health check. Reports platform, Node version, presence of `git` and `uv`, the
graphify binary path + version (warns if it drifts from `GRAPHIFY_PIN`),
graphify python extras (`mcp` + `watchdog`), and the graphify patch state.
Then walks `~/.graphify-fleet/registry.json` and verifies every registered
repo path still exists and has a `.git`. Monorepo modules check both the
module path and the `monorepoRoot`.

### Output rows

| Check | Failure hint |
|-------|--------------|
| `git` / `uv` on `PATH` | install via OS package manager |
| `graphify` binary present | run `gfleet install` to install via `uv` |
| graphify version vs `GRAPHIFY_PIN` | run `gfleet install` to repin (re-applies patch) |
| graphify extras (`mcp`, `watchdog`) | `gfleet install` will fix |
| graphify patch state | `gfleet patch graphify` |
| group config exists | re-run `gfleet wizard` or edit `~/.graphify-fleet/registry.json` |
| repo path exists | `gfleet onboard` to remap, or edit `~/.gfleet/<group>.fleet.json` |
| `.git` exists at git root | `gfleet onboard` to remap |
| monorepo root exists (modules only) | edit the fleet config |

### Side effects

None. Read-only.

### Examples

```bash
gfleet doctor
```

See also: [`gfleet status`](#gfleet-status), [`gfleet patch status`](advanced.md#gfleet-patch).

---

## `gfleet status`

```bash
gfleet status [group]
```

Per-group: prints the group name, merged graph path
(`~/.graphify-fleet/groups/<group>.json`), node + edge counts, and watcher
state for every repo. With no argument, fans out across every registered
group.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |

### Watcher state values

`running`, `idle`, `failed`, `not-installed`, `unsupported` (see
`watcherStatus()` in `src/watchers.js`).

### Side effects

None. Calls `launchctl list` / `systemctl --user is-active` /
`Get-ScheduledTask` to read state.

### Examples

```bash
gfleet status
gfleet status upvate
gfleet status ~/configs/upvate.fleet.json
```

See also: [`gfleet doctor`](#gfleet-doctor), [`gfleet list`](#gfleet-list), [watchers.md](watchers.md).

---

## `gfleet list`

```bash
gfleet list
gfleet ls          # alias
```

Tabular list of every registered group: name, node count of the merged graph,
and the registered config path. A `!` prefix on the path means the file is no
longer at the registered location (re-run `gfleet wizard` or edit the
registry to fix).

### Side effects

None. Reads `~/.graphify-fleet/registry.json` and the per-group merged graph
files at `~/.graphify-fleet/groups/<group>.json`.

### Examples

```bash
gfleet list
gfleet ls
```

See also: [`gfleet status`](#gfleet-status).

---

## `gfleet help`

```bash
gfleet help [advanced]
gfleet -h
gfleet --help
```

Shows the primary help (5 sections). Pass `advanced`, `--advanced`, or
`--all` for the full command listing — that includes the `skills`,
`conventions`, `patch`, `monorepo`, and `docs` namespaces.

### Examples

```bash
gfleet help
gfleet help advanced
gfleet --help
```

When invoked with no args and at least one group is registered, gfleet prints
the `list` view instead of help — see `showRegistryOrHelp()` in `src/cli.js`.

See also: [README](README.md).

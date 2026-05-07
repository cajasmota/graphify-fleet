# Repair commands

Use these when graphs look wrong (deletions not reflected, merge missed a
repo) or when removing gfleet from a group entirely.

- [`gfleet rebuild`](#gfleet-rebuild)
- [`gfleet reset`](#gfleet-reset)
- [`gfleet remerge`](#gfleet-remerge)
- [`gfleet uninstall`](#gfleet-uninstall)

See also: [operate.md](operate.md) for `status` / `doctor`,
[setup.md](setup.md) for re-installing.

---

## `gfleet rebuild`

```bash
gfleet rebuild [group] [slug]
```

For every repo in the group (or just the one matching `slug`), runs
`graphify update .` with `GRAPHIFY_FORCE=1` set. After per-repo work, runs
the per-group remerge helper at
`~/.local/bin/graphify-fleet-merge-<group>` (PowerShell `.ps1` on Windows).
Does NOT delete `graphify-out/` first — use [`reset`](#gfleet-reset) for that.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |
| `slug` | no | `all` | Per-repo `slug` from the fleet config. Restricts to one repo. |

### Side effects

- Per repo: `graphify update .` with `GRAPHIFY_FORCE=1` (forces re-extraction; honors `.graphifyignore`).
- Group: re-runs the merge helper, overwriting `~/.graphify-fleet/groups/<group>.json`.

### Examples

```bash
gfleet rebuild
gfleet rebuild upvate
gfleet rebuild upvate upvate-core
```

See also: [`gfleet reset`](#gfleet-reset) (also wipes `graphify-out/`),
[`gfleet remerge`](#gfleet-remerge) (skips per-repo step).

---

## `gfleet reset`

```bash
gfleet reset [group] [slug]
```

Like `rebuild` but first deletes `<repo>/graphify-out/` for each affected
repo before running `graphify update .`. Use after a merge gone wrong, a
graphify schema bump, or when an untracked file polluted the cache.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |
| `slug` | no | `all` | Per-repo `slug` from the fleet config. Restricts to one repo. |

### Side effects

- Per repo: `rm -rf <repo>/graphify-out/`, then `graphify update .`.
- Group: re-runs the merge helper.
- Hint at the end: run `/graphify .` in your IDE for full LLM-assisted extraction (docs / wiki / "why" comments).

### Examples

```bash
gfleet reset upvate
gfleet reset upvate upvate-core
```

See also: [`gfleet rebuild`](#gfleet-rebuild), [`gfleet remerge`](#gfleet-remerge).

---

## `gfleet remerge`

```bash
gfleet remerge [group]
```

Re-runs only the group merge helper at
`~/.local/bin/graphify-fleet-merge-<group>`. No per-repo work. Use when a
single repo's `graph.json` was rebuilt out-of-band (e.g. by an IDE-driven
`graphify update`) and the merged group graph is stale.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

- Overwrites `~/.graphify-fleet/groups/<group>.json`.
- On POSIX, ensures the helper has the owner-execute bit set; falls back to running via `bash` if `ENOEXEC` shows up.

### Examples

```bash
gfleet remerge
gfleet remerge upvate
```

See also: [`gfleet rebuild`](#gfleet-rebuild).

---

## `gfleet uninstall`

```bash
gfleet uninstall [group] [--purge]
```

Removes git hooks, the union merge driver, per-repo `.mcp.json` entries,
`.windsurf/` files, the `.gfleet/group.json` manifest, watchers, the
remerge helper, the merged group graph, and any global Windsurf MCP entry
for the group. Then unregisters the group from
`~/.graphify-fleet/registry.json`.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |
| `--purge` | no | off | Also `rm -rf <repo>/graphify-out/` per repo. Default keeps per-repo graphs intact for fast reinstall. |

### Side effects

- Per repo: removes hooks block from `.git/hooks/post-commit`, `post-merge`, `post-checkout`; removes `merge.union` driver from `.git/config`; removes the `.mcp.json` entry for this group; removes `.windsurf/` files; removes `.gfleet/group.json`; uninstalls the watcher.
- With `--purge`: deletes `<repo>/graphify-out/`.
- Global: deletes `~/.local/bin/graphify-fleet-merge-<group>` (and `.ps1`), the merged graph file, the Windsurf global MCP entry, and the registry record.
- Does NOT remove the source `*.fleet.json` config — delete that yourself if desired.

### Examples

```bash
gfleet uninstall upvate
gfleet uninstall upvate --purge
gfleet uninstall                       # uninstalls EVERY registered group
```

See also: [`gfleet install`](setup.md#gfleet-install), [`gfleet stop`](watchers.md#gfleet-stop).

# Monorepo commands

Pick which packages inside a monorepo (pnpm / npm workspaces / Nx / turbo /
Lerna / multi-package layouts) get indexed into a fleet group. Modules
share their parent's `.git`, so hooks and the union merge driver are
installed once at the monorepo root.

- [`gfleet monorepo add`](#gfleet-monorepo-add)
- [`gfleet monorepo remove`](#gfleet-monorepo-remove)
- [`gfleet monorepo list`](#gfleet-monorepo-list)

See also: [setup.md](setup.md) for `install` (re-runs after every selection
change), [docs.md](docs.md) for how stale tracking handles
longest-prefix monorepo subdir matching.

---

## Detection

`detectMonorepo()` in `src/monorepo.js` looks for, in order:

1. `pnpm-workspace.yaml` (kind: `pnpm`)
2. `package.json` `workspaces` (kind: `npm-workspaces`)
3. `nx.json` (kind: `nx`)
4. `turbo.json` (kind: `turbo`)
5. `lerna.json` (kind: `lerna`)
6. Multi-package layout: 2+ subdirs with `package.json` / `pyproject.toml` / `go.mod` (kind: `multi-package`, depth 2)

If none match, [`gfleet monorepo add`](#gfleet-monorepo-add) exits with a
hint to edit the fleet config directly:

```json
{ "type": "monorepo", "path": "/abs/path", "modules": [{ "path": "packages/api", "stack": "node" }] }
```

---

## `gfleet monorepo add`

```bash
gfleet monorepo add [group] [path] [--modules m1,m2,...]
```

Detects the monorepo at `path` and writes selected modules into the group's
fleet config. Asks `gfleet install <group>` to apply on confirmation.

### Args + flags

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | prompt | Registered group name. |
| `path` | no | prompt | Absolute or `~`-prefixed path to the monorepo root. |
| `--modules a,b,c` | no | interactive multiselect | Comma-separated module rel-paths (relative to monorepo root). When passed, runs non-interactively. |

### Behavior

1. Resolves the group config from `~/.graphify-fleet/registry.json`.
2. Runs `detectMonorepo()`. Aborts with a hint if no layout matches.
3. Computes `alreadyIndexed` (existing module paths under this monorepo entry).
4. Either uses `--modules` or shows an interactive multiselect of modules with stack + LOC estimates.
5. Diffs against `alreadyIndexed`: computes `newModules` (added) and `removedModules` (deselected).
6. Writes the updated config back; prompts to run `gfleet install <group>` immediately.

### Side effects

- Mutates the `*.fleet.json` config (`type: "monorepo"` repo entry's `modules` array).
- On confirm: runs full `install()` (see [setup.md](setup.md#gfleet-install)).

### Examples

```bash
gfleet monorepo add
gfleet monorepo add upvate
gfleet monorepo add upvate ~/code/upvate-monorepo
gfleet monorepo add upvate ~/code/upvate-monorepo --modules packages/api,packages/web
```

See also: [`gfleet monorepo remove`](#gfleet-monorepo-remove), [`gfleet monorepo list`](#gfleet-monorepo-list).

---

## `gfleet monorepo remove`

```bash
gfleet monorepo remove [group] [path] [--modules m1,m2,...]
```

Deselect modules from a registered monorepo. Watchers and per-module files
for removed modules are NOT auto-cleaned — re-run `gfleet install <group>`
to apply (incremental) or `gfleet uninstall <group>` for a full teardown
before re-adding.

### Args + flags

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | prompt | Registered group name. |
| `path` | no | prompt or only-monorepo | Absolute path to the monorepo root. If the group has exactly one monorepo, defaults to it. |
| `--modules a,b,c` | no | interactive multiselect | Comma-separated module rel-paths to remove. |

### Side effects

- Mutates the `*.fleet.json` config (drops modules from the monorepo entry).
- On confirm: re-runs `install()`. Watchers and per-module artifacts for the dropped modules persist until you `gfleet uninstall` and reinstall.

### Examples

```bash
gfleet monorepo remove
gfleet monorepo remove upvate ~/code/upvate-monorepo --modules packages/legacy
```

See also: [`gfleet uninstall`](repair.md#gfleet-uninstall).

---

## `gfleet monorepo list`

```bash
gfleet monorepo list
```

Per registered group, prints every monorepo entry with `indexed / available`
counts and a checkmark line per indexed module showing its `slug` and
detected `stack`. Read-only.

### Side effects

None. Re-runs `detectMonorepo()` against each known monorepo path to compute
the available count.

### Examples

```bash
gfleet monorepo list
```

See also: [`gfleet status`](operate.md#gfleet-status), [`gfleet list`](operate.md#gfleet-list).

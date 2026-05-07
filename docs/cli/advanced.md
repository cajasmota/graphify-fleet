# Advanced commands

Power-user surface area. These run automatically as part of `gfleet wizard`
/ `gfleet update` / `gfleet install`. Reach for them when something needs
manual repair or when extending support for a new stack.

- [`gfleet skills`](#gfleet-skills)
- [`gfleet conventions`](#gfleet-conventions)
- [`gfleet patch`](#gfleet-patch)
- [Environment variables](#environment-variables)
- [Hidden behaviors](#hidden-behaviors)

See also: [docs.md](docs.md), [setup.md](setup.md).

---

## `gfleet skills`

```bash
gfleet skills {install|uninstall|update|status}
```

Manages the `/generate-docs` skill (and its companion `/extend-convention`)
across Claude Code (`~/.claude/skills/`) and Windsurf
(`~/.codeium/windsurf/skills/`), plus per-repo Windsurf workflow files at
`<repo>/.windsurf/workflows/generate-docs.md`. Auto-applies the graphify
`repo_filter` patch as part of `install`.

### Subcommands

| Subcommand | Behavior |
|------------|----------|
| `install` | Copies the skill to Claude Code + Windsurf user dirs; writes the slash command at `~/.claude/commands/generate-docs.md`; mirrors workflow file into every registered repo's `.windsurf/workflows/`; installs `extend-convention` likewise; runs `applyGraphifyPatch()`. |
| `uninstall` | Removes Claude / Windsurf skill dirs + slash command + workflow files for both skills. Does NOT revert the graphify patch — use `gfleet patch revert` for that. |
| `update` | Alias for `install` — re-copies from the local `graphify-fleet` repo. |
| `status` | Shows checkmarks for Claude Code skill, Claude slash command, Windsurf skill, and per-repo workflow file presence. |

### Side effects

- Writes / removes:
  - `~/.claude/skills/generate-docs/`
  - `~/.claude/commands/generate-docs.md`
  - `~/.codeium/windsurf/skills/generate-docs/`
  - `~/.claude/skills/extend-convention/`, `~/.codeium/windsurf/skills/extend-convention/`
  - `<repo>/.windsurf/workflows/generate-docs.md` per registered repo
- `install` / `update` calls `applyGraphifyPatch()`.

### Examples

```bash
gfleet skills install
gfleet skills status
gfleet skills uninstall
```

See also: [`gfleet patch`](#gfleet-patch), [docs.md](docs.md).

---

## `gfleet conventions`

```bash
gfleet conventions {list|add|remove} [--name <stack>] [--base <existing>]
```

Adds new framework support to `/generate-docs` without forking the repo.
Conventions are mirrored to **both** Claude Code and Windsurf user skill
dirs so either IDE picks them up.

### Subcommands

| Subcommand | Behavior |
|------------|----------|
| `list` | Lists built-in conventions (from `skills/generate-docs/conventions/` in the gfleet repo) and any user-added ones. User entries show which IDE they're installed in. |
| `add` | Prompts for a stack identifier and a base convention to seed from. With `--name X`, runs non-interactive. Default mode writes a stub primed for `/extend-convention <stack>` to fill in via the AI IDE. Pure-copy mode just clones a base convention for manual editing. Warns on near-duplicate names (Levenshtein distance ≤ 1). |
| `remove` | Removes a user-added convention from both Claude Code and Windsurf. Built-in conventions cannot be removed via this command — edit the gfleet repo. |

### Flags

| Flag | Subcommand | Description |
|------|------------|-------------|
| `--name X` | `add`, `remove` | Non-interactive stack identifier. Lowercase, kebab-case. |
| `--base X` | `add` | Existing built-in convention to seed from (e.g. `django`, `node`). |

### Side effects

- Writes / removes:
  - `~/.claude/skills/generate-docs/conventions/<stack>.md`
  - `~/.codeium/windsurf/skills/generate-docs/conventions/<stack>.md`

### Examples

```bash
gfleet conventions list
gfleet conventions add --name elixir --base node
gfleet conventions remove --name elixir
```

See also: [`gfleet skills`](#gfleet-skills).

---

## `gfleet patch`

```bash
gfleet patch {graphify|status|revert}
gfleet patch apply         # alias for `patch graphify`
```

Applies the gfleet patch to the installed graphify package: adds a
`repo_filter` parameter to graphify's `query_graph` / `get_neighbors` /
`shortest_path` MCP tools so a single MCP server can scope per-repo. Patch
state is tracked at `~/.graphify-fleet/patch-state.json` and is keyed on the
graphify install path so `uv tool` upgrades are detected.

### Subcommands

| Subcommand | Behavior |
|------------|----------|
| `graphify` (or `apply`) | Apply the `repo_filter` patch (idempotent). Re-runs auto on `gfleet skills install`, `gfleet update`, and `ensureGraphify()`. |
| `status` | Reports state: `no-graphify`, `unpatched`, `partial` (some hunks applied; graphify upstream may have changed), or `patched` (`<applied>/<total>` hunks). |
| `revert` | Restores graphify from the `.gfleet-orig` backup. |

### Side effects

- `apply`: edits the graphify Python source in place; takes a `.gfleet-orig` backup if not already present; updates `~/.graphify-fleet/patch-state.json`.
- `revert`: copies `.gfleet-orig` back over the patched file.

### Examples

```bash
gfleet patch status
gfleet patch graphify
gfleet patch revert
```

Note: only `graphify` is a valid target. Any other target argument exits
with an error (see the `target && target !== 'graphify'` guard in
`src/cli.js`).

See also: [`gfleet doctor`](operate.md#gfleet-doctor) (reports patch state).

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GFLEET_DEBUG` | When set, prints full stack traces from the dispatcher's catch block instead of just the message. |
| `GRAPHIFY_FORCE` | Set to `1` by `gfleet rebuild`; consumed by `graphify update .` to force re-extraction. |
| `XDG_CACHE_HOME` | When set, gfleet caches go to `$XDG_CACHE_HOME/graphify-fleet/` instead of `~/.cache/graphify-fleet/`. |
| `HOME` / `USERPROFILE` | Resolved via `HOME` constant in `src/util.js`. |

---

## Hidden behaviors

### Bare `gfleet` invocation

With no arguments, gfleet runs `showRegistryOrHelp()`: if at least one
group is registered, it prints the [`list`](operate.md#gfleet-list) view;
otherwise it prints primary [`help`](operate.md#gfleet-help).

### Argument resolution

Most commands accept either a registered group **name** or an explicit
path to a `*.fleet.json` config — `resolveConfigArg()` in `src/util.js`
disambiguates. Omitting the argument fans out across every config in
`~/.graphify-fleet/registry.json` (see `applyToOneOrAll()` in `src/cli.js`).

### `wizard` alias

`gfleet new` is a synonym for `gfleet wizard` (see the `case 'wizard': case 'new':` line in `src/cli.js`).

### `list` alias

`gfleet ls` is a synonym for `gfleet list`.

### Deprecated `docs init`

`gfleet docs init` exits with a deprecation pointer to `/generate-docs --setup-only`
or [`gfleet docs init-cli`](docs.md#gfleet-docs-init-cli).

### Patch state JSON

`~/.graphify-fleet/patch-state.json` records `{ graphifyy_version, applied_at }`
per patched path. Version mismatch on a subsequent apply triggers a
backup re-take.

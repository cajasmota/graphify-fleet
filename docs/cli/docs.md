# Docs commands

Drive the `/generate-docs` skill from the terminal: query state, surface
where the configured group docs path lives, manage stale-doc prompts.
Most users invoke `/generate-docs` from inside Claude Code or Windsurf —
these CLI commands are the supporting machinery (status reads, hook
plumbing, silencing).

- [`gfleet docs status`](#gfleet-docs-status)
- [`gfleet docs run`](#gfleet-docs-run)
- [`gfleet docs path`](#gfleet-docs-path)
- [`gfleet docs init-cli`](#gfleet-docs-init-cli)
- [`gfleet docs silence`](#gfleet-docs-silence)
- [`gfleet docs unsilence`](#gfleet-docs-unsilence)
- [`gfleet docs clear-stale`](#gfleet-docs-clear-stale)
- [`gfleet docs mark-stale`](#gfleet-docs-mark-stale-internal) (internal)
- [`/generate-docs` skill flags](#generate-docs-skill-flags)

See also: [advanced.md](advanced.md) for `gfleet skills` (which installs the
skill itself) and `gfleet conventions` (which extends per-stack rules).

---

## `gfleet docs status`

```bash
gfleet docs status [group]
```

Per-group: prints the docs config path
(`~/.graphify-fleet/groups/<group>/docs-config.json`), the configured
`group_docs_path`, and a per-repo line showing stale-section count + last
generation timestamp from `<repo>/docs/.metadata.json`. With no argument,
fans out across every registered group.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

None. Reads `<repo>/docs/.stale.md`, `<repo>/docs/.metadata.json`, and
`docs-config.json`.

### Examples

```bash
gfleet docs status
gfleet docs status upvate
```

See also: [`gfleet docs path`](#gfleet-docs-path).

---

## `gfleet docs run`

```bash
gfleet docs run <group>
```

Prints the `/generate-docs` invocation hints for the group: the list of
repo paths and the most useful skill flags. Does not invoke the agent —
the skill must be triggered from Claude Code or Windsurf.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | yes | — | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

None. Output-only.

### Examples

```bash
gfleet docs run upvate
```

See also: [`/generate-docs` flags](#generate-docs-skill-flags).

---

## `gfleet docs path`

```bash
gfleet docs path <group>
```

Prints the configured `group_docs_path` from the group's `docs-config.json`,
or `(no group docs path)` if unset. Useful for shell snippets:

```bash
cd "$(gfleet docs path upvate)"
```

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | yes | — | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

None.

### Examples

```bash
gfleet docs path upvate
```

---

## `gfleet docs init-cli`

```bash
gfleet docs init-cli <group>
```

Headless CLI Q&A that writes a `docs-config.json` for the group. Prefer
running `/generate-docs --setup-only` from your IDE — it seeds answers from
the codebase, while `init-cli` only does plain prompts. The deprecated
`gfleet docs init` exits with a hint pointing here or at the IDE flow.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | yes | — | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

- Writes `~/.graphify-fleet/groups/<group>/docs-config.json`.

### Examples

```bash
gfleet docs init-cli upvate
```

See also: `/generate-docs --setup-only`.

---

## `gfleet docs silence`

```bash
gfleet docs silence <group> [--ttl <duration>]
```

Suppresses stale-doc prompts in the **current workspace** (`process.cwd()`)
for a bounded duration. Hooks still write `.stale.md` — silencing only tells
the agent rule to ignore it for this session. Per-cwd, not per-IDE.

### Args + flags

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | yes | — | Registered group name OR explicit `*.fleet.json` path. |
| `--ttl` | no | `4h` | Duration: bare seconds, or `<n>{s\|m\|h\|d}`. Examples: `30m`, `2h`, `1d`, `3600`. |

### Side effects

- Writes `~/.cache/graphify-fleet/<group>/silenced-sessions.json` (or `$XDG_CACHE_HOME/...`).
- Each entry: `{ workspace, started_at, ttl_seconds }`. Expired entries are pruned on every silence/unsilence call.

### Examples

```bash
gfleet docs silence upvate
gfleet docs silence upvate --ttl 30m
gfleet docs silence upvate --ttl 1d
```

See also: [`gfleet docs unsilence`](#gfleet-docs-unsilence), [`gfleet docs clear-stale`](#gfleet-docs-clear-stale).

---

## `gfleet docs unsilence`

```bash
gfleet docs unsilence <group>
```

Removes any silenced-session entries that match the current workspace
(`process.cwd()`). Other workspaces' silences are untouched. Deletes the
`silenced-sessions.json` file when no entries remain.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | yes | — | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

- Mutates or deletes `~/.cache/graphify-fleet/<group>/silenced-sessions.json`.

### Examples

```bash
gfleet docs unsilence upvate
```

See also: [`gfleet docs silence`](#gfleet-docs-silence).

---

## `gfleet docs clear-stale`

```bash
gfleet docs clear-stale <group>
```

Wipes `<repo>/docs/.stale.md` and the cache mirror at
`~/.cache/graphify-fleet/<group>/<slug>/stale.json` for every repo in the
group. Use after manually verifying that flagged sections are still
accurate, without re-running `/generate-docs --refresh`.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | yes | — | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

- Deletes `<repo>/docs/.stale.md` per repo.
- Deletes `~/.cache/graphify-fleet/<group>/<slug>/stale.json` per repo.

### Examples

```bash
gfleet docs clear-stale upvate
```

See also: [`gfleet docs silence`](#gfleet-docs-silence).

---

## `gfleet docs mark-stale` (internal)

```bash
gfleet docs mark-stale --stdin --group <name> [--hook <h>] [--range <a..b>] [--repo <slug>]
```

Internal entry point invoked by the `post-commit` / `post-merge` /
`post-checkout` git hooks installed by `gfleet install`. Reads
newline-delimited changed file paths from stdin, maps them to documentation
sections via `<repo>/docs/.metadata.json` (Phase 1) and the merged group
graph (Phase 2 fallback), and writes `<repo>/docs/.stale.md` plus a cache
mirror at `~/.cache/graphify-fleet/<group>/<slug>/stale.json`. Not intended
for direct use.

### Flags

| Flag | Description |
|------|-------------|
| `--group <name>` | Required. Registered group. |
| `--hook <name>` | `post-commit` (default), `post-merge`, or `post-checkout`. |
| `--range <a..b>` | Informational; recorded in the output. |
| `--repo <slug>` | Limit to one repo within the group. |
| `--stdin` | Read changed paths from stdin. Without this, no paths are read. |

### Side effects

- Atomic write of `<repo>/docs/.stale.md` (markered markdown block).
- Atomic write of `~/.cache/graphify-fleet/<group>/<slug>/stale.json`.

---

## `/generate-docs` skill flags

These are not gfleet CLI commands — they are flags consumed by the
`/generate-docs` skill inside Claude Code / Windsurf. Listed here so the
full surface area is in one place. The authoritative source is the
[`generate-docs`](../../skills/generate-docs/) skill directory.

| Flag | Behavior |
|------|----------|
| `/generate-docs` | Full repo run, interactive plan-then-write. |
| `/generate-docs --autonomous` | Skip the plan confirmation; uses cached config. |
| `/generate-docs --refresh` | Only regenerate sections listed in `<repo>/docs/.stale.md`. |
| `/generate-docs --group` | Group-level synthesis after per-repo docs exist. |
| `/generate-docs --section <path>` | Regenerate one section file. |
| `/generate-docs --module <name>` | Regenerate every artifact for one module. |
| `/generate-docs --since <gitref>` | Treat all files changed since `<gitref>` as stale. |
| `/generate-docs --all` | Every repo + group synthesis (Claude Code; uses subagents). |
| `/generate-docs --setup-only` | Run the domain Q&A and write `docs-config.json`, then stop. |

See also: [advanced.md](advanced.md#gfleet-skills) for installing the skill,
[advanced.md](advanced.md#gfleet-conventions) for extending per-stack rules.

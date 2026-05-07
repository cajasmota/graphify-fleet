# graphify-fleet (gfleet)

Orchestrate [graphify](https://github.com/safishamsi/graphify) across **multiple related repos** (a "group"). Keeps each repo's knowledge graph current, merges them into a single cross-repo graph for AI assistants to query, and generates module-organized documentation with cross-repo links.

Built for codebases that span more than one repo — backend + frontend + mobile + infra, or microservice fleets, or monorepos with selectable modules.

## Quick path (install → docs in ~5 minutes)

```bash
# 1. Install (mac/linux)
curl -fsSL https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.sh | bash

# 2. Set up your repos (interactive)
gfleet wizard

# 3. Open one of your repos in Claude Code or Windsurf and run:
/generate-docs
```

Windows: replace step 1 with `irm https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.ps1 | iex`.

---

## What you'll never type again

After `gfleet wizard`, you should rarely touch gfleet again. Everything below happens automatically:

- **Graphs stay current.** File watchers (launchd / systemd / Scheduled Tasks) rebuild on save; post-commit hooks rebuild on commit; the merge driver union-merges parallel `graph.json` commits.
- **Docs staleness is tracked for you.** Post-commit / post-merge / post-checkout hooks update `docs/.stale.md` automatically. Your IDE agent reads it and surfaces stale sections when you ask about affected code or wrap up a task — you never have to remember.
- **graphify patches re-apply themselves.** Every `gfleet update` (and any `ensureGraphify`) re-runs the `repo_filter` patch after `uv` reinstalls graphify, so MCP tooling stays consistent.
- **Skill / agent-rule updates land via `gfleet update`.** That single command picks up new gfleet behavior across every registered group; rules blocks are marker-wrapped and idempotent.
- **Onboarding is a single command for teammates.** They run `gfleet onboard` after `git clone`; the merge driver, watchers, MCP, and rules are all configured for them.

Day-to-day, you mostly talk to your IDE agent. The agent surfaces what needs attention (stale docs, monorepo drift, missing setup) — gfleet itself stays out of the way.

---

## Table of contents

1. [Requirements](#requirements)
2. [Install](#install)
3. [Quick start (single dev)](#quick-start-single-dev)
4. [Quick start (teammate joining)](#quick-start-teammate-joining)
5. [Concepts](#concepts)
6. [Config schema](#config-schema)
7. [The `.gfleet/group.json` manifest](#the-gfleetgroupjson-manifest)
8. [Multi-dev workflow](#multi-dev-workflow)
9. [Generated docs](#generated-docs)
10. [Troubleshooting](#troubleshooting)
11. [Commands reference (appendix)](#commands-reference-appendix)

---

## Requirements

| Tool | Version |
|------|---------|
| Node | 18.19+ (gfleet CLI) |
| Python | 3.10+ (graphify) |
| [uv](https://docs.astral.sh/uv/) | latest (installs graphify in an isolated venv) |
| git | any |

`gfleet doctor` checks all of these and reports patch + version status.

---

## Install

### One-line install (recommended)

**macOS / Linux**:
```bash
curl -fsSL https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.sh | bash
```

**Windows (PowerShell)**:
```powershell
irm https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.ps1 | iex
```

The installer verifies prerequisites (installing missing ones via fnm / winget / Astral), clones to `~/.graphify-fleet`, runs `npm install`, places a `gfleet` shim on PATH (`~/.local/bin/gfleet` or `gfleet.cmd`), and runs `gfleet doctor`. Re-run anytime to update — idempotent.

### Manual install

```bash
git clone https://github.com/cajasmota/graphify-fleet.git ~/.graphify-fleet
cd ~/.graphify-fleet
npm install
ln -s ~/.graphify-fleet/bin/gfleet ~/.local/bin/gfleet     # macOS / Linux
# Windows PowerShell: add bin\ to user PATH manually
gfleet doctor
```

### Custom install location

```bash
curl -fsSL https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.sh | bash -s -- --dir ~/tools/gfleet --branch dev
```

---

## Quick start (single dev)

```bash
gfleet wizard
```

The wizard asks for a group name, discovers or accepts repo paths (drag-drop from Finder works), auto-detects each repo's stack, lets you toggle features, writes `~/configs/<group>.fleet.json`, and runs the full install (graphs, watchers, hooks, MCP, agent rules, optional skill).

After it finishes: watchers run on save and on commit, the graph is queryable in Claude Code / Windsurf via `graphify-<group>` MCP, and `/generate-docs` works in your IDE if you enabled docs.

---

## Quick start (teammate joining)

A teammate set things up; you cloned a repo with `.gfleet/group.json` committed.

```bash
cd ~/code/myapp-backend     # whichever repo you cloned
gfleet onboard
```

`gfleet onboard` reads the manifest, prompts for sibling-repo paths (or `git clone`s them if `clone_url` is set), writes `~/.gfleet/<group>.fleet.json`, and runs `gfleet install` — registering the merge driver locally, building graphs, wiring MCP, starting watchers, and installing the `generate-docs` skill globally.

---

## Concepts

### Group

A set of related repos sharing a merged graph. Each repo belongs to one group; groups are isolated.

### Repo vs monorepo module

A "repo" entry is either a **standalone repo** (own `.git`) or a **monorepo** with selected `modules` — each module is a virtual repo (own graph, watcher, MCP entry) sharing the parent's `.git` (one merge-driver registration, one set of hooks). See [Monorepo commands](#monorepo).

### Per-repo MCP + group MCP

Two MCP servers are registered in Claude Code's per-project `.mcp.json`:

- `graphify-<repo-slug>` — only this repo's graph.
- `graphify-<group>` — the merged group graph.

Windsurf (global config) gets only the **group MCP** to avoid tool-name collisions; repo-local filtering uses the `repo_filter` parameter.

### `repo_filter` parameter (graphify patch)

graphify's MCP tools don't natively accept `repo_filter`. gfleet ships an idempotent patch (`gfleet patch graphify`) that adds it:

```
graphify-<group>.query_graph(question, repo_filter="<repo-slug>")
```

Restricts BFS/DFS to that repo's nodes, so one MCP serves both repo-local and cross-repo queries. Auto-applied during `gfleet skills install`; reverted by `gfleet patch revert`. `gfleet doctor` warns if a graphify upgrade lost the patch.

### Closed-loop knowledge via `save-result`

Agents call `graphify save-result` to persist non-trivial findings (cross-repo HTTP boundaries, emergent behavior, complex queries). gfleet's agent rules **dual-save** to `<repo>/graphify-out/memory/` and `~/.graphify/groups/<group>-memory/` so findings show up in both per-repo and group MCPs.

### Merge driver (multi-dev safety)

gfleet registers a git merge driver in `.git/config` and `.gitattributes` so concurrent `graph.json` commits union-merge instead of producing conflict markers. `.gitattributes` is committed; `.git/config` is per-clone (teammates run `gfleet onboard`). See [Multi-dev workflow](#multi-dev-workflow).

### Generate-docs skill

Adds `/generate-docs` to Claude Code and Windsurf — module-organized markdown, VitePress site, dual-saved findings. See [Generated docs](#generated-docs).

---

## Config schema

A fleet config is a JSON file, one per group. See `examples/myapp.fleet.json` and `examples/monorepo.fleet.json`.

```json
{
  "group": "myapp",
  "repos": [
    {
      "path": "~/Code/myapp/api",
      "slug": "myapp-backend",
      "stack": "python"
    },
    {
      "path": "~/Code/myapp/web",
      "slug": "myapp-frontend",
      "stack": "node"
    },
    {
      "type": "monorepo",
      "path": "~/Code/myapp/services",
      "modules": [
        { "path": "packages/auth",    "slug": "myapp-auth",    "stack": "go" },
        { "path": "packages/billing", "slug": "myapp-billing", "stack": "go" }
      ]
    }
  ],
  "options": {
    "wiki_gitignored": true,
    "watchers": true,
    "windsurf": true,
    "claude_code": true
  },
  "docs": {
    "enabled": true,
    "group_docs_path": "~/Code/myapp/docs"
  }
}
```

**Stack values** (free-form — drives `.graphifyignore` template choice and per-stack documentation conventions):

- `.graphifyignore` templates ship for: `react-native`, `node`, `python`, `go`, `generic`. Any other value falls back to the `generic` ignore template.
- Documentation conventions ship for: `react-native`, `node`, `python`, `python-generic`, `django`, `go`, `infra-terraform`, `infra-cdk`, `generic`. Add more with `gfleet conventions add`.
- A stack value may be anything (e.g. `elixir`, `dotnet`); the ignore template will fall back to `generic` and the docs skill will use whichever convention matches by name.

**Repo entry types**: default (no `type`) is a standalone repo; `type: "monorepo"` requires a `modules` array.

**Options**:
- `wiki_gitignored` — adds `graphify-out/wiki/` to `.gitignore` (recommended).
- `watchers` — installs the per-repo file watcher.
- `windsurf` — writes Windsurf workflow + rules.
- `claude_code` — writes CLAUDE.md rules + per-project `.mcp.json` + PreToolUse hook.

**Docs**:
- `enabled` — install the generate-docs skill globally (per-machine, idempotent).
- `group_docs_path` — where Pass 7 (group synthesis) writes cross-repo docs. Defaults to the parent of the repos.

---

## The `.gfleet/group.json` manifest

Each repo gets a `.gfleet/group.json` written by `gfleet install`. **Commit it** — teammates use it for `gfleet onboard`.

```json
{
  "version": 1,
  "group": "myapp",
  "this": {
    "slug": "myapp-backend",
    "stack": "python"
  },
  "siblings": [
    { "slug": "myapp-frontend", "stack": "node",         "clone_url": null },
    { "slug": "myapp-mobile",   "stack": "react-native", "clone_url": null }
  ],
  "options": {
    "wiki_gitignored": true,
    "watchers": true,
    "windsurf": true,
    "claude_code": true,
    "docs": { "enabled": true }
  }
}
```

Portable — no absolute paths. `clone_url` is optional; gfleet preserves manual edits across re-runs, and `gfleet onboard` will `git clone` siblings the teammate doesn't have.

---

## Multi-dev workflow

graphify v0.7.0 added merge-conflict safety for `graph.json` via a git merge driver; gfleet automates the setup.

`gfleet wizard` (or `gfleet install`) registers the driver in each repo's `.git/config` and writes `.gitattributes`. **Commit `.gitattributes`.** Teammates run [`gfleet onboard`](#quick-start-teammate-joining) after cloning to register the driver locally.

### What "no more conflicts" looks like

Two parallel commits no longer produce:

```
<<<<<<< HEAD
{ "nodes": [...your version...] }
=======
{ "nodes": [...their version...] }
>>>>>>> origin/main
```

You get a clean union-merged `graph.json`. graphify v0.7.0 also seeded community detection so identical code produces identical community IDs across rebuilds — no spurious diffs.

### Graph freshness

`graph.json` records its source commit. Agent rules tell AI assistants to compare against `git rev-parse HEAD` before answering architecture questions and suggest `graphify update .` if stale. The watcher should already be doing this — check `~/.cache/graphify-fleet/<group>/<slug>.log`.

---

## Generated docs

After `gfleet skills install` (auto with `gfleet wizard` if docs is enabled), invoke in Claude Code or Windsurf:

```
/generate-docs                 # current repo only
/generate-docs --all           # every repo + group synthesis (Claude Code only — uses subagents)
/generate-docs --setup-only    # one-time domain Q&A, then stop
/generate-docs --refresh       # only regenerate sections whose source files changed
/generate-docs --group         # group-level synthesis (after per-repo runs)
/generate-docs --section <path>   # one section
/generate-docs --module <name>    # one module across all artifacts
```

The skill is module-first (one file per ViewSet/controller, not one giant `api.md`), runs a verification checklist before marking files done, marks gaps with 🔴, and dual-saves discoveries via `save-result`.

Browse via VitePress (auto-generated config with sidebar, mermaid plugin, local search):

```bash
cd <repo>/docs
npm install
npm run docs:dev    # http://localhost:5173
```

---

## Troubleshooting

**"Duplicate tool name: mcp0_get_community" in Windsurf** — graphify patch is missing. Run `gfleet patch status` (expect `applied (5/5 hunks)`) and `gfleet patch graphify` to re-apply. `uv tool upgrade graphifyy` typically causes this.

**Watcher not firing** — `gfleet status <group>`, then `gfleet restart <group>`; logs at `~/.cache/graphify-fleet/<group>/`. macOS uses launchd; Linux uses `systemd --user` (run `loginctl enable-linger` for logout-survival); Windows uses Scheduled Tasks.

**Graph stale after big refactor** — `graphify update` has shrink-protection. Run `gfleet rebuild <group>` to force past it, or `gfleet reset <group>` to wipe `graphify-out/` and rebuild.

**"graphify version: X — gfleet pins to Y"** — re-run `gfleet install` (or `gfleet skills install`) to re-pin and re-apply the patch.

**`.gitattributes` conflict on merge** — resolve manually, keep the gfleet block. Re-runs of `gfleet install` are idempotent.

**Onboard says "no .gfleet/group.json"** — original dev didn't commit it. They should run `gfleet install` and commit `.gfleet/group.json` + `.gitattributes`.

---

## Versioning

- `gfleet --help` shows the gfleet CLI version.
- `gfleet doctor` shows the pinned graphifyy version.
- Bumping `GRAPHIFY_PIN` in `src/util.js` requires re-validating patch anchors against the new graphify release. The patch is content-anchored — it skips non-matching hunks and reports partial state via `gfleet patch status`.

---

## Contributing / extending

- New stack convention: drop a `skills/generate-docs/conventions/<stack>.md` and reference it by `stack` in fleet configs.
- New monorepo detector: add a function to `src/monorepo.js` `DETECTORS`.
- New MCP server: extend `writeMcpJson` in `src/integrations.js`.
- New CLI command: wire it in `src/cli.js`.

---

## Commands reference (appendix)

Bare invocation (`gfleet`) lists registered groups (or shows help if none).

`gfleet help` shows just the install-and-forget surface (5–6 commands you actually run). `gfleet help advanced` shows everything below.

### Day-to-day (the 5 you'll actually use)

| Command | What it does |
|---------|--------------|
| `gfleet wizard` | Interactive first-time setup. Picks group, repos, features. Writes config + runs install. |
| `gfleet onboard [path]` | Bootstrap a teammate after `git clone`. Reads `.gfleet/group.json`, prompts for sibling paths, runs install. |
| `gfleet update [--refresh-rules]` | Pull latest gfleet, redeploy skills, repatch graphify. Run when `gfleet doctor` says something drifted. |
| `gfleet doctor` | Verify prerequisites (Node, uv, Python, graphify version, patch state, extras). |
| `gfleet status [group]` | Watcher + graph status across all (or one) registered group. |

### Setup (advanced)

| Command | What it does |
|---------|--------------|
| `gfleet install <config.json>` | Install (or re-apply) for a single fleet config. Normally invoked by wizard / onboard. |
| `gfleet uninstall [group\|config] [--purge]` | Remove watchers, hooks, MCP entries, agent rules, manifest. `--purge` also deletes per-repo `graphify-out/`. |

### Inspect

| Command | What it does |
|---------|--------------|
| `gfleet list` (or `gfleet ls`) | List all registered groups + node counts. |
| `gfleet help [advanced]` | Help (default = primary; `advanced` = full). |

### Repair / rebuild graphs

Accept a group name (preferred) or a config path; no arg runs across all registered groups.

| Command | What it does |
|---------|--------------|
| `gfleet rebuild [group] [slug]` | Force AST rebuild (use after deletions). One repo if `slug` given. |
| `gfleet reset [group] [slug]` | Wipe `graphify-out/` and rebuild from scratch. |
| `gfleet remerge [group]` | Re-run merge-graphs over per-repo graphs (no rebuild). |

### Watchers (self-healing — rarely needed)

| Command | What it does |
|---------|--------------|
| `gfleet start [group]` | Load watchers (launchd / systemd-user / Scheduled Tasks). |
| `gfleet stop [group]` | Unload watchers. |
| `gfleet restart [group]` | Stop + start. |

### Skills (auto via wizard / update)

| Command | What it does |
|---------|--------------|
| `gfleet skills install` | Deploy skill to `~/.claude/skills/`, `~/.codeium/windsurf/skills/`, plus per-repo Windsurf workflows. Auto-applies the graphify patch. |
| `gfleet skills uninstall` | Remove skill + per-repo workflows. |
| `gfleet skills update` | Re-copy from local graphify-fleet repo (after `git pull`). |
| `gfleet skills status` | Show what's installed where. |

### Docs (agent-driven; surface in your IDE)

| Command | What it does |
|---------|--------------|
| `gfleet docs status [group]` | List doc state per repo (up-to-date, stale, not-yet-generated). |
| `gfleet docs run <group>` | Print instructions to invoke `/generate-docs` in your IDE. |
| `gfleet docs path <group>` | Print the group docs path. |
| `gfleet docs init-cli <group>` | Headless CLI Q&A. **Prefer** `/generate-docs --setup-only` in your IDE — it seeds answers from the codebase. |
| `gfleet docs mark-stale --stdin --group <g> --hook <h>` | Internal hook entry point — invoked by post-commit / post-merge / post-checkout to maintain `docs/.stale.md`. Not for direct human use. |

### Monorepo (agent surfaces this when modules drift)

Interactive-first; text args are CI-friendly fallback. Auto-detects via `pnpm-workspace.yaml`, `package.json` workspaces, `nx.json`, `turbo.json`, `lerna.json`, or multi-package fallback.

| Command | What it does |
|---------|--------------|
| `gfleet monorepo add [group] [path]` | Pick group → pick monorepo → multi-select modules. `--modules pkg/a,pkg/b` for non-interactive. |
| `gfleet monorepo remove [group] [path]` | Deselect modules. |
| `gfleet monorepo list` | Show indexed monorepo modules across all groups. |

### Conventions (extend the generate-docs skill)

| Command | What it does |
|---------|--------------|
| `gfleet conventions list` | Show built-in + user-added stack conventions. |
| `gfleet conventions add [--name X]` | Stub a new stack convention; fill via `/extend-convention` in your IDE. |
| `gfleet conventions remove` | Remove a user-added convention. |

### Graphify patch (auto on every `ensureGraphify` / `skills install`)

| Command | What it does |
|---------|--------------|
| `gfleet patch graphify` | Apply the `repo_filter` patch to graphify's `serve.py` (idempotent). |
| `gfleet patch status` | Show patch state (applied / partial / unpatched). |
| `gfleet patch revert` | Restore graphify from `serve.py.gfleet-orig` backup. |

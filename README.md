# graphify-fleet (gfleet)

Orchestrate [graphify](https://github.com/safishamsi/graphify) across **multiple related repos** (a "group"). Keeps each repo's knowledge graph current, merges them into a single cross-repo graph for AI assistants to query, and generates module-organized documentation with cross-repo links.

Built for codebases that span more than one repo — backend + frontend + mobile + infra, or microservice fleets, or monorepos with selectable modules.

---

## Table of contents

1. [What gfleet does](#what-gfleet-does)
2. [Requirements](#requirements)
3. [Install](#install)
4. [Quick start (single dev)](#quick-start-single-dev)
5. [Quick start (teammate joining an existing project)](#quick-start-teammate-joining-an-existing-project)
6. [Concepts](#concepts)
7. [Commands reference](#commands-reference)
   - [Setup](#setup)
   - [Inspect](#inspect)
   - [Build / rebuild graphs](#build--rebuild-graphs)
   - [Watchers](#watchers)
   - [Skills (generate-docs)](#skills-generate-docs)
   - [Docs](#docs)
   - [Monorepo](#monorepo)
   - [Patch (graphify local patch)](#patch-graphify-local-patch)
8. [Config schema](#config-schema)
9. [The `.gfleet/group.json` manifest (committed)](#the-gfleetgroupjson-manifest-committed)
10. [Multi-dev workflow](#multi-dev-workflow)
11. [Generated docs (the `generate-docs` skill)](#generated-docs-the-generate-docs-skill)
12. [Troubleshooting](#troubleshooting)

---

## What gfleet does

Per repo in a group, gfleet sets up:

- **AST graph** via `graphify update` (free, no API key)
- **Watchers** that rebuild the graph on file save (launchd / systemd-user / Scheduled Tasks)
- **Git hooks** that rebuild on commit and re-merge the group graph
- **Merge driver** for `graph.json` so concurrent commits don't produce conflict markers
- **MCP servers** (per-repo + group) so Claude Code, Windsurf, and other agents can query
- **Agent rules** in `CLAUDE.md` / `AGENTS.md` / `.windsurfrules` explaining how to use the graph and the `repo_filter` parameter
- **`generate-docs` skill** for `/generate-docs` slash commands in Claude Code and Windsurf
- **VitePress site config** so docs are browsable like Confluence (search, sidebar, dark mode)
- **Portable `.gfleet/group.json` manifest** committed per repo so teammates can run `gfleet onboard` after `git clone`

Per group, gfleet maintains:

- **Merged group graph** at `~/.graphify/groups/<group>.json` (cross-repo BFS/DFS via MCP)
- **Group memory** at `~/.graphify/groups/<group>-memory/` for `save-result` findings (closed-loop knowledge feedback)
- **Group docs path** for cross-repo narrative documentation

---

## Requirements

- **Node 18.19+** (the gfleet CLI is Node)
- **Python 3.10+** (graphify itself is Python)
- **[uv](https://docs.astral.sh/uv/)** (used to install graphify in an isolated venv)
- **git**

`gfleet doctor` checks all of these and reports the patch + version status.

---

## Install

### One-line install (recommended)

**macOS / Linux**:
```bash
curl -fsSL https://raw.githubusercontent.com/safishamsi/graphify-fleet/main/install.sh | bash
```

**Windows (PowerShell)**:
```powershell
irm https://raw.githubusercontent.com/safishamsi/graphify-fleet/main/install.ps1 | iex
```

The installer:
1. Verifies prerequisites (git, Node 18.19+, uv, Python 3.10+) — installs missing ones (Node via fnm on macOS/Linux or winget on Windows; uv via the official Astral installer)
2. Clones graphify-fleet to `~/.graphify-fleet`
3. Runs `npm install`
4. Creates a `gfleet` shim on PATH (`~/.local/bin/gfleet` or `gfleet.cmd` on Windows)
5. Runs `gfleet doctor` to verify
6. Prints next steps

Re-run the same command later to update — it's idempotent.

### Manual install (if you prefer)

```bash
git clone https://github.com/safishamsi/graphify-fleet.git ~/.graphify-fleet
cd ~/.graphify-fleet
npm install
ln -s ~/.graphify-fleet/bin/gfleet ~/.local/bin/gfleet     # macOS / Linux
# Windows PowerShell: add bin\ to user PATH manually
gfleet doctor
```

### Custom install location

```bash
# bash
curl -fsSL https://raw.githubusercontent.com/safishamsi/graphify-fleet/main/install.sh | bash -s -- --dir ~/tools/gfleet --branch dev
```

`gfleet doctor` will tell you if anything's missing (uv, Python, the graphify install, the local patch) and offer a remediation hint.

---

## Quick start (single dev)

You have a few related repos and want to set up gfleet for the first time:

```bash
gfleet wizard
```

The wizard:

1. Asks for a **group name** (e.g. `myapp`).
2. Discovers repos under a parent folder OR accepts manual paths (comma-separated supported, drag-drop from Finder works).
3. For each repo, auto-detects the **stack** (`react-native` / `node` / `python` / `go` / `generic`) and lets you override.
4. Lets you toggle features (file watchers, Windsurf integration, Claude Code integration, documentation generation).
5. Saves a fleet config at `~/configs/<group>.fleet.json`.
6. Runs the full install (initial AST graphs, watchers, hooks, MCP wiring, agent rules, optional skill install).

After the wizard:

- Watchers are running. Each repo's graph rebuilds on save and on commit.
- You can open any repo in Claude Code or Windsurf and the graph is queryable via `graphify-<group>` MCP.
- If you enabled documentation generation, run `/generate-docs` in Claude Code or Windsurf to generate per-repo and (with `--all`) group-level docs.

---

## Quick start (teammate joining an existing project)

A teammate set things up. You just `git clone`'d one of the repos. The repo has a `.gfleet/group.json` committed.

```bash
cd ~/code/myapp-backend     # whichever repo you cloned
gfleet onboard
```

`gfleet onboard`:

1. Reads `.gfleet/group.json` — knows the group, your repo's slug, and what siblings exist.
2. Prompts for the local path to each sibling repo (defaults to a sensible parent folder; offers to `git clone` if a `clone_url` is set in the manifest).
3. Generates a local fleet config at `~/.gfleet/<group>.fleet.json` with your absolute paths.
4. Runs `gfleet install` (registers merge driver locally, builds graphs, wires MCP, starts watchers).
5. Installs the `generate-docs` skill globally.

After that you have the same setup as the original dev — just with paths matching your machine.

---

## Concepts

### Group

A set of related repos that share a merged graph. Each repo belongs to exactly one group. Groups isolate from each other — querying group A's graph never returns nodes from group B.

### Repo vs monorepo module

A "repo" entry in the fleet config can be either:
- A **standalone repo** — own `.git`, indexed as one unit.
- A **monorepo** with selected modules — each picked module is treated as a virtual repo (own graph, own watcher, own MCP entry). Monorepo modules share the parent repo's `.git` (one merge-driver registration, one set of git hooks).

See [Monorepo](#monorepo) for the schema and CLI.

### Per-repo MCP + group MCP

Two MCP servers are registered (in Claude Code's per-project `.mcp.json`):

- `graphify-<repo-slug>` — serves only this repo's graph. No cross-repo noise.
- `graphify-<group>` — serves the merged group graph. Use for cross-repo flows.

In Windsurf (global MCP config), only the **group MCP** is registered to avoid tool-name collisions across multiple servers. Repo-local filtering in Windsurf is done via the `repo_filter` parameter (see next).

### `repo_filter` parameter (gfleet's local graphify patch)

graphify's MCP tools (`query_graph`, `get_neighbors`, `shortest_path`) don't natively accept a `repo_filter`. gfleet ships a small idempotent patch (`gfleet patch graphify`) that adds it. With the patch:

```
graphify-<group>.query_graph(question, repo_filter="<repo-slug>")
```

restricts the BFS/DFS traversal to that repo's nodes. Lets one MCP serve both repo-local and cross-repo queries.

The patch is auto-applied during `gfleet skills install` and reverted by `gfleet patch revert`. `gfleet doctor` warns if graphify was upgraded and the patch is lost.

### Closed-loop knowledge via `save-result`

When an agent traces a non-trivial fact (cross-repo HTTP boundary, emergent behavior, complex query), it should call `graphify save-result` to persist the finding. The MCP server reads memory alongside the graph, so saved findings surface in future queries at zero re-compute cost.

gfleet's agent rules instruct the agent to **dual-save** — to both `<repo>/graphify-out/memory/` and `~/.graphify/groups/<group>-memory/` — so findings are visible from both per-repo and group MCPs.

### Merge driver (multi-dev safety)

Two devs commit graph rebuilds in parallel → without a merge driver, `graph.json` ends up with conflict markers. With it (gfleet sets it up in `.git/config` + `.gitattributes`), git auto-unions the two graphs.

The `.gitattributes` entry is committed; the `.git/config` entry is per-clone. Teammates run `gfleet onboard` to register it locally.

### Generate-docs skill

Optional but recommended. Adds a `/generate-docs` slash command to Claude Code and Windsurf that produces module-organized markdown docs (architecture, API reference, cross-cutting concerns), VitePress config, and dual-saved findings into the graph memory.

See [Generated docs](#generated-docs-the-generate-docs-skill).

---

## Commands reference

Bare invocation (`gfleet`) lists registered groups (or shows help if none registered).

### Setup

| Command | What it does |
|---------|--------------|
| `gfleet wizard` | Interactive first-time setup. Picks group, repos, features. Writes config + runs install. |
| `gfleet onboard [path]` | Bootstrap a teammate after `git clone`. Reads `.gfleet/group.json`, prompts for sibling paths, runs install. |
| `gfleet doctor` | Verify prerequisites (Node, uv, Python, graphify version, patch state, extras). |
| `gfleet install <config.json>` | Install (or re-apply) for a single fleet config. Idempotent. |
| `gfleet uninstall [group\|config] [--purge]` | Remove watchers, hooks, MCP entries, agent rules block, manifest. `--purge` also deletes per-repo `graphify-out/`. |

### Inspect

| Command | What it does |
|---------|--------------|
| `gfleet list` (or `gfleet ls`) | List all registered groups + node counts. |
| `gfleet status [group]` | Watcher state + graph stats for one group, or all if no arg. |
| `gfleet help` | This message. |

### Build / rebuild graphs

All of these accept either a group name (preferred) or a config path; no arg runs across all registered groups.

| Command | What it does |
|---------|--------------|
| `gfleet rebuild [group] [slug]` | Force AST rebuild (use after deletions). One repo if `slug` given. |
| `gfleet reset [group] [slug]` | Wipe `graphify-out/` and rebuild from scratch. |
| `gfleet remerge [group]` | Re-run merge-graphs over the group's per-repo graphs (no rebuild). |

### Watchers

| Command | What it does |
|---------|--------------|
| `gfleet start [group]` | Load watchers (launchd / systemd-user / Scheduled Tasks). |
| `gfleet stop [group]` | Unload watchers. |
| `gfleet restart [group]` | Stop + start. |

### Skills (generate-docs)

| Command | What it does |
|---------|--------------|
| `gfleet skills install` | Deploy `generate-docs` skill to `~/.claude/skills/`, `~/.codeium/windsurf/skills/`, plus per-repo Windsurf workflow files. Auto-applies the graphify patch. |
| `gfleet skills uninstall` | Remove skill + per-repo workflows. |
| `gfleet skills update` | Re-copy from local graphify-fleet repo (after `git pull`). |
| `gfleet skills status` | Show what's installed where. |

### Docs

| Command | What it does |
|---------|--------------|
| `gfleet docs status [group]` | List generated doc state per repo (up-to-date, stale, not-yet-generated). |
| `gfleet docs run <group>` | Print instructions to invoke `/generate-docs` in your IDE. |
| `gfleet docs path <group>` | Print the group docs path. |
| `gfleet docs init-cli <group>` | Headless CLI Q&A for docs config. **Prefer** running `/generate-docs --setup-only` in your IDE — it seeds answers from the codebase. |

### Monorepo

Interactive-first; text args are CI-friendly fallback.

| Command | What it does |
|---------|--------------|
| `gfleet monorepo add [group] [path]` | Pick group → pick monorepo path → multi-select modules. `--modules pkg/a,pkg/b` for non-interactive. |
| `gfleet monorepo remove [group] [path]` | Deselect modules. |
| `gfleet monorepo list` | Show indexed monorepo modules across all groups. |

Auto-detects monorepos via `pnpm-workspace.yaml`, `package.json` workspaces, `nx.json`, `turbo.json`, `lerna.json`, or multi-package fallback.

### Patch (graphify local patch)

| Command | What it does |
|---------|--------------|
| `gfleet patch graphify` | Apply the `repo_filter` patch to graphify's `serve.py` (idempotent). Auto-runs on `gfleet skills install`. |
| `gfleet patch status` | Show patch state (applied / partial / unpatched). |
| `gfleet patch revert` | Restore graphify from `serve.py.gfleet-orig` backup. |

---

## Config schema

A fleet config is a JSON file. One per group. See `examples/myapp.fleet.json` and `examples/monorepo.fleet.json`.

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

**Stack values**: `react-native`, `node`, `python`, `python-generic`, `django`, `go`, `infra-terraform`, `infra-cdk`, `generic`. Drives the `.graphifyignore` template choice and the documentation skill's per-stack conventions.

**Repo entry types**:
- Default (no `type`) — standalone repo.
- `type: "monorepo"` — has a `modules` array; each module is indexed independently.

**Options**:
- `wiki_gitignored` — add `graphify-out/wiki/` to `.gitignore` (always recommended).
- `watchers` — install a per-repo file watcher (off if you want manual rebuilds only).
- `windsurf` — write Windsurf workflow + rules.
- `claude_code` — write CLAUDE.md rules + per-project `.mcp.json` + PreToolUse hook.

**Docs**:
- `enabled` — install the generate-docs skill globally (idempotent, per-machine not per-group).
- `group_docs_path` — where Pass 7 (group synthesis) writes cross-repo narrative docs. Defaults to the parent of the repos.

---

## The `.gfleet/group.json` manifest (committed)

Each repo gets a `.gfleet/group.json` written by `gfleet install`. **Commit it.** Teammates use it to run `gfleet onboard` after `git clone`.

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

The manifest is **portable** — no absolute paths. `clone_url` is optional; if you set it manually (gfleet preserves manual edits across re-runs), `gfleet onboard` can `git clone` siblings the teammate doesn't have yet.

---

## Multi-dev workflow

graphify v0.7.0 introduced merge-conflict safety for `graph.json` via a git merge driver. gfleet automates the setup.

### Initial setup (one dev)

`gfleet wizard` (or `gfleet install`) per group registers the merge driver in each repo's `.git/config` and writes the corresponding line to `.gitattributes`. **Commit `.gitattributes`** so teammates pick it up.

### Teammate onboarding

After `git clone`:

```bash
gfleet onboard
```

Re-registers the merge driver in their local `.git/config`, sets up watchers, MCP, agent rules, and (if installed) the generate-docs skill.

### What "no more conflicts" looks like

Two teammates commit graph rebuilds in parallel. On `git pull`, instead of:

```
<<<<<<< HEAD
{ "nodes": [...your version...] }
=======
{ "nodes": [...their version...] }
>>>>>>> origin/main
```

You get a clean union-merged `graph.json` with both sets of nodes/edges. No manual resolution. graphify v0.7.0 also seeded community detection so identical code produces identical community IDs across rebuilds — no spurious diffs.

### Graph freshness

`graph.json` records the git commit it was built from. The agent rules instruct AI assistants to compare against `git rev-parse HEAD` before answering architecture questions; if stale, suggest `graphify update .` (the watcher should already be doing this — check `~/.cache/graphify-fleet/<group>/<slug>.log`).

---

## Generated docs (the `generate-docs` skill)

Once installed (auto with `gfleet wizard` if you check the docs box, or manually via `gfleet skills install`), the skill is invokable in Claude Code and Windsurf:

```
/generate-docs                 # current repo only
/generate-docs --all           # every repo + group synthesis (Claude Code only — uses subagents)
/generate-docs --setup-only    # one-time domain Q&A, then stop
/generate-docs --refresh       # only regenerate sections whose source files changed
/generate-docs --group         # group-level synthesis (after per-repo runs)
/generate-docs --section <path>   # one section
/generate-docs --module <name>    # one module across all artifacts
```

The skill is module-first (one file per ViewSet/controller class, not one giant `api.md`), uses a verification checklist before marking files done, marks gaps explicitly with 🔴, and dual-saves every non-trivial discovery via `save-result` (so future agents benefit from prior runs).

After the run, browse the docs via VitePress:

```bash
cd <repo>/docs
npm install
npm run docs:dev    # opens http://localhost:5173
```

The VitePress config is generated automatically with sidebar reflecting your folder structure, mermaid plugin, and local search.

---

## Troubleshooting

### "Duplicate tool name: mcp0_get_community" in Windsurf

This was the symptom that triggered the local graphify patch. With `gfleet patch graphify` applied, Windsurf only needs **one** `graphify-<group>` MCP entry (gfleet writes only that to Windsurf's global config). Run:

```bash
gfleet patch status   # should show: applied (5/5 hunks)
gfleet doctor
```

If the patch was lost (e.g. after `uv tool upgrade graphifyy`), `gfleet doctor` reports it. Run `gfleet patch graphify` to re-apply.

### Watcher not firing

```bash
gfleet status <group>           # are watchers running?
gfleet restart <group>          # restart them
ls ~/.cache/graphify-fleet/<group>/   # check logs
```

On macOS, the watcher uses `launchd` and survives reboots. On Linux, `systemd --user` (run `loginctl enable-linger` if you want them to survive logout). On Windows, Scheduled Tasks.

### Graph stale after big refactor

`graphify update` has shrink-protection (refuses to overwrite a graph with a smaller one). If you deleted lots of files:

```bash
gfleet rebuild <group>          # forces rebuild past shrink-protection
gfleet reset <group>            # nuclear: wipes graphify-out/ and rebuilds from scratch
```

### "graphify version: X — gfleet pins to Y"

`uv tool upgrade graphifyy` moved past gfleet's pin. Re-run `gfleet install` (or `gfleet skills install`) to re-pin and re-apply the patch.

### `.gitattributes` conflict on merge

Standard git workflow: resolve manually, keep the gfleet block. Future re-runs of `gfleet install` are idempotent — they detect the existing block and don't duplicate.

### Onboard says "no .gfleet/group.json"

The original dev didn't commit it. Have them run `gfleet install` again (auto-writes the manifest) and commit `.gfleet/group.json` + `.gitattributes`.

---

## Versioning

- `gfleet --help` shows the gfleet CLI version
- `gfleet doctor` shows the pinned graphifyy version
- Bumping `GRAPHIFY_PIN` in `src/util.js` requires re-validating the patch anchors against the new graphify release. The patch is content-anchored — it skips hunks that don't match upstream changes and reports partial state via `gfleet patch status`.

---

## Contributing / extending

- New stack convention: drop a `skills/generate-docs/conventions/<stack>.md` and reference it by `stack` in fleet configs.
- New monorepo detector: add a detector function to `src/monorepo.js` `DETECTORS` array.
- New MCP server: extend `writeMcpJson` in `src/integrations.js`.
- New CLI command: wire it in `src/cli.js`.

# graphify-fleet (gfleet)

Install once. Forget it exists. Your IDE agent does the rest.

`gfleet` orchestrates [graphify](https://github.com/safishamsi/graphify) across a **group of related repos** (backend + frontend + mobile + infra, microservice fleets, monorepos). It keeps each repo's knowledge graph current, merges them into one cross-repo graph for AI assistants, and generates module-organized docs with cross-repo links.

---

## Install (one line)

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.sh | bash
```

**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/cajasmota/graphify-fleet/main/install.ps1 | iex
```

The installer auto-provisions Node 18.19+ (via fnm / winget), uv, and Python 3.10+ if missing, clones to `~/.graphify-fleet`, puts `gfleet` on PATH, and runs `gfleet doctor`. Re-run anytime — it's idempotent.

---

## Install-and-forget

After this, you should rarely type `gfleet` again:

```bash
gfleet wizard
```

The wizard discovers your repos, auto-detects each stack, writes `~/configs/<group>.fleet.json`, and installs everything end-to-end. Then your IDE agent (Claude Code or Windsurf) takes over.

### What `gfleet wizard` sets up automatically

- **Per-repo file watchers** — launchd (macOS) / systemd-user (Linux) / Scheduled Tasks (Windows). Graphs rebuild on save.
- **Git hooks** — `post-commit` rebuilds graphs; `post-commit / post-merge / post-checkout` mark stale doc sections in `docs/.stale.md` so your agent surfaces them when you ask about affected code.
- **Merge driver** — `graph.json` union-merges across parallel commits. No more conflict markers.
- **MCP registration** — single group MCP per project. Both Claude Code (per-project `.mcp.json`) and Windsurf (global `mcp_config.json`) register one `graphify-<group>` server. Repo-local queries use `repo_filter="<repo-slug>"` against the group MCP.
- **Graphify patch** — adds a `repo_filter` parameter to graphify's `query_graph` / `get_neighbors` / `shortest_path` MCP tools so a single MCP server scopes per-repo. Re-applies itself on every `gfleet update` / `ensureGraphify`.
- **`/generate-docs` skill** — installed globally for both Claude Code and Windsurf.
- **Agent rules** — marker-wrapped, idempotent CLAUDE.md / Windsurf rules so AI assistants know about `repo_filter`, staleness, and `save-result`.

Day-to-day, you talk to your IDE agent. The agent surfaces what needs attention.

### Monorepos (one extra step)

The wizard registers each git repo as a unit — fine for polyrepo setups. If a registered repo is a monorepo (`pnpm-workspace.yaml`, npm workspaces, Nx, turbo, Lerna, or 2+ subdirs with their own `package.json` / `pyproject.toml` / `go.mod`), pick which packages get indexed:

```bash
gfleet monorepo add                                # fully interactive — prompts for group + path
gfleet monorepo add <group> <path-to-monorepo>     # skip prompts; still multiselect modules
gfleet monorepo add <group> <path> --modules a,b   # fully non-interactive
```

Interactive multiselect with detected stacks + LOC estimates. Hooks and the merge driver stay at the monorepo root (one `.git`); each selected package becomes its own graph node in the group. See [`docs/cli/monorepo.md`](docs/cli/monorepo.md).

---

## The few commands you'll actually run

```
wizard                  one-time setup
onboard       [path]    teammate joining after git clone
doctor                  verify everything is wired (run if something feels off)
status        [group]   what's running where
list                    registered groups (alias: ls)
update                  pull latest gfleet, redeploy skills, repatch graphify
```

### Stop / start watchers

Watchers are auto-loaded at login and self-heal (launchd `KeepAlive`, systemd `Restart=always`). You'll rarely need these — but here they are:

```
gfleet stop    [group]   unload watchers
gfleet start   [group]   load watchers
gfleet restart [group]   stop + start
```

Omit `[group]` to fan out across every registered group.

### Repair (when graphs look wrong)

```
gfleet rebuild [group] [slug]   force AST rebuild (use after deletions)
gfleet reset   [group] [slug]   wipe graphify-out/ and rebuild from scratch
gfleet remerge [group]          re-merge group graph (no per-repo rebuild)
```

### Remove

```
gfleet uninstall [group] [--purge]
```

`--purge` also deletes per-repo `graphify-out/`.

---

## Generated docs

Once setup completes, invoke the skill from inside your IDE:

```
/generate-docs                   current repo only
/generate-docs --all             every repo + group synthesis (Claude Code; uses subagents)
/generate-docs --setup-only      one-time domain Q&A, then stop
/generate-docs --refresh         only regenerate sections whose source files changed
/generate-docs --section <path>  one section
/generate-docs --module <name>   one module across all artifacts
/generate-docs --since <gitref>  treat files changed since <gitref> as stale
/generate-docs --group           group-level synthesis (after per-repo runs)
```

The skill is module-first (one file per ViewSet/controller, not one giant `api.md`), runs a verification checklist before marking files done, marks gaps with 🔴 and uncertainty with 🟡, and dual-saves cross-repo findings via `graphify save-result`.

Browse via VitePress (auto-generated config with sidebar, mermaid, local search):

```bash
cd <repo>/docs && npm install && npm run docs:dev    # http://localhost:5173
```

---

## Teammate onboarding

A teammate cloned a repo with `.gfleet/group.json` committed:

```bash
cd ~/code/myapp-backend
gfleet onboard
```

`onboard` reads the manifest, prompts for sibling-repo paths (or `git clone`s them if `clone_url` is set), and runs the full install — merge driver, watchers, MCP, agent rules, skill.

---

## Requirements

| Tool | Version |
|------|---------|
| Node | 18.19+ |
| Python | 3.10+ (graphify) |
| [uv](https://docs.astral.sh/uv/) | latest |
| git | any |

The installer provisions whatever's missing. `gfleet doctor` reports state.

---

## Advanced

Everything else — `install`, `skills`, `docs`, `monorepo`, `conventions`, `patch`, sub-flags like `--refresh-rules-lite` — lives behind:

```
gfleet help advanced
```

The point of gfleet is that you shouldn't need any of it.

---

## CLI reference

Detailed per-command documentation lives under [`docs/cli/`](docs/cli/README.md):

| Topic | Commands |
|-------|----------|
| [`docs/cli/setup.md`](docs/cli/setup.md) | `wizard` (alias `new`), `onboard`, `install` |
| [`docs/cli/operate.md`](docs/cli/operate.md) | `update`, `doctor`, `status`, `list` (alias `ls`), `help` |
| [`docs/cli/watchers.md`](docs/cli/watchers.md) | `start`, `stop`, `restart` |
| [`docs/cli/repair.md`](docs/cli/repair.md) | `rebuild`, `reset`, `remerge`, `uninstall` |
| [`docs/cli/docs.md`](docs/cli/docs.md) | `docs status` / `run` / `path` / `init-cli` / `silence` / `unsilence` / `clear-stale` / `mark-stale`, plus `/generate-docs` skill flags |
| [`docs/cli/monorepo.md`](docs/cli/monorepo.md) | `monorepo add` / `remove` / `list` |
| [`docs/cli/advanced.md`](docs/cli/advanced.md) | `skills`, `conventions`, `patch`, env vars, hidden behaviors |

---

## License

MIT.

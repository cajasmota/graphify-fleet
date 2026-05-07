## graphify (group: {{group}})

This repo is **`{{repo_slug}}`** in the **{{group}}** group.

Group repos:
{{repos_list}}

### How to query the graph (preferred, works in any IDE)

The group MCP server `graphify-{{group}}` is available. The merged group graph contains nodes from every repo in the group; each node carries a `repo` field.

**Use `repo_filter` to scope queries to one repo** (this is the default for repo-local questions). The MCP tools `query_graph`, `get_neighbors`, `shortest_path` all accept a `repo_filter` argument:

```
# repo-local query (default — when you're working in this repo)
graphify-{{group}}.query_graph(question="how is X handled?", repo_filter="{{repo_slug}}")

# cross-repo query (only when the question explicitly crosses repos)
graphify-{{group}}.query_graph(question="how does the frontend call the backend's create endpoint?")
# omit repo_filter — returns nodes from all repos
```

**Default rule**: when working in this repo, pass `repo_filter="{{repo_slug}}"` unless the question is explicitly cross-repo. This avoids cross-repo noise while keeping a single MCP surface.

### Slug reference (so you always know which slug to use)

| Repo | Slug | Path |
|------|------|------|
{{repos_table}}

When uncertain which slug applies, the **current repo's slug is `{{repo_slug}}`**.

### Claude Code only — dual-MCP shortcut (optional)

In Claude Code (per-project `.mcp.json`), there's also a `graphify-{{repo_slug}}` server registered for convenience. Calling it is equivalent to passing `repo_filter="{{repo_slug}}"` to the group MCP. **Prefer the single-MCP `repo_filter` approach** — it's portable across IDEs and uses one tool surface. The per-repo MCP exists for backward compatibility.

### Other ways to navigate

- Wiki-style browsing → `graphify-out/wiki/index.md` if it exists
- After modifying code → run `graphify update .` (the watcher does this on save)

### Graph freshness (check before architecture queries)

Before answering codebase/architecture questions, sanity-check that the graph reflects current code. The graph records which commit it was built from:

1. The build commit is shown in `graphify-out/GRAPH_REPORT.md` as `Built from commit: <sha>`.
2. Compare to `git rev-parse --short HEAD` (current HEAD).
3. If they differ:
   - Watcher should already be rebuilding (check `~/.cache/graphify-fleet/{{group}}/{{repo_slug}}.log`).
   - If you can't wait, run `graphify update .` synchronously.
   - When answering anyway against a stale graph, **call out the staleness** to the user (e.g. "graph is at SHA abc123 but HEAD is def456 — answer reflects pre-change state").

The post-commit hook auto-rebuilds on commits, so the graph is usually current. Stale graph means: uncommitted changes since the last commit, or the watcher crashed.

### Multi-dev / merge-conflict safety

`graph.json` files are union-merged automatically when two teammates commit graph rebuilds in parallel. The merge driver is installed per-clone — gfleet sets it up; new teammates run `gfleet onboard` after cloning to register the driver in their local `.git/config`. Without it, parallel commits can produce conflict markers in `graph.json`.

### Generated documentation

- This repo:  `docs/`              (technical, code-anchored)
- Group-wide: `{{group_docs_path}}`  (narrative, business-oriented, cross-repo flows)

Cross-cutting concerns (auth, permissions, error handling) are documented once in `docs/cross-cutting/` here, not duplicated per-module.

### Documentation freshness

- Each generated doc tracks its source files in `docs/.metadata.json`.
- Post-commit hook auto-maintains `docs/.stale.md` listing docs likely affected by recent changes.
- When you finish a non-trivial code change:
  1. Read `docs/.stale.md` to see which docs are now stale.
  2. If the user is wrapping up a task, suggest:
     `Docs may be stale — gfleet docs {{group}} --refresh refreshes affected sections.`
  3. Do NOT regenerate docs automatically. Suggest the command; let the user decide.
- Slash command for full or partial regeneration: `/generate-docs`

### Knowledge feedback loop — `graphify save-result`

The graph captures imports/calls/containment via static AST. It cannot capture:
- Cross-repo HTTP boundaries (mobile API fn → backend viewset share no import edge, only a URL)
- Emergent behaviors (status changes triggered by multiple unrelated files)
- Implementation patterns (registry, strategy, observer)
- Business rules (status machines, role gates, jurisdictional logic)

After tracing one of these via code reads, **save the finding** so the next agent (or next session) doesn't re-discover it. The MCP server reads memory alongside the graph, so saved results surface automatically in future `query_graph`, `get_neighbors`, `shortest_path` traversals.

**Dual-save** (mandatory): write each save-result to BOTH the per-repo memory dir AND the group memory dir, so it's queryable from both per-repo and group MCPs:

```bash
# Per-repo
graphify save-result \
  --question "<exact question>" --answer "<full answer>" \
  --type <query|path_query|explain> --nodes "<n1>" "<n2>" ...

# Group-visible
graphify save-result \
  --memory-dir ~/.graphify/groups/{{group}}-memory/ \
  --question "<same>" --answer "<same>" \
  --type <same> --nodes "<same>"
```

When to run it:
- After tracing any cross-repo HTTP boundary → `--type path_query` + dual-save
- After understanding an emergent behavior with no single anchor node → `--type query`
- After discovering an architectural pattern → `--type explain`
- At session end, as standard wrap-up — for every question where code reads were needed to fill graph gaps

When NOT to run it:
- Answer fully derivable from the graph alone (no extra reads needed)
- Ephemeral / situational answer (won't apply to future sessions)
- Trace was incomplete (saving a partial finding propagates the gap)

### Quick decision tree

- Repo-local question → `query_graph(question, repo_filter="{{repo_slug}}")` → answer from graph → done
- Repo-local with code reads → graph + 1 file read → save-result if cross-cutting/emergent
- Cross-repo question → `query_graph(question)` (no filter) → traced via code reads → **dual-save** before ending session
- Generated docs (`/generate-docs`) → skill auto-saves discoveries during Pass 4 and Pass 7

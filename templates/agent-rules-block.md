## graphify (group: {{group}}, MCP setup differs per IDE)

This project is part of the **{{group}}** group. The MCP servers available depend on which IDE you're running in:

### In Claude Code — TWO graphify MCP servers (focused + merged)

Claude Code reads per-project `.mcp.json`, so multiple graphify servers can coexist without tool-name collisions. You have:

| MCP server | Graph it serves | When to use |
|------------|----------------|-------------|
| `graphify-{{repo_slug}}` | this repo only | **Default for repo-local questions** — architecture, refactoring, navigation within this codebase. Clean signal, no cross-repo noise. |
| `graphify-{{group}}` | merged across all {{group}} repos | **Cross-repo questions only** — "how does mobile call the backend?", end-to-end flows, API contracts. |

**Default choice rule**: use `graphify-{{repo_slug}}` first. Only switch to `graphify-{{group}}` when the question explicitly crosses repo boundaries.

### In Windsurf / Cascade — ONE graphify MCP server (group only)

Windsurf's MCP config is global (loaded by every session), so registering multiple graphify-* servers causes tool-name collisions ("Duplicate tool name"). Only the group MCP is registered.

| MCP server | Graph it serves | When to use |
|------------|----------------|-------------|
| `graphify-{{group}}` | merged across all {{group}} repos | **Both repo-local AND cross-repo questions** |

**Repo-local filtering in Windsurf**: when you want results scoped to this repo only, pass a `repo` filter argument to the MCP query — every node in the merged graph has a `repo: "<slug>"` field. The MCP tools (`query_graph`, `get_neighbors`) accept filtering, OR you can post-filter results client-side by checking each node's `repo` field. Current repo's slug: **`{{repo_slug}}`**.

Group repos:
{{repos_list}}

Every node in the merged group graph carries a `repo` field identifying its source. When you query `graphify-{{group}}`, you WILL see nodes from other repos — that's the point. When you query `graphify-{{repo_slug}}`, you see only this repo's nodes — clean signal.

**How to use the graphs:**
- Repo-local architecture / structure questions → `graphify-{{repo_slug}}` MCP first
- Cross-repo flow tracing → `graphify-{{group}}` MCP
- Wiki-style browsing → `graphify-out/wiki/index.md` if it exists
- After modifying code → run `graphify update .` (the watcher does this on save)

**Generated documentation:**
- This repo:  `docs/`              (technical, code-anchored)
- Group-wide: `{{group_docs_path}}`  (narrative, business-oriented, cross-repo flows)

Cross-cutting concerns (auth, permissions, error handling) are documented once in `docs/cross-cutting/` here, not duplicated per-module.

**Documentation freshness:**
- Each generated doc tracks its source files in `docs/.metadata.json`.
- The post-commit hook auto-maintains `docs/.stale.md` listing docs likely affected by recent changes.
- When you finish a non-trivial code change:
  1. Read `docs/.stale.md` to see which docs are now stale.
  2. If the user is wrapping up a task, suggest:
     `Docs may be stale — gfleet docs {{group}} --refresh refreshes affected sections.`
  3. Do NOT regenerate docs automatically. Suggest the command; let the user decide.
- Slash command for full or partial regeneration: `/generate-docs`

**Knowledge feedback loop — `graphify save-result`:**

The graph captures imports/calls/containment via static AST. It cannot capture:
- Cross-repo HTTP boundaries (mobile API fn → backend viewset share no import edge, only a URL)
- Emergent behaviors (status changes triggered by multiple unrelated files)
- Implementation patterns (registry, strategy, observer)
- Business rules (status machines, role gates, jurisdictional logic)

After tracing one of these via code reads, **save the finding** so the next agent (or next session) doesn't re-discover it. The MCP server reads memory alongside the graph, so saved results surface automatically in future `query_graph`, `get_neighbors`, `shortest_path` traversals — at zero re-compute cost.

**Dual-save** (mandatory): write each save-result to BOTH the per-repo memory dir AND the group memory dir, so it's queryable from both MCPs:

```bash
# Per-repo (visible in graphify-{{repo_slug}})
graphify save-result \
  --question "<exact question>" --answer "<full answer>" \
  --type <query|path_query|explain> --nodes "<n1>" "<n2>" ...

# Group-visible (visible in graphify-{{group}})
graphify save-result \
  --memory-dir ~/.graphify/groups/{{group}}-memory/ \
  --question "<same>" --answer "<same>" \
  --type <same> --nodes "<same>"
```

When to run it (mandatory):
- After tracing any cross-repo HTTP boundary → `--type path_query` + dual-save
- After understanding an emergent behavior with no single anchor node → `--type query`
- After discovering an architectural pattern → `--type explain`
- At session end, as standard wrap-up — for every question where code reads were needed to fill graph gaps

When NOT to run it:
- If the answer was fully derivable from the graph alone (no extra reads needed)
- If the answer is ephemeral / situational (won't apply to future sessions)
- If the trace was incomplete (saving a partial finding propagates the gap)

**Quick decision tree** for which MCP + whether to save:
- Repo-local code structure → `graphify-{{repo_slug}}` → answer from graph → done
- Repo-local behavior/intent → `graphify-{{repo_slug}}` → graph + 1 file read → done
- Cross-repo question → `graphify-{{group}}` → traced via code reads → **dual-save** before ending session
- Generated docs (`/generate-docs`) → skill auto-saves discoveries during Pass 4 and Pass 7 (dual-save)

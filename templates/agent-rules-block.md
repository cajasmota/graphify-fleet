## graphify (group: {{group}}, merged-graph aware)

This project is part of the **{{group}}** group. The graphify MCP server `graphify-{{group}}` exposes a **merged knowledge graph** spanning ALL repos in this group:

{{repos_list}}

Every node in the merged graph carries a `repo` field identifying its source. When you query the graph, you WILL see nodes from other repos — this is expected. Use that to trace cross-repo flows.

**How to use the graph:**
- Architecture / cross-repo questions → query `graphify-{{group}}` MCP first (`query_graph`, `get_neighbors`, `shortest_path`)
- Local-repo navigation → also fine to read `graphify-out/graph.json` or `GRAPH_REPORT.md`
- Wiki-style browsing → if `graphify-out/wiki/index.md` exists
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

After tracing one of these via code reads, **save the finding** so the next agent (or next session) doesn't re-discover it. The MCP server reads `graphify-out/memory/` alongside the graph, so saved results surface automatically in future `query_graph`, `get_neighbors`, `shortest_path` traversals — at zero re-compute cost.

```bash
graphify save-result \
  --question "<exact question that was asked>" \
  --answer   "<full verified answer>" \
  --type     <query|path_query|explain> \
  --nodes    "<source-node-1>" "<source-node-2>" ...
```

When to run it (mandatory):
- After tracing any cross-repo HTTP boundary → use `--type path_query`, include both the caller and the handler node
- After understanding an emergent behavior with no single anchor node → use `--type query`
- After discovering an architectural pattern (registry, strategy, etc.) → use `--type explain`
- At session end, as standard wrap-up — for every question where code reads were needed to fill graph gaps

When NOT to run it:
- If the answer was fully derivable from the graph alone (no extra reads needed)
- If the answer is ephemeral / situational (won't apply to future sessions)
- If the trace was incomplete (saving a partial finding propagates the gap)

Staleness: if a saved-result references a function/file that has been significantly modified, re-trace and overwrite with a fresh `save-result` (no automatic invalidation).

**Quick decision tree** for when to use which:
- Asked a code structure question → answer from graph → done
- Asked a behavior/intent question → answer from graph + maybe 1 file read → done
- Asked a cross-repo question → traced via code reads → **save-result** before ending session
- Generated docs (`/generate-docs`) → skill auto-saves discoveries during Pass 4 and Pass 7

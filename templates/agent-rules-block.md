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

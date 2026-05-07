# gfleet MCP Server — Tool Schema (v1)

This document is the public contract for the gfleet-managed MCP server. Tool
names, argument shapes, and response shapes are stable; additive evolution
only (new optional args, new optional response fields).

## Stability policy

- Existing tool names will not be removed without a major version bump.
- Existing argument names + types will not change semantics.
- New args MUST be optional with defaults.
- New response fields MAY be added; consumers must tolerate unknown fields.
- Renames go through deprecation: the old name returns identical results for
  one major version before removal.

## Environment

| Var | Values | Effect |
|-----|--------|--------|
| `GFLEET_MCP_DEBUG` | `0` (default), `1`, `2` | Off / summary + warnings / verbose per-call |
| `GFLEET_GRAPHIFY_VERSION` | semver (advanced) | Pin the `graphify` install version used by gfleet |
| `GFLEET_STATE_DIR` | path | Override the default `~/.graphify/groups` state root (used by tests + sandboxed runs) |

### `GFLEET_MCP_DEBUG` levels

- `0` — silent (default). No telemetry summary, no warnings on stderr.
- `1` — debug + warning lines + a telemetry summary on shutdown.
- `2`+ — everything in level 1, plus per-tool-call entry/exit lines on stderr
  with timing.

The current debug level is announced once at startup as
`[telemetry] debug=off` or `[telemetry] debug=on (level N: ...)`.

You can also dump the summary at any time without restarting the server by
sending `SIGUSR1`:

```bash
kill -USR1 <pid>
```

…or by calling the synthetic `get_telemetry` MCP tool (see below).

## Response conventions

- All tool responses are returned as a single `TextContent` part. Where the
  payload is structured, the text is a JSON document (one line, no trailing
  newline). Where the payload is human-oriented (e.g. `query_graph`,
  `get_node`), it is plain text with `NODE` / `EDGE` markers.
- Errors that the server can attribute to user input (missing required args,
  unresolvable endpoints, unavailable repos, etc.) are returned as a JSON
  object with an `error` key, NOT raised — agents should branch on that
  field rather than try/except.
- When a referenced repo's graph file failed to load, tools return an
  "unavailable" envelope: `{"warning": "repo <name> unavailable: <reason>",
  "results": []}`. This applies whenever `repo_filter` targets such a repo.

## Tool index

| Tool | Purpose |
|------|---------|
| [`query_graph`](#query_graph) | BFS / DFS keyword search with token-budgeted output |
| [`get_node`](#get_node) | Resolve a node by label / id |
| [`get_neighbors`](#get_neighbors) | Direct neighbours of a node |
| [`get_community`](#get_community) | Members of a community |
| [`list_communities`](#list_communities) | Community IDs + sizes |
| [`god_nodes`](#god_nodes) | Most-connected nodes |
| [`graph_stats`](#graph_stats) | Summary stats |
| [`shortest_path`](#shortest_path) | Single-repo + cross-repo shortest path |
| [`save_result`](#save_result) | Persist a Q/A pair to disk |
| [`get_node_source`](#get_node_source) | Read source code surrounding a node |
| [`recent_activity`](#recent_activity) | Nodes whose source files changed since cutoff |
| [`list_link_candidates`](#list_link_candidates) | List proposed cross-repo links |
| [`resolve_link_candidate`](#resolve_link_candidate) | Confirm or reject a candidate |
| [`get_telemetry`](#get_telemetry) | One-shot runtime telemetry summary |

---

## `query_graph`

BFS / DFS keyword search over the knowledge graph. With `repo_filter`,
scopes to a single repo's local graph; without, walks the cross-repo
composite (per-repo graphs joined by link-table edges).

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `question` | string | — | yes | Natural-language question or keyword search. Tokens shorter than 3 chars are dropped. |
| `mode` | `"bfs" \| "dfs"` | `"bfs"` | no | Traversal mode. |
| `depth` | integer | `3` | no | Max traversal depth. Capped at 6. |
| `token_budget` | integer | `2000` | no | Approximate token cap for the response. `chars/4` heuristic. Floor of 200. |
| `context_filter` | array of string | — | no | List of relation/community filters; when omitted the server infers filters from `question`. |
| `repo_filter` | string | — | no | Restrict to one repo's local graph (matches the graph file stem). |

### Response

Plain text. First line is a header (`Traversal: BFS depth=3 | Start: [...]
| 7 nodes`). Subsequent lines are `NODE …` and `EDGE …` markers. When the
node set exceeds `token_budget`, an omission footer is appended:

```
... and 12 more results omitted (total relevance dropped below threshold 1.42).
Top categories of omitted results: function 7, class 5
```

### Notes

- Always returns at least one node when any matched, even if `token_budget`
  is unrealistically tight.
- Ranking uses BM25 with camelCase tokenization and a degree tiebreak band
  of 0.5 — see `scoring.py` and `_rank_nodes_for_truncation`.
- See also: [`get_node`](#get_node), [`get_neighbors`](#get_neighbors).

---

## `get_node`

Resolve a single node by label or id. Searches across all repos unless
`repo_filter` is set.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `label` | string | — | yes | Label or node id (case-insensitive substring match). |
| `repo_filter` | string | — | no | Restrict to one repo. |

### Response

Plain text. When a single match is found:

```
Node: OrderViewSet
  ID: backend::order_viewset
  Repo: backend
  Source: orders/views.py L142
  Type: class
  Community: 7
  Degree: 12
```

When multiple matches are found, a head with up to 25 `[<repo>] <label>
(id=…)` rows is returned.

### Notes

- Hits the `LabelIndex` first (O(1)); falls back to a per-graph linear scan
  if needed.
- See also: [`get_node_source`](#get_node_source) for the surrounding
  source code, [`get_neighbors`](#get_neighbors) for traversal.

---

## `get_neighbors`

Direct neighbours of a node, including cross-repo neighbours via the link
table.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `label` | string | — | yes | Label / node id of the node. |
| `relation_filter` | string | — | no | Case-insensitive substring on edge `relation`. |
| `repo_filter` | string | — | no | Restrict to one repo's local graph. |

### Response

Plain text. One line per neighbour:

```
Neighbors of OrderViewSet (backend::order_viewset):
  --> Order (backend::order_model) [imports] [1.0]
  --> /api/v1/orders/ (frontend::orders_list_page) [string_match via http] [0.7]
```

The `via <method>` suffix is present only on cross-repo edges from the
link overlay.

### Notes

- See also: [`shortest_path`](#shortest_path) for transitive reachability.

---

## `get_community`

Members of a community. Communities are computed per-repo, so this
call requires `repo_filter`.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `community_id` | integer | — | yes | Community id (per-repo). |
| `repo_filter` | string | — | yes | Repo whose communities to consult. |

### Response

Plain text:

```
Community 7 in backend (24 nodes):
  OrderViewSet [orders/views.py]
  Order [orders/models.py]
  ...
```

### Notes

- Errors with a one-line message if `repo_filter` is missing.
- See also: [`list_communities`](#list_communities).

---

## `list_communities`

List community ids and sizes.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `repo_filter` | string | — | no | Restrict to one repo. |

### Response

Plain text. With `repo_filter`: `Communities in <repo>:` followed by
`<id>: <count> nodes` lines, sorted by size desc. Without: one summary line
per repo (`[<repo>] <N> communities`), plus an `unavailable` line per
unavailable repo.

---

## `god_nodes`

Most-connected nodes. Per repo if `repo_filter` is set, else across the
composite (with `<repo>::` prefixed ids).

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `top_n` | integer | `10` | no | How many to return. |
| `repo_filter` | string | — | no | Restrict to one repo. |

### Response

Plain text:

```
God nodes (most connected):
  1. OrderViewSet - 42 edges  (order_viewset)
  2. AppRouter - 33 edges  (router)
  ...
```

---

## `graph_stats`

Summary stats. Aggregated across all repos unless `repo_filter` is set.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `repo_filter` | string | — | no | Restrict to one repo. |

### Response

Plain text — multi-line stats. With `repo_filter`:

```
Repo: backend
Nodes: 1240
Edges: 5781
Communities: 17
```

Without `repo_filter`:

```
Repos loaded: 4
Nodes (sum): 5012
Edges (sum, excluding cross-repo): 23107
Cross-repo links: 142
Unavailable repos: ['some_repo']
```

---

## `shortest_path`

Cross-repo shortest path. When `repo_filter` is set or both endpoints
resolve to the same repo, the search is scoped to that single per-repo
graph (legacy behaviour). Otherwise the search runs over a weighted
composite that overlays cross-repo links from `<group>-links.json`.

Cross-repo edges are weighted `1 / max(0.1, confidence)` so high-confidence
hops feel cheap and low-confidence hops feel expensive.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `source` | string | — | yes | Endpoint. May be `<repo>::<id>` prefixed or unprefixed (label / id lookup via `LabelIndex`). |
| `target` | string | — | yes | Same as `source`. |
| `max_hops` | integer | `8` | no | Reject paths longer than this. |
| `repo_filter` | string | — | no | Force single-repo search. |

### Response

JSON. On success:

```json
{
  "found": true,
  "path": ["backend::order_viewset", "backend::order_model", "frontend::orders_page"],
  "edges": [
    {"source": "...", "target": "...", "relation": "imports", "confidence": 1.0, "cross_repo": false},
    {"source": "...", "target": "...", "relation": "string_match", "confidence": 0.7, "cross_repo": true,
     "channel": "http", "identifier": "/api/v1/orders/", "method": "http"}
  ],
  "weakest_link_confidence": 0.7,
  "length": 2,
  "crosses_repos": true
}
```

On failure: `{"found": false, "reason": "...", "source": "...", "target": "..."}`.
Possible reasons include `"no path"`, `"empty endpoint"`, `"no graph
available"`, `"endpoint not in composite"`, `"path exceeds max_hops=N"`,
`"path exceeds hard cap of 12 nodes"`, and `"search exceeded budget"`.

When the endpoint is ambiguous (multiple label matches), the response also
includes a `matches` array of up to 25 `<repo>::<id>` candidates.

### Notes

- Hard length cap of 12 nodes — anything longer is rejected even if the
  caller raises `max_hops`. Pathological cross-fleet traversals are out
  of scope for this tool.
- See also: [`get_neighbors`](#get_neighbors), [`query_graph`](#query_graph).

---

## `save_result`

Persist a Q/A pair (and supporting node ids) so the agent can refer back
later. Writes to `~/.graphify/groups/<group>-memory/<timestamp>-<sha8>.json`.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `question` | string | — | yes | The question being answered. |
| `answer` | string | — | yes | The agent's answer. |
| `type` | `"query" \| "path_query" \| "explain"` | `"query"` | no | Tag the kind of saved result. |
| `nodes` | array of string | `[]` | no | Supporting node ids. |
| `repo_filter` | string | — | no | Recorded with the entry; not enforced. |

### Response

JSON: `{"saved_at": "<iso8601>", "memory_path": "<absolute path>"}`. On
validation error: `{"error": "..."}`.

### Notes

- The memory dir uses the group name with non-alphanumerics replaced by
  `_`; falls back to `default-memory` when no group is configured.

---

## `get_node_source`

Return the source code surrounding a node's `source_location`. Saves a
separate `Read` call when investigating a node.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `node_id` | string | — | yes | `<repo>::<local_id>` or unprefixed (errors if ambiguous across repos). |
| `context_lines` | integer | `20` | no | Lines of context above/below the target. Clamped to `[0, 200]`. |

### Response

JSON:

```json
{
  "node_id": "backend::order_viewset",
  "source_file": "/abs/path/orders/views.py",
  "source_location": "L142",
  "language": "python",
  "snippet": "...",
  "snippet_start_line": 122,
  "snippet_end_line": 162,
  "node_label": "OrderViewSet",
  "repo": "backend"
}
```

On error: `{"error": "..."}`. Possible errors: `"node not found"`,
`"ambiguous node_id (require <repo>::<id> prefix)"`, `"node has no
source_file"`, `"could not parse source_location"`, `"source file
missing"`, `"file too large"`, `"stat failed (...)"`, `"read failed
(...)"`.

### Notes

- Source files >10 MiB are refused.
- Repo root is inferred from the graph file's symlink target; falls back to
  the literal path when the symlink layout differs.
- See also: [`get_node`](#get_node).

---

## `recent_activity`

Return nodes whose `source_file` mtime is at or after a cutoff.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `since` | string | — | yes | Relative duration (`24h`, `7d`, `2w`, `1m`), ISO 8601 timestamp, or git ref (resolved per-repo; OLDEST timestamp is used). |
| `repo_filter` | string | — | no | Restrict to one repo. |
| `limit` | integer | `50` | no | Max nodes returned. |

### Response

JSON:

```json
{
  "since": "7d",
  "resolved_since_ts": 1715000000.0,
  "total_changed_files": 42,
  "shown": 50,
  "nodes": [
    {"node_id": "backend::order_viewset", "label": "OrderViewSet",
     "source_file": "/abs/path/orders/views.py", "mtime": 1715600000.0},
    ...
  ]
}
```

`total_changed_files` reports the pre-truncation count.

### Notes

- Git-ref resolution shells out (`git log -1 --format=%ct <ref>`) per repo
  with a 5s timeout; refs that don't resolve in any repo cause the call
  to fail with `{"error": "could not resolve 'since'", "since": "<value>"}`.

---

## `list_link_candidates`

List entries from `<group>-link-candidates.json`, filtered by
repo/channel/method and sorted by confidence desc, then `discovered_at`
asc. Returns `{total, shown, candidates}`.

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `repo_filter` | string | — | no | Restrict to candidates whose source OR target has this repo prefix. |
| `channel` | string | — | no | Exact channel match (e.g. `"http"`, `"redis_key"`). |
| `method` | string | — | no | Exact method match (e.g. `"label_match"`, `"string"`). |
| `limit` | integer | `20` | no | Max candidates returned. |

### Response

JSON: `{"total": <int>, "shown": <int>, "candidates": [<entry>, ...]}`.

Each entry has the same shape as in `<group>-link-candidates.json`,
augmented with a stable `id` (sha8 of `source→target:method`).

### Notes

- `repo_filter` is per-module in monorepos: if a candidate is between a
  monorepo module and another repo, the prefix match works because module
  graphs use the module slug.

---

## `resolve_link_candidate`

Confirm or reject a candidate. Persists to disk atomically (tmp + rename).

### Arguments

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `candidate_id` | string | — | yes | The candidate's `id` field. |
| `decision` | `"confirm" \| "reject"` | — | yes | What to do. |
| `reason` | string | — | no | Free-text justification recorded on the entry's `resolution`. |
| `override_target` | string | — | no | On confirm only — replace the candidate's target before promoting. |

### Response

JSON. On success:

```json
{"resolved": true, "candidate_id": "deadbeef", "decision": "confirm", "moved_to": "links"}
```

On error: `{"error": "..."}`. Possible errors include `"candidate not
found"`, `"resolve_link_candidate: 'candidate_id' is required"`,
`"resolve_link_candidate: 'decision' must be 'confirm' or 'reject'"`, and
`"resolve_link_candidate: candidates path not configured (run with
--group)"`.

### Notes

- On `confirm`: candidate is removed from `<group>-link-candidates.json`
  and appended to `<group>-links.json` with `method` suffixed by
  `+resolved`, `confidence` set to `1.0`, and a `resolution` block
  recording `{by: "agent", at: <iso>, reason}`.
- On `reject`: candidate is moved to `<group>-link-rejections.json` (same
  shape as candidates plus `resolution`); future link passes will skip it.

---

## `get_telemetry`

Return a one-shot summary of the gfleet MCP server's runtime telemetry —
useful when something feels off (slow queries, hot reloads, missing
graphs).

### Arguments

None.

### Response

Plain text. Multi-line summary including:

- Uptime
- Per-tool: total calls, mean / p95 / max latency
- Reload counts: per repo, plus links / candidates / rejections file reloads
- Current state: repos loaded, sum of nodes / edges, cross-repo link count
- Errors: total per (`tool`, `error class`) pair
- Repo unavailability events

Example:

```
=== gfleet MCP telemetry ===
uptime: 2m13s

tool calls:
  query_graph: calls=14 mean=42.3ms p95=180.1ms max=210.4ms
  get_node: calls=5 mean=2.1ms p95=4.0ms max=4.0ms

reloads:
  repo.backend: 2
  links: 1

current state:
  repos loaded: 4
  nodes (sum): 5012
  edges (sum, excluding cross-repo): 23107
  cross-repo links: 142
```

### Notes

- The same summary is dumped to stderr on `SIGUSR1` and on normal shutdown
  when `GFLEET_MCP_DEBUG>=1`.
- Latency samples are capped at 100 per tool (FIFO); `p95` and `mean` are
  computed over the retained window.

---

## Versioning

This is schema **v1**. Future changes go through:

1. **Additive** — new optional args, new optional response fields. Bump
   nothing; consumers must already tolerate unknown fields.
2. **Deprecation** — old behaviour kept; new behaviour gated on a new arg
   or env var; release notes flag the deprecation.
3. **Major bump** — only after at least one minor release of deprecation.

# Stack convention: database-redis

> Graph-searchability: every database-redis doc inherits the universal backtick contract from `_graph-searchability.md`. Key prefixes, RediSearch index names, Lua script names, stream names, channel names, ACL user names, command names — all in backticks every time, including in headings.

## When to use this convention

Use this convention for repositories whose primary purpose is Redis schema, scripts, or pipelines — not application repos that happen to use Redis as a cache. Typical fits include Lua-script libraries (`scripts/*.lua`, `lua/*.lua`), Redis Stack repos that define RediSearch indexes / RedisJSON document schemas / RedisGraph queries, Redis Streams pipeline repos where the bus itself is the system under documentation, and key-namespace catalog repos that exist to document and standardize key patterns across services.

If the repo is an application that merely talks to Redis for caching, sessions, or rate-limiting, pick the application stack convention (e.g. `nestjs`, `django`, `go`) and treat Redis usage as a sub-topic inside that app's modules. This convention is for the case where Redis primitives ARE the product.

## Module = <discovery rule>

Module discovery, in priority order:

1. **RediSearch index / RedisJSON schema** — each `FT.CREATE` index or JSON document schema is its own module. Module name = the index name or schema name.
2. **Lua-script feature group** — group `*.lua` files by feature directory or by a shared key prefix they operate on. One module per feature.
3. **Redis Streams consumer group** — each consumer group (or each logically distinct stream + its consumer set) is a module.
4. **Pub/Sub channel family** — each shared channel namespace (e.g. `events:user:*`) is a module.
5. **Key-prefix domain** — for pure key-namespace catalog repos, group prefixes by domain (e.g. `user:*`, `session:*`, `billing:*`) and treat each domain as a module.
6. **Top-level directory** — fallback when none of the above apply.

Module homepage is `index.md` (NOT `README.md`).

## Canonical artifact files

Each module produces a subset of these artifacts (use `output-templates/artifact.md` for each):

| Artifact | File | Threshold | Source patterns | Output template |
|----------|------|-----------|-----------------|-----------------|
| key namespaces | `keyspace.md` | always | key-pattern conventions, prefix tables | (prose + table) |
| data structures | `structures.md` | >=3 distinct shapes | strings, hashes, lists, sets, sorted sets, streams, JSON, time-series | (prose) |
| RediSearch indexes | `search-indexes.md` | >=1 FT.CREATE | `FT.CREATE` calls | `output-templates/models.md` |
| Lua scripts | `scripts.md` | >=1 lua script | `*.lua` files | `output-templates/services.md` |
| streams | `streams.md` | >=1 stream | `XADD` / consumer group definitions | `output-templates/services.md` |
| pubsub channels | `pubsub.md` | >=1 channel | publish/subscribe schemas | (prose + table) |
| ACL / users | `security.md` | ACL config present | `users.acl` files | `output-templates/cross-cutting.md` |
| pipelines / transactions | `pipelines.md` | non-trivial MULTI/EXEC | pipeline patterns | (prose) |
| eviction & memory | `memory.md` | maxmemory configured | memory policy configs | `output-templates/cross-cutting.md` |

Module homepage `index.md` uses `output-templates/index.md` and links to whichever artifacts the module actually produced.

## Per-artifact rules

### `keyspace.md`
Catalog of every key prefix used by the module. For each prefix record: the pattern (e.g. `user:{id}:profile`), what it stores, the Redis type (string / hash / list / set / zset / stream / JSON / ts), TTL behavior (fixed / sliding / none), who reads it, who writes it. Prefer a single table covering all prefixes; "How it works" sections are plain prose.

### `structures.md`
For each data-structure shape that appears in the module: when this shape is used, why this shape (vs alternatives — e.g. why a sorted set rather than a list), the atomicity guarantees the application relies on, and the memory profile (per-entry overhead, growth rate). Plain prose, no annotated commands.

### `search-indexes.md`
One section per `FT.CREATE` index. Per index: index name, on-prefix scope, schema (table of fields with types and flags such as `SORTABLE`, `NOSTEM`, `PHONETIC`, `NOINDEX`, vector flags like `HNSW`/`FLAT` with `M`/`EF`), supported queries (the kinds of `FT.SEARCH` / `FT.AGGREGATE` calls the index is built to serve), expected size, and weight tuning notes (`SCORER`, `WEIGHT` overrides).

### `scripts.md` (Lua)
One section per script. Per script: purpose in plain English, `KEYS` and `ARGV` usage (what each slot represents), atomicity guarantees, return shape, when it is invoked (`EVAL` cold path vs `EVALSHA` hot path, who loads the SHA), and known failure modes. Cross-reference the application repo callers by name when known. Plain prose — never annotated Lua.

### `streams.md`
One section per stream. Per stream: producers (who calls `XADD`), consumers (consumer groups, consumer naming, lag-handling strategy), retention strategy (`MAXLEN ~ N` / `MINID`), trimming policy (active vs lazy), and dead-letter handling for poison messages or PEL entries that exceed retry budgets.

### `pubsub.md`
One section per channel or channel pattern. Per channel: publishers, subscribers, message shape, ordering guarantees (per-publisher only), and the drop-on-no-subscriber semantics callers must tolerate.

### `security.md`
ACL users with their command and key restrictions (`+@read`, `~user:*`, etc.). Network isolation: TLS posture, `requirepass` use, replica auth. Note any operator-only commands that are disabled in production (`FLUSHALL`, `DEBUG`, `CONFIG`).

### `pipelines.md`
For each non-trivial multi-step operation: describe the sequence in plain English (what reads must happen before what writes), the atomicity choice (`MULTI`/`EXEC` vs Lua vs no atomicity at all), and the failure-handling story (partial success, idempotency keys, compensations).

### `memory.md`
Maxmemory policy in use (`allkeys-lru`, `volatile-ttl`, `noeviction`, `allkeys-lfu`, etc.), expected working-set size, eviction implications for which keysets are at risk first, and the measurement strategy (`INFO memory`, `MEMORY USAGE`, `mem_fragmentation_ratio`, slow-log scraping).

## Patterns to detect

- **Redis flavor**: vanilla Redis, Redis Stack (RediSearch + RedisJSON + RedisGraph + RedisTimeSeries + RedisBloom), Redis Cluster, Redis Sentinel, AWS ElastiCache, AWS MemoryDB, Upstash, Dragonfly-as-Redis.
- **Use case**: cache, session store, queue (BullMQ / RQ / Sidekiq / Resque), pub/sub bus, primary store, search index, rate limiter, leaderboard, time-series store, vector store (RediSearch HNSW / FLAT).
- **Persistence**: RDB snapshots only, AOF only, RDB+AOF, none — note durability implications for the documented data.
- **Replication topology**: master-replica, Sentinel-managed, Cluster (sharded), no replication.
- **Client library**: node-redis, ioredis, redis-py, jedis, go-redis, lettuce, StackExchange.Redis. Note default behaviors that affect the docs (auto-pipelining, cluster discovery, retry policies).
- **Lua-vs-server-script-vs-application split**: which logic lives in Lua (atomic), which lives in `FUNCTION LOAD` server functions (Redis 7+), which is composed client-side.

## Common gotchas

- Cluster slot-key constraints: multi-key operations require `{tag}` hash-tag braces so all keys land on the same slot.
- `SCAN` vs `KEYS`: `KEYS` is unsafe in production; always document `SCAN` cursors and `MATCH`/`COUNT` choices.
- TTL drift: `RENAME` preserves TTL but `COPY` requires explicit `DB`/`REPLACE`/`TTL` flags; easy to silently lose expirations.
- Pipeline-vs-transaction confusion: pipelines batch round-trips but are NOT atomic; only `MULTI`/`EXEC` (or Lua) gives atomicity.
- Lua atomicity vs server blocking: scripts run atomically but block the whole server, so long scripts stall every other client.
- `EVALSHA` cache invalidation: after `SCRIPT FLUSH` or a failover to a replica that never loaded the script, `EVALSHA` returns `NOSCRIPT` and callers must fall back to `EVAL`.
- Memory fragmentation: `mem_fragmentation_ratio` > 1.5 usually means it's time for `MEMORY PURGE` or a restart; document the threshold.
- AOF rewrite blocking: large AOF rewrites can spike latency; note `auto-aof-rewrite-percentage` and disk headroom.
- `CONFIG SET maxmemory-policy` changes affect existing data immediately — switching to `allkeys-lru` from `noeviction` can start evicting hot keys.
- Replication lag during failover: replicas may be seconds behind; reads-from-replica callers must tolerate stale data.
- Streams: consumer-group lag accumulates without `XACK`; pending-entries-list (PEL) growth is the canary, not stream length.
- RediSearch: schema changes require re-index; large indexes may need `FT.ALTER` + dual-write, not in-place changes.
- Big keys: a single hash or list of millions of entries blocks `DEL` and replication; document `UNLINK` and chunked deletion.
- Hot keys in cluster: a single key can saturate one shard; document hashing strategy if relevant.

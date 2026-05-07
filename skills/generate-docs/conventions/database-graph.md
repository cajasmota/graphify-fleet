# Stack convention: database-graph

> Graph-searchability: every database-graph doc inherits the universal backtick contract from `_graph-searchability.md`. Node labels, relationship types, constraint / index names, named queries, procedure names, migration filenames — all in backticks every time, including in headings.

## When to use this convention

Use this convention for repositories whose primary purpose is a graph database — Neo4j (Aura, self-hosted, Community, Enterprise), Memgraph, Amazon Neptune (openCypher or Gremlin), TigerGraph, JanusGraph, or ArangoDB used in graph mode. The source of truth is Cypher (or Gremlin / GSQL / SPARQL) schema, constraint and index DDL, versioned migrations, custom procedures (APOC, GDS, MAGE), and bulk-loader scripts. Typical fits include cypher schema repos (`*.cypher`, `schema/*.cypher`, `migrations/*.cypher`), APOC procedure libraries, migration repos using `neo4j-migrations` or `liquibase-neo4j`, graph-data-pipeline repos that use `LOAD CSV` or `apoc.load.json` to ingest into a graph, and small Bloom / Aura configuration repos.

If the repo is an application that merely talks to a graph database through a driver (official Neo4j driver, neomodel, Spring Data Neo4j), pick the application stack convention and treat graph access as a sub-topic. This convention is for the case where the graph schema and its evolution ARE the product.

## Module = <discovery rule>

Module discovery, in priority order:

1. **Domain subgraph** — directories under `schema/`, `cypher/`, or `migrations/` that group constraints, indexes, and queries by business domain (e.g. `users/`, `catalog/`, `billing/`) → one module per domain subgraph.
2. **Migration series** — for `neo4j-migrations` / `liquibase-neo4j` repos, group migrations by the domain prefix in their filenames (`V001__users_*.cypher`, `V002__catalog_*.cypher`) → one module per prefix.
3. **APOC procedure package** — for custom procedure libraries, one module per Java/Kotlin package under `src/main/java/.../procedures/`.
4. **Loader pipeline** — for graph-data-pipeline repos, one module per ingestion pipeline (one source system → one subgraph).
5. **GDS pipeline** — for graph-data-science repos, one module per algorithm pipeline (projection + algos + write-back).
6. **Single-module fallback** — pure config repos (Bloom perspectives, Aura tenant config) get one module covering the whole repo.

Module homepage is `index.md` (NOT `README.md`).

## Canonical artifact files

Each module produces a subset of these artifacts. Use the listed output template where one applies; otherwise the artifact is plain prose.

| Artifact | File | Threshold | Source patterns | Output template |
|----------|------|-----------|-----------------|-----------------|
| schema overview | `schema.md` | always | constraint + index definitions, label inventory | (prose + mermaid) |
| node labels | `labels.md` | >=1 label | `(:Label)` patterns, label property schemas | `output-templates/models.md` |
| relationships | `relationships.md` | >=1 type | `[:RELATIONSHIP_TYPE]` patterns | `output-templates/models.md` |
| constraints & indexes | `constraints-indexes.md` | >=1 | `CREATE CONSTRAINT`, `CREATE INDEX`, `CREATE FULLTEXT INDEX`, `CREATE VECTOR INDEX` | (prose + table) |
| queries | `queries.md` | >=2 reusable | named queries, cypher templates, parameterized statements | `output-templates/services.md` |
| procedures | `procedures.md` | custom procs present | APOC custom procedures, GDS algorithm wrappers, user-defined functions | `output-templates/services.md` |
| migrations | `migrations.md` | >=1 versioned | versioned cypher migrations, `neo4j-migrations` config | (prose + timeline) |
| loaders | `loaders.md` | bulk load present | `LOAD CSV`, `apoc.load.*`, `apoc.periodic.iterate` ingestion | `output-templates/services.md` |
| security | `security.md` | RBAC config present | role / user / permission DDL, label-based ACL | `output-templates/cross-cutting.md` |
| graph algorithms | `algorithms.md` | GDS usage >=1 | `gds.*` calls, MAGE procedure calls, graph projection definitions | `output-templates/services.md` |

Module homepage `index.md` summarizes the subgraph in prose and links to whichever artifacts the module actually produced.

## Per-artifact rules

### `schema.md`
High-level overview of the graph model for the module. Include a Mermaid `flowchart TD` (or simple boxes-and-arrows) showing the labels and the relationship types between them, with cardinality hints on the edges. Add sizing estimates (rough node and edge counts, growth rate). Plain prose explanation of the modeling choices — never annotated cypher.

### `labels.md`
One section per node label. Per label: purpose, property schema as a table (name, type, required, indexed, purpose), expected node count, growth rate, the queries this label most commonly participates in, and any multi-label combinations that are intentional (e.g. `:User:Active`). Note label inheritance conventions if the team uses them.

### `relationships.md`
One section per relationship type. Per type: direction conventions (which end is the "from" / "to"), properties carried on the relationship (table form), typical cardinality and fan-out (e.g. "a `User` has up to ~500 `:FOLLOWS` edges"), and the common traversal patterns that walk this edge.

### `constraints-indexes.md`
Catalog every constraint (uniqueness, existence, node key, relationship key) and every index (range, lookup, full-text, vector, point, text). Per item: what it enforces or accelerates, which queries benefit, creation cost on production-sized data, and any known interactions (e.g. "uniqueness constraint also creates a backing range index").

### `queries.md`
One section per reusable query or cypher template. Per query: purpose in plain prose, parameters and their shapes, returned result shape, expected runtime characteristics, and complexity considerations (cardinality estimation, hash-join vs expand patterns, index usage). Plain prose only — NEVER annotated cypher. Cross-reference the application repos that invoke the query when known.

### `procedures.md`
One section per custom procedure or user-defined function. Per procedure: signature, side effects (read-only vs writes), performance profile, scaling behavior, deployment story (jar shipped to plugins folder, version pinning).

### `migrations.md`
A timeline of migrations as a table (version, date, summary). Per migration: what it changes (constraints added, label renames, schema evolution, data backfills), reversibility, runtime cost on production-sized data, and whether it requires downtime or can run online.

### `loaders.md`
One section per bulk-import script or pipeline. Per loader: source format (CSV, JSON, Parquet via APOC), batch size, idempotency strategy (`MERGE` keys, watermarks), execution cadence (one-shot vs periodic), and observability hooks.

### `security.md`
Roles and their permissions. Label-level access control (Neo4j 4+) and property-level access (Neo4j 5+) where used. User provisioning. Network posture (TLS, bolt vs neo4j scheme, routing).

### `algorithms.md`
GDS (or MAGE) usage. Per algorithm: input graph projection (native vs cypher, node/relationship filters), parameters, output destination (stream / write / mutate / stats), memory footprint, and runtime characteristics.

## Patterns to detect

- **Engine**: Neo4j (Aura / self-hosted / Community / Enterprise) / Memgraph / Amazon Neptune (openCypher / Gremlin) / TigerGraph / JanusGraph / ArangoDB. The engine drives almost every other choice.
- **Query language**: Cypher / openCypher / Gremlin / SPARQL / GSQL — affects every artifact's syntax and capability set.
- **Graph data science**: Neo4j GDS plugin, Memgraph MAGE, custom in-house algorithms.
- **APOC surface**: which APOC procedures are used (the `apoc.load.*`, `apoc.periodic.iterate`, `apoc.refactor.*`, `apoc.export.*` families dominate).
- **Driver / ORM**: official Neo4j driver, neomodel (Python), Spring Data Neo4j, py2neo, gremlin-python.
- **Migration tool**: `neo4j-migrations`, `liquibase-neo4j`, custom shell-driven runners, Memgraph's migration story.
- **Cluster topology**: causal cluster (Neo4j Enterprise), single-instance, sharded (Neo4j Fabric), Memgraph HA, Neptune cluster.
- **Vector indexes** (Neo4j 5.13+) for embedding-backed retrieval.
- **Multi-database** (Neo4j 4+) — separate logical databases inside one DBMS.
- **Bloom / visualization** configuration repos (perspectives, saved views).

## Common gotchas

- Cartesian-product traversals: missing `WHERE` joins between disconnected `MATCH` clauses cause exponential expansion. Always run `EXPLAIN` to confirm a single connected pattern.
- Cardinality estimation failures on dense nodes (super-nodes): the planner picks bad expand orders when one node has millions of edges.
- "Index not used" surprises: the planner may pick `NodeByLabelScan` when you expected an index hit. Use `PROFILE` to verify, and add hints (`USING INDEX`) only as a last resort.
- Constraint creation on production data: existence and uniqueness constraints take a long write lock proportional to data size; schedule during a maintenance window or use online-aware tooling.
- `MERGE` semantics: matches on the full pattern, including properties — partial-match `MERGE` can over-match or create duplicates. Always pin the unique key and use `ON CREATE SET` / `ON MATCH SET` for the rest.
- Relationship-property indexes: supported in Neo4j 5+ but not in older versions; check the engine version before designing around them.
- APOC version drift: APOC must match the database minor version exactly (`apoc-5.x.y-core.jar` for Neo4j 5.x.y); environment-to-environment skew breaks procedure calls silently.
- GDS graph projections hold large amounts of off-heap memory; an idle projection still costs RAM until `gds.graph.drop` runs.
- Driver session and transaction scoping: long-lived sessions hold cluster routing tables and bookmarks; prefer short transactional functions.
- Backup and restore consistency: online backups need quiescent writers or causal-cluster snapshots; mixing dump/load with active writes corrupts state.
- Multi-database routing in cluster mode: every query needs the correct `database` parameter; defaulting to `neo4j` hides routing bugs.
- Modeling drift: representing the same concept sometimes as a label and sometimes as a property leads to queries that work in dev and silently miss in prod.
- Vector index limits: dimension ceilings and similarity-function constraints differ across engine versions; verify before committing to an embedding model.
- `LOAD CSV` without `CALL { ... } IN TRANSACTIONS` (or `apoc.periodic.iterate`) on large files causes one giant transaction and OOMs the server.

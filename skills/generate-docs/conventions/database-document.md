# Stack convention: Document / NoSQL database

## When to use this convention

Use this convention when the repository **is** the data layer for a document or wide-column store — not an application that uses one. Typical cases: MongoDB schema-only repos (Mongoose schemas, JSON Schema validators, migrate-mongo scripts), DynamoDB table-definition repos extracted from infrastructure (CDK or Terraform stacks dedicated to data), Firestore rules-and-schema repos (`firestore.rules` + `firestore.indexes.json` + TS schema types), and Cosmos DB container-definition repos.

The signature is that schemas, indexes, access patterns, and migrations dominate the source tree. If the repo also contains application code, apply this convention when data-layer artifacts are the primary content (>60% of source LOC); otherwise treat as an application repo with a `data/` sub-area.

## Module = discovery rule

Apply the first rule that matches:

1. **MongoDB / Mongoose schema repo** — `schemas/`, `models/`, or `*.schema.ts` files dominate, and there is no service code → modules are domain groups (one per top-level schemas folder or per Mongoose model cluster).
2. **migrate-mongo / custom Mongo migrations** — `migrations/` with timestamped JS/TS files → modules grouped by collection family inferred from filename prefixes.
3. **DynamoDB CDK/Terraform table repo** — table definitions in `lib/`, `stacks/`, or `terraform/` and no Lambda/business code → modules are tables (single-table designs are one module).
4. **dynamodb-toolbox single-table repo** — one Table definition + multiple Entities → the Table is the module, Entities are sub-units inside it.
5. **Firestore repo** — `firestore.rules`, `firestore.indexes.json`, and TS schema files at root → modules are top-level collection groups inferred from rules paths.
6. **Cosmos DB repo** — Bicep/ARM/Terraform container definitions → modules are containers grouped by database.

When more than one store is present (e.g. Mongo + Firestore), create one module per store and one sub-module per logical grouping inside.

## Canonical artifact files

Module homepage is `index.md` (NOT `README.md`). Each module gets a subset of the files below.

| Artifact | File | Threshold | Source patterns | Output template |
|----------|------|-----------|-----------------|-----------------|
| Collections (Mongo) / Tables (Dynamo, Cosmos) | `collections.md` or `tables.md` | ≥1 | one per top-level data unit | (prose) |
| Schemas / document shapes | `schemas.md` | always | Mongoose schemas, JSON Schema, TS types, dynamodb-toolbox entities | `output-templates/models.md` |
| Indexes (incl. GSIs / LSIs) | `indexes.md` | ≥1 | index configs, GSI definitions, `firestore.indexes.json` | (prose) |
| Access patterns | `access-patterns.md` | always (DynamoDB) / ≥3 (Mongo, Firestore) | query/scan operations, repository methods | (prose) |
| Migrations | `migrations.md` | ≥1 | migrate-mongo scripts, custom migration runners | (prose) |
| Security rules / IAM | `security.md` | rules present | `firestore.rules`, IAM policies, Mongo role docs | (prose) |
| Streams / change feeds | `streams.md` | streams enabled | DynamoDB Streams, Mongo Change Streams, Firestore triggers | (prose) |
| TTL fields | `ttl.md` | TTL configured | TTL attribute definitions | (prose) |

Always include `index.md` per module summarizing the store, modeling style (single-table vs multi-table, embedded vs referenced), and which artifact files apply.

## Per-artifact rules

### `collections.md` / `tables.md`

One H2 per collection or table. For each:

- **Purpose** — what this collection/table represents and who owns it.
- **Keys** — partition key and sort key (DynamoDB / Cosmos), shard key (Mongo sharded clusters), document `_id` strategy (Mongo).
- **Document shape** — top-level fields and their types, plus nested structure summary. Reference `schemas.md` for full detail.
- **Expected size** — rough item count and item-size order of magnitude.
- **Growth pattern** — append-only, mutable, time-series, hot key risk.
- **Single-table designs (DynamoDB)** — list every entity type that lives in this table and how they're distinguished (entity-type attribute, key prefix).

### `schemas.md`

Each schema definition with:

- Field name, type, constraints (`required`, `unique`, enum values), default, validators.
- Embedded sub-document shapes — describe nesting depth and growth bounds.
- Discriminators (Mongoose) or entity types (dynamodb-toolbox) and how the variants differ.

Include an ER-style mermaid diagram for embedded vs referenced relationships when there are ≥3 related document types.

### `indexes.md`

Per index:

- Keys (PK + SK for Dynamo GSIs; field list for Mongo; collection group + fields for Firestore).
- Modifiers — sparse, unique, partial filter expression, projection type (`KEYS_ONLY`, `INCLUDE`, `ALL` for Dynamo).
- Query patterns it serves — list the access patterns from `access-patterns.md` that depend on this index.
- Write-amplification impact — every write to the base also writes to this index; flag when a hot path has many GSIs.

### `access-patterns.md`

This file is **critical for DynamoDB** and useful for any single-table design or Mongo collection with a non-trivial query mix. List every read pattern:

- Plain-English description ("get all open orders for a customer in the last 30 days").
- Operation type — `GetItem`, `Query`, `Scan`, `BatchGet`, Mongo `findOne`/`find`/`aggregate`, Firestore `get`/`where`/collection-group query.
- Index used — base table or named GSI/LSI/secondary index. For DynamoDB single-table designs, document the access-pattern → PK/SK key construction.
- Consistency — strong vs eventual, and whether stale reads are acceptable.
- Result-set size expectations and pagination strategy.

Flag any access pattern that requires a full `Scan` in production code.

### `migrations.md`

Migration timeline, newest first. Per migration:

- What it does — schema change, backfill, reshape, index build.
- Idempotency — safe to re-run or not.
- Runtime constraints — locks, throughput consumption (DynamoDB write capacity), online vs offline.
- Rollback strategy — does a reverse migration exist, or is this forward-only.

### `security.md`

- **Firestore rules** — per top-level path, plain-English explanation of who can read and write, including the auth predicate (e.g. "only the user whose `uid` equals the document's `ownerId` may write").
- **DynamoDB IAM** — policies that grant table or index access; flag any wildcard `dynamodb:*` grants.
- **MongoDB roles** — built-in and custom roles, what each can do, which user/service assumes them.
- Public-access checks — call out any rule that allows unauthenticated reads or writes.

### `streams.md`

Per stream / change feed:

- Stream type — DynamoDB Streams (`NEW_IMAGE`, `OLD_IMAGE`, `KEYS_ONLY`, `NEW_AND_OLD_IMAGES`), Mongo Change Streams, Firestore triggers.
- Consumers — Lambda functions, Kafka Connect tasks, downstream services.
- What each consumer reacts to — inserts only, all changes, filtered by attribute.
- Idempotency — how the consumer handles duplicate delivery.
- Replay strategy — how to re-process from a point in time.

### `ttl.md`

Per TTL field:

- Field name and what it represents.
- Lifecycle implemented — session expiry, soft-delete, time-bound cache.
- Edge cases — clock skew between writers, race with reads near expiry, replication lag in delete propagation, eventual deletion (DynamoDB TTL can lag by up to 48 hours).

## Patterns to detect

Surface these in the module's `index.md`:

- **Store** — MongoDB Atlas, self-hosted Mongo, AWS DocumentDB, DynamoDB, Firestore (native or Datastore mode), Cosmos DB (which API: SQL, Mongo, Cassandra, Gremlin, Table).
- **Modeling style** — single-table vs multi-table (DynamoDB), embedded vs referenced documents (Mongo), root collections vs subcollections (Firestore).
- **Schema validation** — Mongoose schemas, MongoDB JSON Schema validators, dynamodb-toolbox, Zod/TS types, Firestore converters.
- **Migration tooling** — migrate-mongo, custom Node/Python scripts, Liquibase MongoDB extension, AWS DMS, Realm sync schema changes.
- **Stream consumers** — Kafka Connect (Debezium), AWS Lambda triggers, Mongo Change Streams to Kafka, Firestore Cloud Functions.
- **Multi-region** — Mongo replica sets across regions, DynamoDB Global Tables, Firestore multi-region locations, Cosmos multi-master.
- **Backup strategy** — DynamoDB PITR, Atlas snapshots, Firestore exports to GCS, Cosmos continuous backup.

## Common gotchas

Flag these with a yellow marker in the relevant artifact file:

- DynamoDB hot partitions — uneven key distribution causing throttling on a single PK.
- Mongo unbounded array growth approaching the 16 MB document limit.
- Missing GSIs for new access patterns added later — call out the backfill cost.
- Firestore rules that allow unauthenticated reads or writes (`allow read, write: if true`).
- Mongo `$lookup` cross-collection joins masking poor schema design.
- DynamoDB `Scan` operations in hot production code paths.
- Missing TTL on session, token, or cache collections leading to unbounded growth.
- Eventually consistent reads serving stale data in flows that assume read-your-writes.
- Mismatched Mongo write concerns and read preferences between writers and readers (e.g. write `w:1` + read from secondary).
- Cosmos DB partition-key changes — only achievable via container recreation, with full RU re-provisioning cost.
- Mongo's default behavior of indexing all fields vs DynamoDB's explicit-only indexing — call out when a Mongo collection inherits implicit indexes that nobody owns.
- DynamoDB item-size limit (400 KB) and the silent write rejection when nested attributes blow past it.
- Firestore collection-group queries requiring composite indexes that aren't in source control.
- TTL deletes not firing change-stream events the way regular deletes do (store-specific behavior).

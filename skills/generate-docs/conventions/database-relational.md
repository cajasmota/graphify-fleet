# Stack convention: Relational database

> Graph-searchability: every relational-database doc inherits the universal backtick contract from `_graph-searchability.md`. Table / view / materialized view names, column names, schema names, index names, migration filenames, dbt model names, sqlc query names — all in backticks every time, including in headings.

## When to use this convention

Use this convention when the repository **is** the database — not an application that talks to one. The source of truth is DDL, migrations, dbt models, sqlc queries, Prisma schemas, or a stored-procedure catalog, and most files in the repo are SQL or schema-as-code artifacts. Typical examples: dbt projects, sqlc projects, Prisma schema-only repos, raw SQL migration repos under Flyway/Liquibase/Atlas/Goose/sqitch/Alembic, and procedure-heavy repos with materialized views and triggers.

If the repo mixes schema and small amounts of application code, treat it as a database project when migrations and schema dominate (>60% of source LOC). Otherwise use an application convention and let this convention's docs live in a `database/` sub-area.

## Module = discovery rule

Apply the first rule that matches:

1. **dbt project** — `dbt_project.yml` at root → modules are `models/<group>/` directories (one module per top-level group such as `staging/`, `marts/`, `intermediate/`).
2. **sqlc project** — `sqlc.yaml` or `sqlc.json` at root → modules are query directories referenced by `queries:` in the config (typically `query/<domain>/`).
3. **Prisma schema-only** — `prisma/schema.prisma` exists and there is no app code → modules are domain groups inferred from `///` block comments and model name prefixes.
4. **Migration-tool repos** — `db/migrations/`, `migrations/`, `changelog/` (Liquibase), or Atlas/Goose/sqitch directories → group migrations into modules by domain inferred from filename prefixes (`001_users_*.sql` → `users` module).
5. **Raw SQL / schema-first repos** — top-level directories named after table families or domains (e.g. `billing/`, `catalog/`, `auth/`) → one module per directory.
6. **Procedure-heavy repos** — group by schema namespace (`schemas/<schema>/procedures/`, `schemas/<schema>/views/`).

If multiple rules could apply, pick the one that drives CI: whichever tool runs in the build pipeline is the canonical module boundary.

## Canonical artifact files

Module homepage is `index.md` (NOT `README.md`). Each module folder gets a subset of the files below depending on what the source contains.

| Artifact | File | Threshold | Source patterns | Output template |
|----------|------|-----------|-----------------|-----------------|
| Schemas / namespaces | `schemas.md` | always | DDL files, `CREATE SCHEMA` | (prose) |
| Tables, views, materialized views | `models.md` | ≥1 table | `CREATE TABLE`, `CREATE VIEW`, `CREATE MATERIALIZED VIEW` | `output-templates/models.md` |
| Cross-table relationships | `relationships.md` | ≥3 FKs | `FOREIGN KEY`, `REFERENCES` | (prose + mermaid) |
| Migrations | `migrations.md` | ≥1 migration | versioned SQL files, changelog entries | (prose) |
| Queries (dbt models / sqlc queries) | `queries.md` | ≥2 queries | `models/**/*.sql` (dbt), `query/*.sql` (sqlc) | (prose) |
| Stored procedures / functions | `procedures.md` | ≥1 | `CREATE PROCEDURE`, `CREATE FUNCTION` | (prose) |
| Triggers | `triggers.md` | ≥1 | `CREATE TRIGGER` | (prose) |
| Seeds | `seeds.md` | seed data exists | `seeds/`, `seed.sql`, dbt seeds | (prose) |
| Roles, grants, RLS policies | `security.md` | RLS or role grants present | `CREATE ROLE`, `GRANT`, `CREATE POLICY` | (prose) |
| dbt schema/data tests | `tests.md` | dbt projects | `tests/`, schema.yml `tests:` blocks | (prose) |
| dbt macros | `macros.md` | dbt projects with macros | `macros/*.sql` | (prose) |
| dbt sources | `sources.md` | dbt projects with sources | `sources.yml` | (prose) |

Always include `index.md` per module summarizing what's there and which artifact files are present.

## Per-artifact rules

### `models.md` (tables, views, materialized views)

One H2 per object. For each one cover:

- **Purpose** — one short paragraph in plain English: what this table represents, who writes to it, who reads from it.
- **Columns table** with headers `Name | Type | Constraints | Default | Purpose`. Constraints include `NOT NULL`, `UNIQUE`, `CHECK (...)`, `PK`, `FK → other.col`.
- **Relationships** — bulleted list of incoming and outgoing FKs with the cardinality (`1:N`, `N:1`, `M:N` via join table).
- **Indexes** — describe each index by purpose, not just column list (e.g. "covers the `WHERE customer_id = ? AND status = 'open'` lookup used by the dashboard query").
- **Partitioning / sharding** — only if applicable: strategy, partition key, retention policy.
- **Materialized views only** — refresh strategy (manual, scheduled, on-commit) and staleness expectations.

Add a mermaid `erDiagram` at the top of the file when ≥4 tables are related to each other.

### `relationships.md`

Document FK chains that cross domain or schema boundaries. Plain prose only — describe the chain, why it exists, and what breaks if a row is deleted at one end. Include a mermaid `erDiagram` for the domain-boundary picture.

### `migrations.md`

Timeline grouped by feature or release, newest first. Per migration entry:

- Migration ID / filename and what it changes (added column, new table, backfill, index build).
- Reversibility — does the down migration exist, and does it actually restore the prior state, or does it lose data?
- Data-migration risk — zero-downtime concerns: long locks, rewrites, blocking index builds, replication lag.
- Known incidents — link any production issue this migration caused or fixed.

### `queries.md` (dbt models or sqlc queries)

Per query:

- **Purpose in plain English** — what business question it answers or what shape it produces.
- **Inputs** — Jinja vars (dbt), `:param` bindings (sqlc), or function arguments. Type and whether required.
- **Output shape** — columns and types of the result set; for dbt, the materialization (`view`, `table`, `incremental`, `ephemeral`).
- **Downstream consumers** — which other models, services, or dashboards read from this. For dbt, list ref-children explicitly.

### `procedures.md`

Per stored procedure or function:

- What it does, in plain prose. Never paste annotated SQL.
- Parameters with types and meaning.
- Side effects — tables it writes, notifications it emits, queues it touches.
- Idempotency — safe to retry or not, and why.
- Performance characteristics — typical runtime, sequential scans, locks held, transaction size.
- `SECURITY DEFINER` or `SECURITY INVOKER` — and the implications.

### `triggers.md`

Per trigger:

- What event fires it (`BEFORE INSERT ON ...`, `AFTER UPDATE OF col ON ...`).
- What it does in plain prose.
- Side effects — other tables it modifies, NOTIFY channels, audit rows.
- Performance impact — every-row vs statement-level, replication implications.

### `seeds.md`

Source of seed data, what it represents (reference data, demo data, test fixtures), how it's loaded, and whether it's idempotent.

### `security.md`

- **Roles** — list each role, what it represents, who/what assumes it.
- **Grants** — by object, what each role can do.
- **Row-level security policies** — per policy, what it allows or denies expressed as a plain-English predicate ("a user can read a row only when `tenant_id` matches their session's tenant claim").

### dbt-specific files

- **`tests.md`** — schema tests (`unique`, `not_null`, `accepted_values`, `relationships`) and custom data tests grouped by model. Express the assertion in prose ("`orders.customer_id` must reference a row in `customers`").
- **`macros.md`** — per macro: purpose, parameters, what SQL it generates, where it's used.
- **`sources.md`** — external tables exposed to dbt: connection, freshness checks, loaders that populate them.

## Patterns to detect

Surface these in the module's `index.md` overview when present:

- **Engine** — Postgres, MySQL, MariaDB, SQL Server, Oracle, SQLite, Snowflake, BigQuery, Redshift, DuckDB. Detect from dialect-specific syntax, driver config, or `dbt_project.yml` profile.
- **Migration tool** — Flyway, Liquibase, dbmate, Goose, Atlas, sqitch, Alembic, Knex, Prisma Migrate, TypeORM migrations. Detect from config files and migration filename conventions.
- **Build/dev tool** — dbt, sqlc, Prisma, Knex, TypeORM.
- **Schema modeling style** — schema-first DDL, ORM-first generated DDL, Prisma model-first, sqlc + raw queries.
- **Testing** — dbt tests, pgTAP, unit-style migration tests, Great Expectations.
- **Lineage** — dbt manifest, OpenLineage emitters, Marquez integration, custom lineage hooks.
- **Time-travel / temporal** — Postgres `temporal_tables` extension, Snowflake time-travel, BigQuery snapshot decorators, system-versioned tables.

## Common gotchas

Flag these with a yellow marker in the relevant artifact file:

- Migrations whose `down` step doesn't actually restore prior state (data lost on rollback).
- Long-running locks on big-table `ALTER`s — call out production safety risk.
- Missing indexes on FK columns (especially `ON DELETE CASCADE` paths).
- Implicit cross-database references (Snowflake `db.schema.table`, BigQuery cross-project) that aren't obvious from the model name.
- dbt incremental models without `unique_key` — risk of silent duplication.
- Triggers that emit side effects inside transactions and break logical replication.
- Stored procedures bypassing application-level audit logging.
- `SECURITY DEFINER` functions enabling privilege escalation.
- Time-zone handling in temporal columns — `TIMESTAMP` vs `TIMESTAMPTZ` mistakes.
- Schema drift between environments (dev/staging/prod) — call out when the repo doesn't enforce parity.
- Partition keys that can't be changed after table creation without a full rewrite.
- Materialized views with no documented refresh schedule — silent staleness.

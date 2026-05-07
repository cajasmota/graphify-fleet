# Stack convention: Python (non-Django, non-FastAPI)

> Graph-searchability: every doc written under this convention inherits the universal backtick contract from `_graph-searchability.md`. Module names, class names, function names, file paths, blueprint names, CLI commands, env vars — all in backticks every time, including in headings.

Use this convention for Flask apps, plain libraries, scripts/CLI tools, data pipelines, and any Python codebase that doesn't fit `django.md` or `fastapi.md`. If Django is detected use `django.md`. If FastAPI is detected use `fastapi.md`.

## Module discovery

A "module" is a top-level package (a directory with `__init__.py`).

Discovery rules:
1. Look under `src/<pkg>/` first; fall back to `<pkg>/` at repo root.
2. Each immediate child package with `__init__.py` is a candidate module.
3. Skip these by default: `tests/`, `test/`, `migrations/`, `scripts/` (unless scripts is the whole product), `docs/`, `examples/`, `vendor/`, `_vendor/`.
4. If a single package contains many cohesive subfolders (e.g. `app/auth/`, `app/billing/`, `app/api/`), treat the subfolders as modules instead of one giant module.
5. Flask blueprints registered via `Blueprint("name", __name__)` are strong module signals — each blueprint package is typically one module.
6. For pure libraries with a flat single-package layout, fall back to graphify communities to suggest sub-module splits.

## Canonical artifact files

Per module, generate when present and above threshold; otherwise fold into `README.md`.

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| api / views | `api.md` | ≥3 routes/views | Flask `@bp.route`, `MethodView`, plain WSGI handlers, aiohttp `web.RouteTableDef` |
| models | `models.md` | ≥2 | dataclasses, attrs, pydantic models, SQLAlchemy declarative, SQLModel, ORM mapped classes |
| services | `services.md` | ≥2 service methods/functions | service classes/functions, use-case modules |
| repositories | `repositories.md` | ≥1 repo | `*Repository`, `*Repo`, data-access modules |
| schemas | `schemas.md` | non-trivial validation | pydantic schemas with validators, marshmallow schemas, attrs validators |
| tasks | `tasks.md` | ≥1 background task | `@celery.task`, `@shared_task`, arq/dramatiq/rq/huey/taskiq decorators |
| cli | `cli.md` | ≥1 command | click `@cli.command`, typer `@app.command`, argparse `add_subparsers`, console_scripts entry points |
| pipeline | `pipeline.md` | ETL / batch present | pandas DataFrame transforms, prefect/airflow/luigi/dagster definitions, custom step runners |
| events | `events.md` | ≥2 publishers/subscribers | blinker signals, custom event bus |
| config | `config.md` | non-trivial | `app.config`, `Settings` (pydantic-settings), environment loaders, `from_object` patterns |

## Per-artifact writing rules

### `api.md` (Flask / WSGI / aiohttp)
- Group routes by Blueprint or RouteTable.
- Per route: HTTP method, path, auth (decorators like `@login_required`, `@requires_token`), request schema (form/json/query), response shape, status codes (explicit return + raised exceptions).
- Note `before_request`/`after_request`/`teardown` hooks at top of the file's section.
- Mark async vs sync handlers — Flask 2+ supports async views with different concurrency semantics.
- Show example request/response JSON when payloads are non-trivial.
- Cross-repo: link callers via the merged graph.

### `models.md`
- One H2 per model class.
- Fields table: name, type, constraints (nullable, unique, default), purpose.
- Relationships subsection (FK, M2M, OneToOne, back_populates) with cardinality.
- For SQLAlchemy: note 1.x vs 2.x style (declarative_base vs `DeclarativeBase`/`Mapped[...]`), session/engine wiring once at top.
- Custom `__init__`, `__repr__`, hybrid properties, validators — walk through if non-trivial.
- ER mermaid diagram at the top when 4+ models with relationships.
- Plain dataclass/attrs/pydantic models: note immutability (`frozen=True`), `model_config`/`Config`, validators.

### `services.md`
- One H2 per service class or service module.
- One H3 per public method/function.
- Per method: 1-3 paragraphs (purpose, signature, behavior, side effects, transactions).
- Mark async vs sync.
- Mermaid sequence diagram for methods coordinating ≥3 collaborators.
- Note transaction boundaries (`session.begin()`, context managers), queue puts, signal emits, external HTTP calls.

### `repositories.md`
- One H3 per repo.
- Methods: signature, what query it runs, what it returns, transaction context.
- For complex queries: walk through the SQL or ORM expression.

### `schemas.md`
- Note pydantic v1 vs v2 (or marshmallow version) once at top — validator syntax differs.
- Don't enumerate every field. Document only schemas with non-trivial validation: custom `validator`/`field_validator`/`model_validator`, cross-field rules, computed fields.
- Note `ConfigDict` / `Config` (extra="forbid", from_attributes, alias_generator).
- Inheritance hierarchies if used to compose schemas.

### `tasks.md`
- One H3 per task.
- Per task: trigger (when fired and from where), what it does, idempotency, retry policy, queue name, time limits, beat schedule if periodic.
- Note dependencies between tasks when chained (`chain`, `group`, `chord`, signatures).
- Broker/backend (redis/rabbitmq/sqs) — note once per module.

### `cli.md`
- Group commands by entry point / sub-app.
- Per command: name, options/arguments (with types, defaults, required), what it does, exit codes, side effects.
- Note `console_scripts` registration in `pyproject.toml` / `setup.cfg`.
- For typer/click: capture callback hierarchy (root callback → subcommand).

### `pipeline.md`
- Inputs (sources, schemas), transforms (in order), outputs (sinks).
- For pandas pipelines: note the DataFrame schema at each major step.
- For SQLAlchemy bulk operations: chunk size, transaction strategy.
- For workflow tools (airflow/prefect/dagster): one H3 per DAG/flow, list tasks and their dependencies, schedule, retries.
- Mermaid flowchart when ≥3 steps.

### `events.md`
- One H3 per signal/event.
- For each: who emits it, who listens, payload shape, ordering guarantees.

### `config.md`
- How configuration is loaded (env vars, files, secrets manager).
- Required vs optional settings, defaults, validation.
- Per-environment overrides (dev/staging/prod).

## Patterns to detect

- **Web framework**: Flask, aiohttp, Starlette, Bottle, Pyramid, Tornado, Sanic, Quart. Note once per module. (FastAPI → use `fastapi.md`. Django → use `django.md`.)
- **WSGI vs ASGI**: critical for async behavior — note the server entry point (`gunicorn`, `uvicorn`, `hypercorn`, `waitress`).
- **DB / ORM**: SQLAlchemy 1.x vs 2.x, SQLModel, Tortoise, Peewee, Pony, beanie/motor (mongo), raw `psycopg`/`asyncpg`/`aiosqlite`. Note version because idioms differ.
- **Validation lib**: pydantic v1 vs v2, marshmallow, attrs+cattrs, dataclasses + manual validation.
- **Async vs sync**: classify per route/service. Mixed codebases need explicit notes — don't gloss over it.
- **Background workers**: celery, arq, dramatiq, rq, huey, taskiq, custom thread/process pools, APScheduler.
- **CLI framework**: click, typer, argparse, fire, docopt.
- **HTTP client**: requests, httpx (sync vs async), aiohttp client, urllib3.
- **Settings**: pydantic-settings, dynaconf, environs, manual `os.getenv`.
- **Logging**: structlog, loguru, stdlib logging with custom formatter.
- **Migrations**: alembic, yoyo, raw SQL.
- **Packaging**: pyproject.toml (PEP 621), setup.cfg, setup.py, poetry, hatch, pdm.

## Public exports

For library packages, document the **public API**:
- Inspect `__init__.py` for `__all__` and re-exports — these are the contract.
- If `__all__` is missing, treat top-level names not starting with `_` as public.
- `README.md` should show the canonical import paths users should rely on.

## Testing layout (note, don't document exhaustively)

- `tests/` adjacent to `src/` (preferred) or inside the package.
- pytest with `conftest.py` fixtures — note shared fixtures once per module.
- Test files mirror source layout (`tests/foo/test_bar.py` ↔ `src/pkg/foo/bar.py`).
- Don't generate per-test documentation; mention testing approach once in module README if non-obvious (e.g., factory_boy, hypothesis, vcrpy cassettes, testcontainers).

## Common gotchas

- **`__init__.py` doing real work**: imports with side effects, registering blueprints, configuring logging — always read it.
- **Circular import workarounds**: deferred imports inside functions are a code smell worth surfacing.
- **App factory pattern (Flask)**: `create_app()` wires extensions, blueprints, config — document it as the module entry point.
- **Sync code calling async (or vice versa)**: `asyncio.run` inside a request handler, blocking IO in an async route — flag these.
- **SQLAlchemy session scope**: per-request session (Flask-SQLAlchemy), session-per-task, or manual — get this right.
- **Pydantic v1 vs v2 mixed in one project**: happens during migrations; note which models use which.
- **Celery task discovery**: tasks must be importable at worker startup — `autodiscover_tasks` vs explicit imports.
- **Click/typer command groups**: nested groups can hide commands; trace from the entry point.
- **Editable installs (`pip install -e .`)**: src-layout vs flat-layout affects discovery.
- **Namespace packages (PEP 420)**: no `__init__.py` — discovery rules above need adjusting.
- **Threading + GIL assumptions**: highlight when code relies on (or fights) the GIL.

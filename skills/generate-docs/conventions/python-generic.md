# Stack convention: Python (non-Django)

For Flask, FastAPI, plain libraries, scripts, etc.

## Module = top-level package

Discovery:
1. Top-level packages under `src/<pkg>/` or `<pkg>/` (each with `__init__.py`).
2. Skip `tests/`, `migrations/`, `scripts/`.
3. If a single package contains many subfolders with cohesive responsibilities, treat the subfolders as modules instead.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| api | `api.md` | ≥3 routes | FastAPI routers, Flask blueprints, decorated views |
| models | `models.md` | ≥2 | pydantic models, dataclasses, SQLModel, SQLAlchemy declarative |
| services | `services.md` | ≥2 | service classes/functions |
| repositories | `repositories.md` | ≥1 | repo classes |
| schemas | `schemas.md` | non-trivial validation | pydantic schemas with validators |
| tasks | `tasks.md` | celery/arq tasks | task decorators |
| cli | `cli.md` | ≥1 CLI command | click, typer, argparse entry points |

## Patterns

- **Web framework**: FastAPI, Flask, Starlette, aiohttp, Django (use django.md instead).
- **DB**: SQLAlchemy (1.x or 2.x), SQLModel, raw asyncpg, beanie (mongo).
- **Validation**: pydantic v1 vs v2 — different idioms.
- **Async vs sync**: critical to note per route/service.

Otherwise apply general principles from `prompts/04-cluster.md`.

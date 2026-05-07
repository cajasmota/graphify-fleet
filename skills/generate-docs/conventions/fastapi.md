# Stack convention: FastAPI

(Use this instead of `python-generic.md` when FastAPI is the framework.)

## Module = router or feature package

Discovery:
1. Each `APIRouter` instance is a unit. Files like `app/api/<feature>.py` or `app/routers/<feature>.py`.
2. `app/<feature>/` packages with their own router → modules.
3. Communities fallback for codebases without explicit feature splits.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| api / routes | `api.<router-name>.md` | one per APIRouter | files containing `APIRouter()` |
| schemas | `schemas.md` | ≥3 Pydantic models | `**/schemas/*.py`, `**/models/*.py` (Pydantic) |
| services | `services.md` | ≥2 service functions/classes | `**/services/*.py` |
| repositories | `repositories.md` | ≥1 repo | `**/repositories/*.py` |
| dependencies | `dependencies.md` | non-trivial Depends() | `**/dependencies.py`, `**/deps.py` |
| middleware | `middleware.md` | ≥1 middleware | `app.add_middleware()` calls |
| tasks | `tasks.md` | celery/arq/fastapi BackgroundTasks | task decorators, `BackgroundTasks` usage |

## Per-artifact rules

### `api.<router>.md`
- One router per file (R0).
- Routes per HTTP verb + path.
- Path operation parameters: path/query/body distinguished (Pydantic Body/Query/Path).
- Response model — link to schema.
- Dependencies (`Depends`) — list each, what it does, side effects.
- Status codes: explicit `status_code=` AND raised `HTTPException` — list both.
- Async vs sync handler — note (different concurrency semantics).

### `schemas.md`
- Pydantic v1 vs v2 syntax — note once at top.
- Per schema: fields with types + validation (Field constraints, validators).
- ConfigDict / Config inner class — extra="forbid", from_attributes, etc.
- Inheritance hierarchies if present.

### `services.md`
- Per service: signature, what it does, sync vs async, transaction context, side effects.
- Mermaid sequence for orchestration ≥3 collaborators.

### `dependencies.md`
- Per `Depends()`: what it returns, what it gates (auth, DB session, current user).
- Sub-dependencies — chain them.

## Patterns to detect

- **Pydantic version**: v1 vs v2 (different validator syntax).
- **DB layer**: SQLAlchemy (1.x or 2.x), SQLModel, raw asyncpg, beanie (mongo), tortoise.
- **Async**: pure async, sync, or mixed. Note per-route.
- **Auth**: fastapi-users, custom JWT, OAuth2PasswordBearer.
- **Background**: BackgroundTasks (built-in), celery, arq, taskiq.
- **WebSockets**: `@app.websocket(...)` endpoints.
- **OpenAPI customization**: tags, summary, description, response examples.

## Common gotchas

- `Depends(get_db)` reuse — note dependency caching scope.
- Async context manager DB sessions — `async with` patterns.
- Dependency injection vs middleware — when to use each.
- Pydantic v2 `model_validate` vs v1 `parse_obj`.
- `@app.middleware("http")` runs for every request — note performance implications.

# Pass 5 — Reference pages

Repo-wide reference docs that aren't per-module.

## Files

Produce only the ones whose source items exist (per the plan):

- `docs/reference/config.md` — env vars, settings, feature flags
- `docs/reference/scripts.md` — CLI commands, npm scripts, manage.py commands
- `docs/reference/deployment.md` — CI/CD, Docker, deploy targets
- `docs/reference/dependencies.md` — top-level deps with one-line each

## `config.md`

Read: `.env.example`, `settings.py` (or equivalent), feature flag definitions.

Format:

```markdown
<!-- docs:auto -->
# Configuration

<!-- auto:start id=summary -->
N environment variables, M settings keys, K feature flags.
<!-- auto:end -->

<!-- auto:start id=env-vars -->
## Environment variables

| Name | Required | Default | Used by | Purpose |
|------|----------|---------|---------|---------|
| `DATABASE_URL` | yes | — | all | Postgres connection string |
| `REDIS_URL` | yes | — | celery, cache | Cache + broker |
| `SENTRY_DSN` | no | none | logging | Error reporting |
...
<!-- auto:end -->

<!-- auto:start id=settings -->
## Settings (settings.py)

Grouped by concern:

### Database
- `DATABASES['default']` — derived from `DATABASE_URL`. Connection pool: ...
- `DATABASE_ROUTERS` — none configured.

### Cache
- `CACHES['default']` — Redis. TTL default: 300s.
- `CACHES['sessions']` — separate Redis db for sessions.

### Logging
...
<!-- auto:end -->

<!-- auto:start id=feature-flags -->
## Feature flags

If a flag system exists (django-waffle, LaunchDarkly, etc), list flags + their purpose.
Otherwise omit this section.
<!-- auto:end -->
```

## `scripts.md`

Read: `package.json` `"scripts"`, `manage.py` custom commands, `Makefile`, top-level shell scripts.

```markdown
<!-- docs:auto -->
# Scripts

<!-- auto:start id=npm-scripts -->
## npm scripts

| Command | What it does | When to run |
|---------|--------------|-------------|
| `npm run dev` | Vite dev server on port 5173 | Local development |
| `npm run build` | Production build to `dist/` | CI / before deploy |
| `npm run test` | vitest run | CI / pre-push |
| `npm run lint` | eslint + prettier check | CI |
<!-- auto:end -->

<!-- auto:start id=manage-py -->
## manage.py custom commands

Each command lives in `<app>/management/commands/<name>.py`.

### `regenerate_openapi`
Path: `core/management/commands/regenerate_openapi.py`
Purpose: regenerates `openapi.json` from current DRF view metadata.
When to run: after changing serializers or url patterns.

...
<!-- auto:end -->

<!-- auto:start id=shell-scripts -->
## Shell scripts

If any top-level `*.sh` exist, document them.
<!-- auto:end -->
```

## `deployment.md`

Read: CI configs (`.github/workflows/*.yml`, `bitbucket-pipelines.yml`, `.gitlab-ci.yml`), Dockerfiles, docker-compose files, deploy scripts.

```markdown
<!-- docs:auto -->
# Deployment

<!-- auto:start id=overview -->
*One-paragraph summary of how this repo gets to production.*
E.g., "Bitbucket Pipelines builds on every push to develop; Docker image pushed to ECR; ECS service redeployed via the pipeline."
<!-- auto:end -->

<!-- auto:start id=ci -->
## CI/CD

Pipeline file: `bitbucket-pipelines.yml`

Stages:
1. **lint** — eslint + black
2. **test** — pytest with PG and Redis services
3. **build** — multi-stage Dockerfile, image tagged `<sha>`
4. **deploy-staging** (auto on develop) — ECS rolling update
5. **deploy-prod** (manual on main) — same flow against prod cluster

Gates:
- All tests must pass
- `coverage > 80%`
- 🟡 *manual deploy step is gated by who? unclear from config*
<!-- auto:end -->

<!-- auto:start id=docker -->
## Docker

`Dockerfile` is multi-stage:
- **builder**: Python deps + collectstatic
- **runtime**: minimal python:3.11-slim, copies from builder, runs gunicorn

Exposed: `8000`. Healthcheck: `GET /health/`.

Local: `docker-compose.yml` brings up app + postgres + redis. See `how-to/local-dev.md`.
<!-- auto:end -->

<!-- auto:start id=envs -->
## Environments

| Env | URL | Branch | Notes |
|-----|-----|--------|-------|
| dev | (local) | any | docker-compose |
| staging | <inferred> | develop | auto-deploy |
| prod | <inferred> | main | manual gate |
<!-- auto:end -->

<!-- auto:start id=runbook-links -->
## Runbooks

If `runbooks/` or `docs/runbooks/` exist elsewhere, link.
<!-- auto:end -->
```

## `dependencies.md`

Read: `package.json`, `requirements*.txt`, `go.mod`, `pyproject.toml` deps section.

For each top-level dep, write a one-line summary. Group by category if there are >20.

```markdown
<!-- docs:auto -->
# Dependencies

Top-level: N runtime, M dev.

<!-- auto:start id=runtime -->
## Runtime

### Web framework
- **`Django` 4.2** — the web framework
- **`djangorestframework` 3.14** — DRF; powers all `/api/v1/*`

### Database
- **`psycopg2-binary` 2.9** — Postgres driver
- **`django-pg-trigram` 1.0** — full-text search on Property
...

### Background jobs
- **`celery` 5.3** — task queue
- **`redis` 5.0** — broker + result backend

### Auth
...
<!-- auto:end -->

<!-- auto:start id=dev -->
## Dev / build / test
- `pytest` — test runner
- `pytest-django` — DB fixtures
- `factory_boy` — model factories
- `black`, `isort`, `flake8` — formatting / lint
<!-- auto:end -->

<!-- auto:start id=upgrades -->
## Upgrade considerations

Note any deps that are pinned at old versions with reasons (if comments
in requirements/pyproject explain why). Otherwise omit.
<!-- auto:end -->
```

## How-to pages

Generate `docs/how-to/local-dev.md` always (synthesize from existing README setup section + tooling).

For each non-trivial task mentioned in README/CONTRIBUTING (running tests, regenerating openapi, building APK, releasing), generate a `docs/how-to/<task>.md`.

Be concise — how-to docs should be runnable steps, not theory.

## Idempotence

Same as pass 4 — strip and respect `<!-- docs:manual -->` / `<!-- docs:auto -->` / human regions. Update `.metadata.json`.

## After completion

Print one line per file written. Proceed to `prompts/06-cross-cutting.md`.

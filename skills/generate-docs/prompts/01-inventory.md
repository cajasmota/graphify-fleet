# Pass 1 — Inventory

**Always runs.** Cheap. No file writes. Builds a structured map of what's in this repo so later passes can plan.

## Your goal

Produce a JSON inventory at `<repo>/docs/.inventory.json` that lists modules, their god nodes, their source files, and the artifacts present (api endpoints, models, etc.) — without reading source code yet.

## Steps

### 1. Determine the stack

From `docs-config.json` (in `~/.graphify-fleet/groups/<group>/`) or from filesystem detection:
- `package.json` with `"react-native"` or `"expo"` dep → `react-native`
- `package.json` (otherwise) → `react`
- `manage.py` or `INSTALLED_APPS` → `django`
- `pyproject.toml` (no Django) → `python-generic`
- `go.mod` → `go`
- `*.tf` files at top level → `infra-terraform`
- `cdk.json` → `infra-cdk`
- otherwise → `generic`

Read `conventions/<stack>.md` for stack-specific module-detection rules.

### 2. Detect modules

Apply the stack convention's discovery rule. Most common:
- **Django**: each app under `<project>/<apps_dir>/` (one with `apps.py` or `__init__.py`)
- **React/RN**: `src/features/*`, `src/pages/*`, or `src/modules/*` if present; otherwise top-level `src/<dir>/`
- **Go**: top-level packages OR `cmd/<service>/` for monorepo style
- **Infra**: terraform modules under `modules/` OR top-level stack directories

If filesystem signals are weak, fall back to graphify communities — read `<repo>/graphify-out/GRAPH_REPORT.md` and use its community list. Communities of <3 nodes are not modules.

### 3. For each detected module, collect:

Without reading source files (use the graph + filesystem only):

- `name` — kebab-case slug (e.g. `orders`, `billing`)
- `path` — directory under repo root
- `node_count` — from graphify community
- `god_nodes` — top 5-10 nodes by degree, with file paths
- `community_id`
- `artifacts_present` — which artifact types exist (presence-based, no analysis yet):
  - `api` — files matching `*api*`, `*views*`, `*handlers*`, `*routes*`, `*controllers*`
  - `models` — `*models*`, `*schemas*`, `*entities*`
  - `services` — `*services*`, `*service.*`
  - `repositories` — `*repository*`, `*repositories*`, `*repo.*`
  - `serializers` — `*serializers*` (Django/DRF)
  - `permissions` — `*permissions*`
  - `tasks` — `*tasks*` (celery), `*jobs*`
  - `signals` — `*signals*` (Django)
  - `admin` — `*admin*`
  - `pages` / `screens` / `routes` — for frontend/mobile
  - `components` — `*component*`, `*components/*`
  - `hooks` — `use*.{ts,tsx,js,jsx}`
  - `stores` — `*store*`, `*slice*`
  - `types` — `*types*`, `*.d.ts`
- `lines_of_code` — sum from graph or `wc -l`
- `imports_from` — list of other modules this one imports (compute from graph edges)
- `imported_by` — reverse

### 4. Detect cross-cutting concerns

A concern is "cross-cutting" when it appears in ≥3 modules. Look for:
- Permissions / authorization
- Error handling
- Logging / observability
- Caching
- Validation
- Background jobs (celery tasks orchestration)
- Routing (frontend/mobile)
- Theming / styles (frontend/mobile)
- Localization

For each, list the top files and which modules use them.

### 5. Detect repo-wide artifacts (for reference pages)

- Config files (`.env*`, `settings.py`, `config/*`, `vite.config.*`, etc.)
- CI/deployment configs (`.github/workflows/*`, `bitbucket-pipelines.yml`, `Dockerfile*`, `docker-compose*`)
- Scripts (`package.json` scripts, `manage.py` commands, top-level shell scripts)
- Dependencies (top-level `package.json` deps, `requirements.txt`, `go.mod`)

### 6. Write the inventory

Write `<repo>/docs/.inventory.json`:

```json
{
  "version": 1,
  "repo": "myapp-backend",
  "stack": "django",
  "generated_at": "<ISO-8601>",
  "modules": [
    {
      "name": "orders",
      "path": "core/orders",
      "node_count": 87,
      "god_nodes": [
        {"label": "OrderViewSet", "file": "core/orders/api.py", "degree": 23},
        ...
      ],
      "community_id": 5,
      "artifacts_present": ["api", "models", "services", "permissions", "tasks", "serializers"],
      "lines_of_code": 4231,
      "imports_from": ["auth", "users", "clients"],
      "imported_by": ["billing", "notifications"]
    },
    ...
  ],
  "cross_cutting": [
    {
      "name": "permissions",
      "files": ["core/permissions/*"],
      "used_in_modules": ["orders", "users", "billing", "orders"]
    },
    ...
  ],
  "repo_wide": {
    "config_files": [...],
    "ci_files": [...],
    "scripts": [...]
  }
}
```

### 7. Print a compact summary

```
Inventory complete: myapp-backend
  - 8 modules (87 god nodes total)
  - 3 cross-cutting concerns
  - 4 repo-wide reference targets
```

Then proceed to `prompts/02-plan.md`.

## Important constraints

- **Do not** read source code in this pass. Only filesystem + graph metadata.
- **Do not** write any docs files yet — only `.inventory.json`.
- If a module has 0 god nodes, exclude it from the inventory (likely an empty/util folder).
- If a module's name conflicts with another (e.g. `auth` exists as both a top-level dir and a sub-module), prefer the larger/deeper one and note the conflict in `module_overrides_suggested`.

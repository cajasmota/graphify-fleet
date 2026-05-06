# Stack convention: Django (Python)

## Module = Django app

A "module" is a Django app — a directory with `apps.py` and/or `models.py`, listed in `INSTALLED_APPS`.

Discovery:
1. Read `settings.py` (or settings package) for `INSTALLED_APPS`.
2. Filter to local apps (paths starting with the project's package name; not `django.*` or `rest_framework` etc.).
3. Each local app = one module.

Skip apps that are pure utilities with no models, no views, no signals — they likely don't need their own module page (note in `module_overrides_suggested`).

## Canonical artifact files

For each module, generate (when present and above threshold):

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| api | `api.md` | ≥3 endpoints | `api.py`, `views.py`, `viewsets.py`, files w/ DRF `APIView`/`ViewSet` |
| models | `models.md` | ≥2 models | `models.py`, `models/*.py` |
| services | `services.md` | ≥2 service methods | `services.py`, `service.py`, `services/*.py` |
| repositories | `repositories.md` | ≥2 repos | `repositories.py`, `repos/*.py` (Django doesn't use this often) |
| serializers | `serializers.md` | ≥3 serializers AND complex validation | `serializers.py`, `serializers/*.py` |
| permissions | `permissions.md` | module-specific only (cross-cutting goes to cross-cutting/) | `permissions.py` |
| tasks | `tasks.md` | ≥2 celery tasks | `tasks.py`, `tasks/*.py`, `@shared_task` decorators |
| signals | `signals.md` | ≥2 receivers | `signals.py`, `@receiver` decorators |
| admin | `admin.md` | non-trivial admin (custom actions, inlines) | `admin.py` |
| management | `commands.md` | ≥1 custom command | `management/commands/*.py` |
| flows | `flows.md` | always when ≥2 services interact | derived from services |

Below threshold: fold into `README.md` as a section.

## Per-artifact writing rules

### `api.md`
- Group endpoints by ViewSet/APIView class.
- For each endpoint: method, path, auth, request/response schema, validation rules, side effects, code ref.
- For DRF ViewSets, derive paths from `urls.py` registration + `basename`.
- Show example request/response JSON.
- Cross-repo: every endpoint should attempt a cross-repo link to its callers (via merged graph).

### `models.md`
- One H2 per model.
- Fields table: name, type, constraints (null, unique, default), purpose.
- Relationships subsection (FK, M2M, OneToOne) with cardinality.
- Custom managers / querysets — if non-trivial, walk through one example.
- Indexes (`class Meta: indexes`) — note them.
- ER mermaid diagram at top if 4+ models with relationships.

### `services.md`
- One H2 per service class.
- One H3 per public method.
- Per method: 1-3 paragraphs (purpose, signature, behavior, side effects).
- Mermaid sequence diagram for any method coordinating ≥3 collaborators.
- Note transactions, signal fires, queue puts.

### `tasks.md`
- One H3 per task.
- Per task: trigger (when fired), what it does, idempotency, retry policy, queue name.
- Note dependencies between tasks if any chain.

### `signals.md`
- One H3 per receiver.
- What signal it listens to, what it does in response, possible failure modes.

### `serializers.md`
- Only document non-trivial validation logic — don't enumerate every field.
- Custom `validate_*` methods: explain the rule.
- Cross-field validation (`validate(self, data)`): explain.

## Patterns to detect

- **Service-layer present?** Check for `services.py` files. If absent, services don't get a separate file — view logic goes in `api.md`.
- **Repository pattern?** Rare in Django. If present, document.
- **Custom managers?** Mention in `models.md`.
- **Soft-delete mixin?** If used, mention once at top of models.md.
- **Multi-tenancy?** Look for `tenant_id` or `client_id` patterns. If found, note in `cross-cutting/multi-tenancy.md`.
- **Async views (Django 4.1+)?** Note in api.md if used.

## Common gotchas

- The `__init__.py` of an app sometimes does heavy lifting — check it.
- `apps.py.ready()` may register signals — important to mention.
- Settings overrides per environment — check for `settings/` package vs flat `settings.py`.

# Pass 6 — Cross-cutting concerns

Concerns that span multiple modules within this repo. Document once, link from each module.

## Files

For each cross-cutting concern in the inventory, write `docs/cross-cutting/<concern>.md`.

Common concerns:
- `permissions.md` — authorization
- `error-handling.md` — exception conventions, error responses
- `logging.md` — structured logging, correlation IDs, log levels
- `caching.md` — cache layers, TTLs, invalidation
- `validation.md` — shared validators
- `routing.md` — frontend/mobile routing patterns
- `theming.md` — frontend/mobile theming
- `i18n.md` — localization

## Format

```markdown
<!-- docs:auto -->
# <Concern> (cross-cutting)

<!-- auto:start id=summary -->
*One paragraph: what this concern is, where it lives, what convention this codebase uses.*
<!-- auto:end -->

<!-- auto:start id=primary-implementation -->
## Where it lives

Primary file(s):
- `core/permissions/base.py` — permission classes
- `core/permissions/decorators.py` — view decorators
- `core/permissions/utils.py` — helper functions

<!-- auto:end -->

<!-- auto:start id=patterns -->
## How it's used

The 2-5 patterns this codebase uses. Each pattern: name, what it does, code reference, when to use.

### `IsClientOwner`

Permission class checking that `request.user` owns the `client_id` on the URL or body.

[`core/permissions/base.py:42`](../../core/permissions/base.py#L42)

Used in:
- `orders.api.OrderViewSet`
- `orders.api.ContractViewSet`
- `billing.api.InvoiceViewSet`

```python
class IsClientOwner(BasePermission):
    def has_permission(self, request, view):
        client_id = view.kwargs.get('client_id') or request.data.get('client_id')
        return request.user.client_id == client_id
```

### `@require_inspector_role`
...
<!-- auto:end -->

<!-- auto:start id=consumers -->
## Consumers

Modules that use this concern:

| Module | Files | Notes |
|--------|-------|-------|
| [orders](../modules/orders/) | api.py, views.py | uses `IsClientOwner` + custom `IsAssignedInspector` |
| [billing](../modules/billing/) | api.py | uses `IsClientOwner` only |
| ...
<!-- auto:end -->

<!-- auto:start id=gotchas -->
## Gotchas

Things easy to get wrong:
- 🟡 *if you add a new view that takes a `client_id` URL kwarg, remember to add `IsClientOwner`. There's no automatic enforcement.*
- 🟡 *behavior on missing `client_id` in body: returns 403 (not 400). Possibly worth changing.*
<!-- auto:end -->
```

## In-module stubs

For each module that uses this concern, the module-level artifact file (e.g., `modules/orders/permissions.md`) should contain ONLY a stub:

```markdown
<!-- docs:auto -->
# Orders — Permissions

<!-- auto:start id=stub -->
This module uses the `IsClientOwner` permission class plus a module-specific
`IsAssignedInspector` check.

For the full pattern documentation see [cross-cutting/permissions.md](../../cross-cutting/permissions.md).

## Module-specific permissions

### `IsAssignedInspector`

[`core/orders/permissions.py:12`](../../../core/orders/permissions.py#L12)

Checks that `request.user.id == order.assigned_inspector_id`. Used on
`PATCH /api/v1/orders/{id}/` to limit edits to the assigned owner.

(No other module-specific permissions.)
<!-- auto:end -->
```

The cross-cutting doc has the patterns and the consumer table; the per-module stub has only the module-specific bits + a link.

## Idempotence + metadata

Same rules. Update `.metadata.json`.

## After completion

Proceed to `prompts/08-cross-link.md` (skip 07 if not running in `--group` mode).

# Pass 6 — Cross-cutting concerns

Concerns that span multiple modules within this repo. Document once, link from each module.

**Apply `conventions/_graph-searchability.md`**: every pattern name (permission class, decorator, helper function, middleware) in backticks every time, including in headings. Every fenced code block language-tagged.

**Glossary auto-append rule** (shared with Passes 4 and 5): see `prompts/04-cluster.md` "Glossary auto-append" section.

## Stub-fill model — Pass 2 already created the file with pre-declared anchors

Pass 2 wrote each `docs/cross-cutting/<concern>.md` as a stub with YAML front-matter that lists the **pre-declared anchor IDs**. Pass 4 module writers have been linking to those anchors safely throughout the run, knowing Pass 6 will fill the bodies before the run ends.

Your job in Pass 6:

1. Read the stub. Note its `anchors:` list — that list is a CONTRACT.
2. Read the cross-cutting snippet bundle (primary files + per-module call sites).
3. If the concern owns one or more god nodes (listed under `## God nodes` in `.plan.md`), read the god-node snippet at `docs/.cache/god-nodes/<node-id>.md` and incorporate it as the canonical description for that node, with the anchor id matching the snippet filename.
4. Replace the `<!-- pass-6-fill-here -->` marker with the full body per the canonical template.
5. **Verify every pre-declared anchor is now defined** — every entry in the YAML `anchors:` list MUST correspond to a heading in the body whose slug (per GitHub-flavored slug rules) matches. If any anchor is missing: either add the heading, or remove the anchor from the YAML list AND record the change in `<repo>/docs/.cross-link-todo.md` so Pass 4 writers can be told their links to that anchor are now broken (Pass 8 will catch them too, but earlier is better).
6. Update YAML front-matter `status: stub` → `status: filled`.

## Canonical page template

The page format for every `docs/cross-cutting/<concern>.md` file is defined by the canonical output-template:

**`~/.claude/skills/generate-docs/output-templates/cross-cutting.md`**

That file is the source of truth for section order, anchor IDs, callout style, and the auto-region structure. The example below in this prompt shows a populated instance for orientation, but the canonical template wins on any conflict.

Important rules pulled from the template (do not violate):

- "How it works" / "How it's used" sections are PLAIN PROSE. Do NOT use annotated code blocks — i.e. no code fences with inline `# this does X` comments walking through logic. A short verbatim snippet plus a source link is fine; an "explained code" block is not.
- Every concrete code reference uses a relative source link (e.g. `[`core/permissions/base.py:42`](../../core/permissions/base.py#L42)`); the link IS the explanation, so don't duplicate it as comments.
- Consumer tables list one row per module, not per call site.

## Orchestration model

On **Claude Code**, the orchestrator delegates each `cross-cutting/<concern>.md` write to a subagent (per `SKILL.md`'s coordinator-only rule). Hand the subagent:

1. This prompt (`prompts/06-cross-cutting.md`).
2. The canonical template at `~/.claude/skills/generate-docs/output-templates/cross-cutting.md`.
3. The snippet bundle for that concern (primary implementation files + the per-module call sites discovered in pass 4).
4. The list of modules confirmed to use this concern, so the subagent can both fill the consumer table here AND know which per-module stub files (Pass 4 outputs) need their stubs aligned.

The subagent reads the prompt + template + snippets BEFORE writing. The orchestrator itself writes nothing. On **Windsurf**, the running agent writes directly.

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

## Format (illustrative example — see canonical template for full structure)

The block below is an example of a populated `permissions.md`. Use it for orientation only; the authoritative section list, anchor IDs, and ordering live in `~/.claude/skills/generate-docs/output-templates/cross-cutting.md`.

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

Strip and respect `<!-- docs:manual -->` / `<!-- docs:auto -->` regions and any human-edited content outside auto-islands (same convention as passes 4 and 5). Re-runs must regenerate only the auto-regions and then update `docs/.metadata.json` with the new file hashes and the snippet-bundle version they were generated from.

## After completion

If running in `--group` mode, proceed to `prompts/07-group-synthesis.md`. Otherwise skip directly to `prompts/08-cross-link.md`.

# Cross-link format

## Within a repo

Markdown relative path:
```
[OrderService.create_order](../services.md#create_order)
```

Always use relative paths so docs work both on GitHub and after directory moves.

**Never link to `README.md`** — the skill no longer writes README.md; the homepage is `index.md` (with VitePress hero frontmatter). For "the docs homepage" link, use the folder reference:

✓ `[home](../../)` or `[home](../../index.md)` or simply `[home](/)`
✗ `[home](../../README.md)`

For module homepages, link to `index.md` if it exists, else to the folder:

✓ `[orders](../orders/index.md)` or `[orders](../orders/)`
✗ `[orders](../orders/README.md)`

## Cross-repo (within a group)

Resolve via the gfleet registry. Format:

```
[`<repo>/<module>.<symbol>`](../../<other-repo-relative>/docs/modules/<module>/<artifact>.md#<anchor>)
```

Example mobile → backend:
```
Calls `POST /api/v1/orders/` (backend handler:
[`myapp-backend.orders.api.create_order`](../../../myapp-backend/docs/modules/orders/api.md#post-apiv1inspections)).
```

To compute the relative path:
1. From gfleet registry, get `repoA_path` (current) and `repoB_path` (target).
2. Find their common ancestor.
3. Compute `from <current_doc> to <target_doc>` via `path.relative()`.

## Anchor slug rules (GitHub-flavored)

Heading → anchor:
- `## Create order` → `#create-order`
- `### POST /api/v1/orders/` → `#post-apiv1inspections`
- `### \`OrderService.create_order()\`` → `#inspectionservicecreate_inspection`
- `### 🟡 Permissions` → `#-permissions` (emoji becomes empty, leading dash)
- `### handle_event(event_id)` → `#handle_eventevent_id`

Slugify: lowercase, replace each non-alpha-numeric with dash, collapse consecutive dashes, strip leading/trailing dashes. Note: `_` is preserved; `.` becomes empty (NOT dash).

Pass 8 verifies anchors against actual headings.

## Glossary back-links

When a glossary term appears in body text:
```markdown
The [order](../../<group_docs>/product/glossary.md#order) is created in `scheduled` status...
```

Only first occurrence in each file. Skip headings, code, existing links.

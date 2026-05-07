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

## Cross-repo links to docs that don't exist yet

When a doc would link to a sibling repo whose docs haven't been generated yet (or whose target page hasn't been written this run), write the link AS IF the doc exists, mark it as cross-repo-pending, and append the link target + source location to `<repo>/docs/.cross-repo-pending.md`. Pass 8 will validate: anchors that have since become real are unmarked; broken ones stay flagged.

Two equivalent ways to mark the link (pick the one that fits the surrounding prose; both are detected by Pass 8):

1. HTML wrapper around the markdown link (preferred when the link is inline in a sentence):
   ```markdown
   Calls <span class="cross-repo-pending">[`myapp-mobile.scheduling.useSchedule`](../../../myapp-mobile/docs/modules/scheduling/hooks.md#useschedule)</span>.
   ```
2. Footnote-style suffix (preferred in tables and tight bullet lists where HTML is awkward):
   ```markdown
   - Caller: [`myapp-mobile.scheduling.useSchedule`](../../../myapp-mobile/docs/modules/scheduling/hooks.md#useschedule)[^cross-repo]
   ```
   With one `[^cross-repo]: cross-repo-pending — Pass 8 will resolve.` footnote per file.

Append to `<repo>/docs/.cross-repo-pending.md`:
```markdown
- <source-doc>:<line> → <target-rel-path>#<anchor>  (<reason: target repo not generated yet | target page missing>)
```

Pass 8 reads `.cross-repo-pending.md` first, attempts to resolve each entry against the now-current state of all repos in the group, removes the marker for resolved entries, and leaves the remaining entries flagged.

## Glossary back-links

When a glossary term appears in body text:
```markdown
The [order](../../<group_docs>/product/glossary.md#order) is created in `scheduled` status...
```

Only first occurrence in each file. Skip headings, code, existing links.

# Cross-link format

## Within a repo

Markdown relative path:
```
[InspectionService.create_inspection](../services.md#create_inspection)
```

Always use relative paths so docs work both on GitHub and after directory moves.

## Cross-repo (within a group)

Resolve via the gfleet registry. Format:

```
[`<repo>/<module>.<symbol>`](../../<other-repo-relative>/docs/modules/<module>/<artifact>.md#<anchor>)
```

Example mobile → backend:
```
Calls `POST /api/v1/inspections/` (backend handler:
[`upvate_core.inspections.api.create_inspection`](../../../upvate_core/docs/modules/inspections/api.md#post-apiv1inspections)).
```

To compute the relative path:
1. From gfleet registry, get `repoA_path` (current) and `repoB_path` (target).
2. Find their common ancestor.
3. Compute `from <current_doc> to <target_doc>` via `path.relative()`.

## Anchor slug rules (GitHub-flavored)

Heading → anchor:
- `## Create inspection` → `#create-inspection`
- `### POST /api/v1/inspections/` → `#post-apiv1inspections`
- `### \`InspectionService.create_inspection()\`` → `#inspectionservicecreate_inspection`
- `### 🟡 Permissions` → `#-permissions` (emoji becomes empty, leading dash)
- `### handle_event(event_id)` → `#handle_eventevent_id`

Slugify: lowercase, replace each non-alpha-numeric with dash, collapse consecutive dashes, strip leading/trailing dashes. Note: `_` is preserved; `.` becomes empty (NOT dash).

Pass 8 verifies anchors against actual headings.

## Glossary back-links

When a glossary term appears in body text:
```markdown
The [inspection](../../<group_docs>/product/glossary.md#inspection) is created in `scheduled` status...
```

Only first occurrence in each file. Skip headings, code, existing links.

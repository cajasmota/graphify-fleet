<!-- Template: per-ViewSet/controller/handler-group api file. -->
<!-- Subagent: copy this template, fill in placeholders, then run snippets/verification-checklist.md before returning. -->
<!-- Graph-searchability: apply conventions/_graph-searchability.md — every class/function/path/route in backticks, INCLUDING in headings (e.g. `### \`OrderViewSet\``); language-tag every fenced code block. -->

<!-- docs:auto -->
# `{{ClassName}}`

<!-- auto:start id=summary -->
{{One paragraph: what this class owns + which models/resources it operates on. Use domain terms from docs-config.json vocabulary.}}

| | |
|---|---|
| **Source** | [`{{source_path}}:{{class_start_line}}`]({{relative_source_link}}) |
| **Mounted at** | `{{base_path_from_urls}}` |
| **Auth (default)** | {{class-level permission classes — pulled from `permission_classes` attribute}} |
| **Cross-repo callers** | {{Either: "graph search returned no callers" OR: "called by `myapp-frontend` (3 endpoints), `myapp-mobile` (5 endpoints) — see per-action sections"}} |
<!-- auto:end -->

<!-- auto:start id=actions-toc -->
## Actions in this ViewSet ({{N}})

This is the completeness checklist for this file. Every row MUST have a section in the "Endpoints" block below. If any row is missing a section, the file is INCOMPLETE — re-run `/generate-docs --section <this-file>`.

| | Endpoint | Notable |
|---|----------|---------|
| 🟢 | [GET `/api/v1/{{path}}/`](#-get-apiv1path) | {{one-line of non-trivial behavior, or blank}} |
| 🟡 | [POST `/api/v1/{{path}}/`](#-post-apiv1path) | {{e.g., "Auto-creates ContractDevice + UserContract on save"}} |
| 🔵 | [PUT `/api/v1/{{path}}/{id}/cancel/`](#-put-apiv1pathidcancel) | {{e.g., "Side effect: creates system note"}} |
| 🟣 | [PATCH `/api/v1/{{path}}/{id}/`](#-patch-apiv1pathid) | |
| 🔴 | [DELETE `/api/v1/{{path}}/{id}/`](#-delete-apiv1pathid) | |
| 🟢 | [GET `/api/v1/{{path}}/get_counts/`](#-get-apiv1pathget_counts) | {{e.g., "Returns device counts (not contract counts)"}} |

Method emoji legend: 🟢 GET · 🟡 POST · 🔵 PUT · 🟣 PATCH · 🔴 DELETE · ⚪ HEAD/OPTIONS
<!-- auto:end -->

<!-- auto:start id=actions -->
## Endpoints

### 🟢 GET `/api/v1/{{path}}/`

> {{One-line summary in domain terms — what this endpoint returns, mention any non-obvious behavior here so a reader scanning never misses it.}}

**Auth**: {{permission classes for this action — may override class default}}

<details>
<summary><b>📋 Parameters</b> ({{count}})</summary>

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `{{name}}` | path/query/body | {{type}} | ✓ / — | {{what it does. If absent: behaviour. If changes execution path: explain how.}} |
| `{{name}}` | query | string | — | {{e.g., "Switches strategy when `renew` — see How it works"}} |

</details>

<details>
<summary><b>📥 Request body</b></summary>

```json
{
  "field_1": "...",
  "field_2": 123
}
```

**Validation rules:**

| Field | Required | Constraints |
|-------|----------|-------------|
| `field_1` | ✓ | {{e.g., "max_length=200, must match regex"}} |
| `field_2` | — | {{e.g., "min=2000, max=current_year+1"}} |
| `field_3` | ✓ | {{cross-field: "must be ≤ end_date"}} |

</details>

<details>
<summary><b>📤 Response 2xx</b></summary>

```json
{
  "count": 15,
  "results": [{ "id": 1, "...": "..." }]
}
```

</details>

<details>
<summary><b>⚠️ Errors</b></summary>

| Status | When | Body |
|--------|------|------|
| 400 | `year` missing or non-integer | `{"detail": "year is required and must be an integer"}` |
| 403 | User lacks `IsClientOwner` for this resource | `{"detail": "You do not have permission..."}` |
| 404 | Referenced contract doesn't exist | `{"detail": "Not found."}` |

</details>

<details open>
<summary><b>⚙️ How it works</b></summary>

{{**Plain natural language** explaining what the handler does and why. NOT code with comments. The reader who wants the code clicks the source link.}}

{{Walk through the logic step-by-step in prose. Describe what each branch does, what each non-obvious filter is for, why a particular pattern was chosen. Mention performance characteristics (parallelism, caching, N+1 avoidance) if relevant. Mention race conditions and how they're handled.}}

{{If the action is trivial CRUD with no notable logic: write "Standard ORM persist/delete with no extra logic" and move on. Don't pad.}}

{{Example for the proposal renewal endpoint:}}

When `proposal_status=renew` is passed, the handler builds two parallel querysets and unions them.

The primary queryset finds contracts already marked as renewals for the requested year. The fallback queryset catches buildings that fell out of the renewal queue — when their prior contract expired in `year - 1` but no `year` renewal proposal exists yet. Without this fallback, those buildings would silently disappear from the renewal listing.

Both querysets share a base filter: the building must be active, the contract isn't `testing_covered_in_contract` (those are bundled into a parent contract, not standalone), and at least one of the contract's devices has active settings. The base filter applies independently to each queryset; results are merged with `.distinct()` and then paginated.

Serialization runs in parallel via `ThreadPoolExecutor` because each row's `ContractWithExtrasSerializer` makes JOIN-heavy lookups, and parallelism gives a measurable speedup at typical response sizes.

For all other `proposal_status` values, this is a single filtered queryset on `start_date__year=year` — no fallback, no union.

</details>

<details>
<summary><b>📦 Side effects</b></summary>

{{List all side effects — DB writes beyond the primary record, signal fires, queue puts, email sends, cache invalidations. If none: "**None** — read-only / single-record write."}}

- Creates `ContractDevice` rows for every active device on the building
- Creates `UserContract` rows for client contacts whose `types` contains `"contract_proposals"` (via `get_or_create`)
- Fires `proposal.created` signal (subscribed by `notifications` module)
- Queues `send_proposal_email` celery task

</details>

::: tip Source
Handler: [`{{ClassName}}.{{method_name}}`]({{relative_source_link}}#L{{line}})

{{If this action has cross-repo callers, list them here. Otherwise omit the whole "Cross-repo callers" line — the file-level summary covered it.}}

Cross-repo callers:
- Mobile: [`{{caller_function}}`]({{relative_path}}#{{anchor}})
- Frontend: [`{{caller_hook}}`]({{relative_path}}#{{anchor}})
:::

---

{{repeat the section above for EVERY action listed in the actions-toc table.

If the action triggers a state machine transition or coordinates ≥3 collaborators or has ≥3 distinct side effects, also include a mermaid sequenceDiagram OR stateDiagram inside the "How it works" section — see snippets/verification-checklist.md.}}

<!-- auto:end -->

<!-- auto:start id=footer -->
*Generated by `/generate-docs`. Last regenerated: {{ISO-date}}. Source SHA: {{file_sha}}.*
<!-- auto:end -->

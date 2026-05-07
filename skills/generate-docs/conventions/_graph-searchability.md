# Cross-cutting convention: graph-searchability (the backtick contract)

**Applies to every stack.** This file is the single, mandatory cross-reference shared by all stack conventions. The underscore prefix marks it as a cross-cutting convention rather than a stack-specific one.

Read this once at the start of any writing pass (Pass 3 onward). The rules here are the contract that makes generated docs queryable through the same MCP graph that indexes code.

## Why this matters (the concrete payoff)

Graphify's markdown extractor (`extract_markdown` in `graphify/extract.py`, around line 4245) ingests every `.md` file we generate and produces:

- A node for the file itself
- A node for each heading (`#`, `##`, `###`, ...) — node ID derived from the **full heading text** via `_make_id(stem, title)` (lowercase, non-alphanumeric replaced with `_`)
- A node for each fenced code block (the language tag becomes part of the label)
- Edges:
  - `file --contains--> heading`
  - parent heading `--contains-->` child heading (nested by level)
  - heading `--contains-->` code block
  - heading `--references-->` other graph node, when a backtick `` `Name` `` (in heading text or in body prose under that heading) matches a known node ID

That last edge is the high-value one. When a heading like `` ### `OrderViewSet` `` exists, its slugified ID matches the code node already extracted from `views.py` for the same symbol — and graphify can traverse from documentation back to code (and vice versa) at query time. Agents asking the MCP "how does order creation work?" then get BOTH the source code AND the doc heading in one result set.

This only works when documentation is disciplined about backticks. Plain prose mentioning `OrderViewSet` without backticks is invisible to the linker.

## The backtick contract (mandatory rules)

### 1. Every code identifier MUST be in backticks every time it appears

Every occurrence — not just the first mention — in prose, headings, table cells, list items, and inline notes. This applies to:

- Class names (`OrderViewSet`, `InspectionService`)
- Function and method names (`create_inspection()`, `getOrders`, `OrderService.create_order`)
- File paths (`src/orders/views.py`, `app/api/orders/route.ts`)
- Module / package names (`core.orders`, `@app/orders`)
- Route names / URL paths (`POST /api/v1/orders/`, `inspections.list`)
- Environment variables (`DATABASE_URL`, `SENTRY_DSN`)
- CLI flags and commands (`--refresh`, `npm run dev`, `manage.py migrate`)
- Decorators (`@shared_task`, `@Injectable()`)
- HTTP headers, config keys, signal names (`x-api-key`, `proposal.created`)

The rule is contract-shaped: backticks are a promise that the thing inside is a real code identifier the graph can resolve.

### 2. Headings naming a specific symbol use backticks IN the heading

When a heading is about a specific code symbol, the symbol goes in backticks INSIDE the heading text:

- Correct: `` ### `OrderViewSet` ``
- Correct: `` ### `useInspections` ``
- Correct: `` ### POST `/api/v1/orders/` ``
- Wrong: `### OrderViewSet (class)` — graphify won't pick up an unbacktick'd identifier
- Wrong: `### Order Viewset` — typecase mismatch breaks reference matching
- Wrong: `### OrderViewSet — the class that handles orders` — descriptive heading; the symbol is still naked

This is the pattern graphify keys off because the heading slug (`<stem>_orderviewset`) collides with the code node's slug, producing the high-value reference edge.

### 3. Fenced code blocks ALWAYS carry a language tag

```python
class OrderViewSet(ModelViewSet):
    ...
```

```ts
export function useInspections(filter?: InspectionFilter) { ... }
```

```bash
graphify save-result --question "..." --type query
```

Bare triple-backtick blocks (no language tag) produce code-block nodes with weak `file_type` metadata. Always tag the language so the node carries the right type. Use the canonical names: `python`, `ts`, `tsx`, `js`, `jsx`, `go`, `java`, `kotlin`, `rb`, `sql`, `bash`, `shell`, `json`, `yaml`, `toml`, `dockerfile`, `mermaid`.

### 4. File paths use backticks AND `file:line` form when pointing at a line

In prose:

> The handler validates capacity in `core/orders/services.py:45` before persisting.

In a Source link:

```markdown
[`core/orders/services.py:45`](../../core/orders/services.py#L45)
```

Both the link text and the bare path mention go in backticks. The `file:line` form lets graphify match against per-file line nodes when those exist.

### 5. What NOT to backtick

Backticks are reserved for real code identifiers. Don't backtick:

- Plain English nouns ("the order creation flow", "the renewal queue")
- Module / feature concepts that aren't code symbols ("billing concern", "auth surface")
- Role / actor names ("inspector", "customer admin")
- Generic verbs and adjectives

Over-backticking is just as bad as under-backticking — every backticked term is a query the graph will try to resolve. Spurious backticks pollute the link results.

A useful test: "If I `grep` the codebase for this exact string, do I expect to find a definition?" If yes, backticks. If no, plain prose.

## Anti-patterns (do not emit any of these)

- **Bold or italic around code symbols**: `**OrderViewSet**` or `_OrderViewSet_` — graphify scans for backticks, not emphasis. Bold for emphasis is fine on plain English; never use it as a substitute for backticks on a code symbol.
- **Quotation marks around code symbols**: `"OrderViewSet"` or `'OrderViewSet'` — same problem; the graph won't pick this up.
- **Naked identifier in prose**: `The OrderViewSet handles cancellations.` — the bare `OrderViewSet` is invisible to the reference linker.
- **Heading typecase drift**: `### Order Viewset` or `### order_viewset` when the actual class is `OrderViewSet` — the slugifier normalizes case but a misspelling stays misspelled. Match the exact symbol identifier from the code.
- **Heading with descriptive suffix that buries the symbol**: `### OrderViewSet — the class for orders` — the slug becomes `<stem>_orderviewset_the_class_for_orders` and no longer matches the code node. Keep the symbol on its own and put any description in the prose underneath.
- **Code blocks without a language tag** when the content is real code.
- **Annotated code blocks used as a substitute for prose** (already banned by the `04-cluster.md` "How it works" rule). The combination of unannotated source link + plain-prose explanation is what graphify can index well; annotated code dumps are the worst of both worlds.

## Quick examples

### Heading naming a class

```markdown
### `OrderViewSet`

> Handles the order CRUD lifecycle plus cancellation.

The `OrderViewSet.cancel` action sets `status='cancelled'` and creates a system
`ContractNote` recording the reason. See `core/orders/views.py:142`.
```

The heading slug matches the code's `OrderViewSet` node ID. Inside the prose, every code symbol (`OrderViewSet.cancel`, `status`, `ContractNote`, `core/orders/views.py:142`) is backticked, so each one becomes a reference candidate.

### Heading naming an HTTP route

```markdown
### POST `/api/v1/orders/`

> Creates a new order. Calls `OrderService.create_order`.

Implemented in `core/orders/views.py:88`. Validates the body via
`CreateOrderSerializer` then delegates to the service layer.
```

### Heading naming a hook

```markdown
### `useInspections`

> TanStack Query hook for the inspection list.

Reads `useFilterStore` for current filter state. On mount, kicks off
`GET /api/v1/inspections/` (handled by `InspectionViewSet.list` in the backend).
```

### Heading describing a concept (no backticks)

```markdown
### Renewal strategy

The renewal flow uses a dual-queryset union to catch buildings that fell out of
the renewal queue when their prior contract expired in `year - 1`. The two
querysets are built in `InvoiceViewSet.list` and merged with `.distinct()`.
```

The heading is a concept ("Renewal strategy"), so no backticks. The body still backticks the code symbols (`InvoiceViewSet.list`, `.distinct()`).

## Verification

Before returning a doc as complete, run this check (also in `snippets/verification-checklist.md`):

- [ ] Every code symbol named in the file appears at least once in backticks.
- [ ] Every heading that names a specific symbol uses backticks around that symbol IN the heading text.
- [ ] Every fenced code block has a language tag.
- [ ] No bold / italic / quotes used in place of backticks on code symbols.

If any item fails: fix the file in place. Searchability is not optional — a doc that fails the contract still renders fine for humans but is invisible to the graph, which defeats the point of generating it.

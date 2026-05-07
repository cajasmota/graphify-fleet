# Pass 2 — Plan (mandatory before any file write)

Produce `<repo>/docs/.plan.md`. **Do not write any module/reference/cross-cutting file until this is reviewed (interactive) or self-validated (autonomous).**

## Your goal

Turn the inventory into a concrete, reviewable plan: which **folder structure** each module gets (sized to its complexity, not from a fixed template), which classes/handler-groups become per-file pages, what cross-repo links are expected, what gets skipped, and the token estimate.

## R7 — Dynamic folder structure (the most important rule)

A flat artifact list (`api.md`, `models.md`, `flows.md`) does not scale. A 50-line helper module and a 3,472-line ViewSet cannot share the same file shape. **Pass 2 chooses the folder shape per module based on complexity.**

### Per-module decision tree

For each module in the inventory, compute:

- **Total LOC** across all files in the module
- **Class count** — how many distinct classes/ViewSets/handler groups
- **Distinct flow count** — how many separate state machines, pipelines, async flows

Then pick the structure:

```
Module source: total LOC and class count
│
├── Total LOC < 400  AND  single class  AND  ≤2 distinct flows
│   └── FLAT
│       README.md
│       + up to 2 dedicated artifact files (api.md, models.md if present)
│
├── Total LOC 400-1500  OR  2-3 classes  OR  3+ flows
│   └── FLAT-WITH-SPLITTING
│       README.md
│       api.<classname>.md per class (one file per ViewSet/controller class)
│       flows.md (if ≥2 distinct flows)
│       models.md
│       services.md (if separated services layer)
│
└── Total LOC > 1500  OR  4+ classes  OR  3+ distinct flow types  OR  any single class with >10 public methods
    └── SUBFOLDER-PER-ARTIFACT
        modules/<name>/
          README.md
          api/
            index.md            ← lists ViewSets/handlers, links to each
            <classname>.md      ← one file per class — ALL actions, complete
          flows/
            index.md            ← lists flows, links to each
            <flow-name>.md      ← one file per flow
          models.md             (or models/ subfolder if 5+ models)
          services.md           (or services/ subfolder if 5+ services)
```

### R0 — Per-class file splitting boundary

Within FLAT-WITH-SPLITTING and SUBFOLDER tiers, **one artifact file must never cover more than one logical class/handler group.** The split boundary depends on the stack:

| Stack | "One unit" = |
|-------|--------------|
| Django / DRF | One ViewSet or APIView class |
| Express / Fastify / Nest | One router file or controller class |
| FastAPI / Flask | One router (`APIRouter`) or blueprint |
| Go | One handler group (one file or sub-package) |
| React / Next.js | One hook file, component file, or store/slice |
| React Native / Expo | Same as React; navigators are separate units |
| Generic | One class, interface, or exported function group |

When a source file has more than one of these units, OR a single unit has more than 10 public methods/actions/routes:
- The shared `api.md` becomes a **thin index page** listing units and linking
- `api.<unit-name>.md` covers one unit completely

Example: `order_viewset.py` contains `ContractViewSet`, `InvoiceViewSet`, `UserOrderViewSet`, `OrderFileViewSet` (4 classes). The plan must produce:

```
docs/modules/orders/
  README.md
  models.md
  api/
    index.md                ← lists all 4 ViewSets
    order.md             ← ContractViewSet: all 15 actions
    invoice.md             ← InvoiceViewSet: list, get_counts, renew strategy, create
    user-order.md        ← UserOrderViewSet
    order-file.md        ← OrderFileViewSet
  flows/
    index.md
    invoice-lifecycle.md
    renewal-strategy.md
    device-assignment.md
```

NOT:

```
docs/modules/orders/
  api.md                    ← single file covering 4 ViewSets, 30+ actions
                              → forces shallow placeholder docs (the failure mode)
```

## Module slice resolution algorithm (deterministic)

Modules in many stacks (Django being the canonical example) are not single directories — they are domain slices that span `views/<X>`, `serializers/<X>`, `services/<X>/`, `models/<X>.py`, `tasks/<X>.py`, `signals/<X>.py`. Re-runs MUST yield the same slices, so the matching algorithm is fixed:

1. Start from the graphify community detection already produced by Pass 1 (`.inventory.json` carries `community_id` per file via the inventory step).
2. For each community, gather its files. Stem-normalize each filename: strip the suffixes `_viewset`, `_serializer`, `_service`, `_queries`, `_tasks`, `_signals`, `_admin`, plural→singular (`inspections`→`inspection`).
3. Files sharing a normalized stem in adjacent stack directories (`views/`, `serializers/`, `services/<stem>/`, `models/`, `tasks/`, `signals/`, `permissions/`) join the same slice. The slice slug is the normalized stem.
4. **Tie-breaker**: if a file is referenced by 2+ candidate slices, use co-import frequency (graph `CALLS` edges) to pick the dominant slice — the one with the highest sum of edge weights to/from this file. The losing slice keeps the file as a cross-link (recorded under `cross_references[]` on that slice's manifest entry).
5. Emit the slice manifest as `<repo>/docs/.plan.slice-manifest.json`:

```json
{
  "version": 1,
  "generated_at": "<ISO-8601>",
  "algorithm": "stem-normalize+community+co-import-tiebreak",
  "slices": [
    {
      "slug": "inspections",
      "files": ["core/views/inspection_viewset.py", "core/serializers/inspection_serializer.py", "core/services/inspection/queries.py", "core/services/inspection/service.py", "core/models/inspection.py"],
      "community_id": 5,
      "cross_references": [{"file": "core/services/shared/email.py", "won_by": "notifications"}]
    }
  ]
}
```

The manifest makes re-runs deterministic. Stack convention files (`conventions/<stack>.md`) MAY override the directory list in step 3 but MUST keep steps 1, 2, 4, and 5 verbatim.

## Steps

### 1. Read inventory + measure complexity per module

For each module from `.inventory.json`:
- Sum lines of code across the module's files
- Count distinct classes/ViewSets (read just the class declarations — don't dive in yet)
- Identify distinct flows from naming patterns (e.g. `*_lifecycle.py`, separate state-machine files, pipeline modules)

Add to inventory or hold in working memory.

### 2. Apply the decision tree (with deterministic auto-fold)

**Auto-fold rule (deterministic — no user question)**: any module where `total_LOC < 300` AND graphify community size `< 5 nodes` is folded into `reference/misc-endpoints.md` (or the stack-appropriate equivalent — the stack convention names the target file). Record the fold decision under `auto_folded[]` on the plan with the reason. The user can override during Pass 2 review by replying with the module slug to un-fold.

For each remaining module, classify into FLAT / FLAT-WITH-SPLITTING / SUBFOLDER and write the resulting file list.

### 3. Decide cross-cutting AND pre-create stubs with stable anchors

For each cross-cutting concern in the inventory:
- Plan **one** doc in `docs/cross-cutting/<concern>.md`
- In each module that uses it, the relevant section will be a stub linking to the cross-cutting doc

**Pre-create the stub file now** (this is the ordering fix that lets Pass 4 link safely BEFORE Pass 6 has run). For each concern, write `docs/cross-cutting/<concern>.md` containing only:

```markdown
---
status: stub
pass: 6
anchors:
  - summary
  - primary-implementation
  - patterns
  - <pattern-name-1>
  - <pattern-name-2>
  - consumers
  - gotchas
---
<!-- docs:auto -->
# `<Concern>` (cross-cutting)

<!-- pass-6-fill-here -->
```

The `anchors:` list is the contract. Pass 4 writers may link to `../../cross-cutting/<concern>.md#<anchor>` for any anchor in the list. Pass 6 fills the body and verifies every pre-declared anchor is now defined as a heading whose slug matches.

To populate the `anchors:` list, the planner enumerates:
- Always: `summary`, `primary-implementation`, `patterns`, `consumers`, `gotchas` (the canonical template's section IDs).
- Pattern-specific anchors: read the inventory's `cross_cutting[<concern>].files` and grep them for class/decorator declarations (`class\s+(\w+)`, `def\s+(\w+_required)`, `def\s+require_(\w+)`). Each becomes an anchor slug equal to its slugified backticked symbol (e.g. `IsClientOwner` → `isclientowner` per GitHub's slug rules — keep this format consistent across passes).
- God-node anchors (next step): each god node defined in the cross-cutting file gets its node-id as an anchor.

### 3b. Extract god-node canonical descriptions

A "god node" is any node with **≥30 incoming edges** in the per-repo graph. Examples seen in real Django codebases: `CustomPagePermissionCheck` (70 edges), `S3Helper` (93), `MongoDBConnection` (81). Without canonical extraction, each of these gets re-explained in every viewset doc that uses it — pure duplication.

For each god node:
1. Determine its canonical home: the cross-cutting concern whose primary files contain its definition (e.g. `permissions.py` → `permissions` concern, `s3_helper.py` → `storage` concern). If no concern owns it, create one named after the node's module (e.g. `cross-cutting/mongodb.md`) and add it to `cross-cutting[]`.
2. Append the node id to that concern's `anchors:` list.
3. Write a one-paragraph canonical description to `docs/.cache/god-nodes/<node-id>.md`. Read the source definition (signature + docstring + 1-2 callers as context) — this is the only source-reading the planner does, and it is bounded to the god-node files. Keep it under 150 words; this is a snippet, not a doc page.
4. Record in the plan under `god_nodes[]`: `{id, edges, canonical_path, snippet_path}`.

Pass 4 dispatch passes the `snippet_path` to writer subagents; writers reference the canonical anchor and do not re-describe.

### 3c. File-digest pre-pass (cost-saving prerequisite for Pass 4)

For any source file ≥1500 LOC referenced by more than one Pass 4 deliverable (i.e. the file appears in ≥2 entries of the planned file list — typical for splitter cases like a 3,879-LOC viewset whose actions are sharded into multiple `api.<group>.md` files), the coordinator MUST pre-compute a digest BEFORE dispatching writers. Without this, 3 subagents each independently reading a 3,879-LOC file costs ~360k tokens of redundant input.

For each qualifying file, write `docs/.cache/digests/<file-stem>.digest.md` with:

- **Class signatures + line ranges** — `class Foo(Bar): ... # L120-L488`
- **Public method / `@action` / `@router.<verb>` / exported-function list** with line ranges and any decorators
- **Top-level imports** (verbatim — let writers see what's available)
- **Direct dependencies** from the graph: `get_neighbors(file_node, depth=1)` — list neighbor node labels with the kind of edge
- **Class-level attributes**: `permission_classes`, `queryset`, `serializer_class`, `lookup_field`, `pagination_class`, `filterset_class`, etc. — verbatim values

Pass 4 writer subagents are given the digest path in their dispatch payload and are instructed: "READ THE DIGEST FIRST. Then read only the specific line ranges you need from the source file. Do NOT read the full file unless the digest is missing or you've identified that closure depth-1 is insufficient." This is the single biggest cost reduction in the pipeline.

Record digest paths in the plan under `digests[]`: `{source_path, loc, digest_path, consumers: [<doc-paths>]}`.

### 4. Decide reference pages

Based on `repo_wide` items:
- `reference/config.md` — env vars, settings, feature flags
- `reference/scripts.md` — npm scripts, manage.py commands, makefile targets
- `reference/deployment.md` — CI/CD, Dockerfile, deploy targets
- `reference/dependencies.md` — top-level deps with one-line each

Skip files with 0 source items.

### 5. Decide how-to pages

`how-to/local-dev.md` — synthesized from existing README + tooling
`how-to/<task>.md` — one per non-trivial task you find mentioned in README/CONTRIBUTING

### 6. Estimate cross-repo links

For each module, predict which cross-repo links you'll write:
- Backend module with API class → expect inbound links from frontend and mobile
- Frontend/mobile module with services class → expect outbound links to backend api docs

### 7. Token estimate (revised by R7) and per-module cost breakdown

Rough costs to add into the plan (per file):
- Module README: 5k input / 2k output
- API per-class file (small class, <10 methods): 8k input / 3k output
- API per-class file (large class, 10+ methods): 20k input / 6k output (read whole class first per R1)
- Models / services artifact: 6k input / 3k output
- Flow file: 5k input / 2k output (with mermaid)
- Reference page: 4k input / 2k output

Digests reduce per-file input cost: when a writer reads a digest plus targeted line ranges instead of the whole file, multiply that file's input estimate by 0.35 (typical observed reduction).

Sum and add 20% overhead.

**Per-module breakdown is mandatory.** In the modules section of `.plan.md`, each module entry MUST include an `Estimated tokens` line: `<input>k input / <output>k output (~$<dollars>)`. This is what lets the user invoke `--skip-modules <a,b,c>` intelligently.

### 7b. Cost gate decision

Compute the total estimated dollar cost (input @ Sonnet input price + output @ Sonnet output price; document the price assumption next to the number). Compare to the gate (default `$5`, override via `--cost-gate <usd>` arg or `GENERATE_DOCS_COST_GATE` env var; `0` disables the gate).

If the estimate exceeds the gate, the plan must include a **validation slice** section — a deterministic subset Pass 4-6 will run first, before asking the user to confirm the rest:

- Top 3 modules by 🔴-risk marker, ties broken by descending LOC.
- Top 2 cross-cutting concerns by `used_in_modules` count, ties broken alphabetically.

Write this list under `## Validation slice` in `.plan.md`. The coordinator runs Passes 3-6 ONLY for the slice, then prints observed cost and asks the user to reply `continue` or `stop`. There is no LLM judgment in slice selection — the rule is deterministic.

Skipped modules from `--skip-modules` are removed from the estimate AND from the validation slice candidate set before this comparison. Auto-folded modules (step 2) are not eligible for the validation slice (they're cheap by definition).

### 8. Write `.plan.md`

Use the template below. Include the **chosen folder shape** per module so Pass 4 can read it directly without re-deciding.

```markdown
# Documentation plan — <repo>

Generated: <timestamp>
Status: PROPOSED   ← change to APPROVED when user confirms (interactive)
                   ← or AUTONOMOUS when self-validated

## Scope summary

- Stack: <stack>
- 8 modules will be documented; 1 will be skipped (too small)
  - 3 FLAT, 3 FLAT-WITH-SPLITTING, 2 SUBFOLDER
- 3 cross-cutting docs
- 4 reference pages
- 2 how-to pages
- Estimated tokens: ~480k input / ~110k output (~$8 with Sonnet)

## Modules

### orders — SUBFOLDER (1850 LOC, 1 ViewSet, 30+ actions, 3 distinct flows) 🔴-risk

Estimated tokens: 95k input / 28k output (~$1.20)

Folder shape:
- modules/orders/README.md
- modules/orders/api/index.md
- modules/orders/api/order-viewset.md      (the only ViewSet — 30 @actions)
                                                     Subdivide further: 30 actions in one file is too long.
                                                     Split by domain group:
- modules/orders/api/lifecycle.md               (create, update_inspections, update_deficiencies)
- modules/orders/api/counts-filters.md          (get_inspection_counts, get_inspection_devices)
- modules/orders/api/me-specific.md             (regional report group operations)
- modules/orders/api/emails.md                  (results email, reminder)
- modules/orders/api/groups.md                  (order group read/write)
- modules/orders/flows/index.md
- modules/orders/flows/status-machine.md
- modules/orders/flows/deficiency-lifecycle.md
- modules/orders/flows/massachusetts-email.md
- modules/orders/models.md

Cross-repo links expected:
- 12 inbound (from myapp-frontend / myapp-mobile services calling these endpoints)

### orders — SUBFOLDER (980 LOC, 4 ViewSets, 3 distinct flows)

Folder shape:
- modules/orders/README.md
- modules/orders/models.md
- modules/orders/api/index.md
- modules/orders/api/order.md          (ContractViewSet: 15 actions)
- modules/orders/api/invoice.md          (InvoiceViewSet)
- modules/orders/api/user-order.md     (UserOrderViewSet)
- modules/orders/api/order-file.md     (OrderFileViewSet)
- modules/orders/flows/index.md
- modules/orders/flows/invoice-lifecycle.md
- modules/orders/flows/renewal-strategy.md
- modules/orders/flows/device-assignment.md

### users — FLAT-WITH-SPLITTING (650 LOC, 1 ViewSet, 1 flow)

Folder shape:
- modules/users/README.md
- modules/users/api.user.md                  (UserViewSet — single file, full)
- modules/users/models.md

### auth — FLAT (290 LOC, 1 class, 1 flow)

Folder shape:
- modules/auth/README.md
- modules/auth/api.md                        (folded — only 1 class, fits under threshold)

### billing — skipped (only 2 nodes)

## Auto-folded (deterministic per step-2 rule: LOC<300 AND community<5)

- `health-checks` → `reference/misc-endpoints.md` (220 LOC, 3 nodes)
- `version-info` → `reference/misc-endpoints.md` (40 LOC, 1 node)

## God nodes (≥30 incoming edges)

| Node | Edges | Canonical home | Snippet |
|------|-------|----------------|---------|
| `CustomPagePermissionCheck` | 70 | `cross-cutting/permissions.md#custompagepermissioncheck` | `docs/.cache/god-nodes/custompagepermissioncheck.md` |
| `S3Helper` | 93 | `cross-cutting/storage.md#s3helper` | `docs/.cache/god-nodes/s3helper.md` |
| `MongoDBConnection` | 81 | `cross-cutting/mongodb.md#mongodbconnection` | `docs/.cache/god-nodes/mongodbconnection.md` |

Pass 4 writers MUST link to the canonical anchor and not re-describe these nodes.

## Digests (files ≥1500 LOC referenced by ≥2 deliverables)

| Source | LOC | Digest | Consumers |
|--------|-----|--------|-----------|
| `core/views/inspection_viewset.py` | 3879 | `docs/.cache/digests/inspection_viewset.digest.md` | `modules/inspections/api/lifecycle.md`, `modules/inspections/api/results.md`, `modules/inspections/api/scheduling.md` |

## Validation slice (run first when cost gate triggers)

Estimated cost $18 exceeds gate $5. Coordinator runs Passes 3-6 for this slice only, then asks the user to continue.

Modules (top 3 🔴-risk):
1. `inspections` (4571 LOC, 🔴-risk)
2. `scheduling` (3120 LOC, 🔴-risk)
3. `orders` (1850 LOC, 🔴-risk)

Cross-cutting (top 2 by consumer count):
1. `permissions` (used in 11 modules)
2. `storage` (used in 7 modules)

## Cross-cutting (3)

### permissions
Touches modules: orders, users, billing, orders (4)
Will write `cross-cutting/permissions.md` summary.
Each module's `permissions.md` will be a 1-paragraph stub linking back.

### error-handling
...

## Reference (4)

- reference/config.md      (env vars: 14, settings.py keys: ~40)
- reference/scripts.md     (manage.py commands: 6, makefile targets: 8)
- reference/deployment.md  (bitbucket-pipelines.yml + Dockerfile)
- reference/dependencies.md (top-level: 28 packages)

## How-to (2)

- how-to/local-dev.md         (synthesizes existing README setup section)
- how-to/openapi-regen.md     (mentioned in README, has dedicated script)

## Skipped

- Module `migrations` — utility, no business logic to document
- Module `wsgi` — config only

## Token estimate

| Pass | Input  | Output | Notes |
|------|--------|--------|-------|
| Inventory   |   3k  |   1k  | already done |
| Overview    |  20k  |   8k  | |
| Cluster     | 380k  |  85k  | EXPENSIVE — subagent target |
| Reference   |  20k  |   8k  | |
| Cross-cut   |  10k  |   4k  | |
| Cross-link  |   3k  |   1k  | |
| **Total**   | 436k | 107k | ~$8 with Sonnet |

## Open questions for the user (interactive only)

- (none; or list any modules where the detection was ambiguous)
```

### 9. Interactive vs autonomous

**Interactive mode**:
After writing `.plan.md`, print:
```
📋 Plan written to <repo>/docs/.plan.md
Review and edit if you want, then reply "approved" to continue, or
edit the file to add/remove modules and reply "re-plan".
```
Stop and wait.

**Autonomous mode**:
Self-validate:
- Any module with 0 god nodes? → skip and note
- Any module with FLAT shape but >2 classes? → upgrade to FLAT-WITH-SPLITTING
- Any module with >1500 LOC but FLAT or FLAT-WITH-SPLITTING? → upgrade to SUBFOLDER
- Total token estimate > 1M? → warn but continue
- Any cross-cutting touching only 1 module? → demote to in-module section
- Auto-fold rule applied per step 2 (LOC<300 AND community<5)? → record in `auto_folded[]`
- Cost gate triggered (estimate > gate)? → write `## Validation slice` section; the coordinator runs only the slice unless the autonomous-spend rule auto-approves the rest (observed slice spend ≤ 1.5× per-module estimate)

Then mark the plan APPROVED in the file and continue.

### 10. Proceed

Once plan is approved (interactive) or self-validated (autonomous):
1. Verify the cross-cutting stub files (step 3), god-node snippets (step 3b), file digests (step 3c), and slice manifest are all written to disk. These are PRECONDITIONS for Passes 4 and 6 — they cannot run safely without them.
2. If the cost gate triggered, set the in-memory flag `validation_slice_only = true` so the coordinator dispatches Passes 3-6 only for the slice modules + slice cross-cutting. After the slice completes, prompt the user (or auto-approve per the autonomous rule) before continuing.
3. Proceed to `prompts/03-overview.md`.

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

## Steps

### 1. Read inventory + measure complexity per module

For each module from `.inventory.json`:
- Sum lines of code across the module's files
- Count distinct classes/ViewSets (read just the class declarations — don't dive in yet)
- Identify distinct flows from naming patterns (e.g. `*_lifecycle.py`, separate state-machine files, pipeline modules)

Add to inventory or hold in working memory.

### 2. Apply the decision tree

For each module, classify into FLAT / FLAT-WITH-SPLITTING / SUBFOLDER and write the resulting file list.

### 3. Decide cross-cutting

For each cross-cutting concern in the inventory:
- Write **one** doc in `docs/cross-cutting/<concern>.md`
- In each module that uses it, the relevant section will be a stub linking to the cross-cutting doc

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

### 7. Token estimate (revised by R7)

Rough costs to add into the plan (per file):
- Module README: 5k input / 2k output
- API per-class file (small class, <10 methods): 8k input / 3k output
- API per-class file (large class, 10+ methods): 20k input / 6k output (read whole class first per R1)
- Models / services artifact: 6k input / 3k output
- Flow file: 5k input / 2k output (with mermaid)
- Reference page: 4k input / 2k output

Sum and add 20% overhead.

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

### orders — SUBFOLDER (1850 LOC, 1 ViewSet, 30+ actions, 3 distinct flows)

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

Then mark the plan APPROVED in the file and continue.

### 10. Proceed

Once plan is approved (interactive) or self-validated (autonomous), proceed to `prompts/03-overview.md`.

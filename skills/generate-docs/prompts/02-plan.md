# Pass 2 — Plan (mandatory before any file write)

Produce `<repo>/docs/.plan.md`. **Do not write any module/reference/cross-cutting file until this is reviewed (interactive) or self-validated (autonomous).**

## Your goal

Turn the inventory into a concrete, reviewable plan: which files will be created, which artifacts get separate pages vs. collapse into READMEs, what cross-repo links are expected, what gets skipped, and the token estimate.

## Steps

### 1. Apply splitting rules per module

For each module in the inventory:

- **Always**: write `README.md`.
- **For each `artifact_type` present in this module**:
  - If item count ≥ 5 OR item is conceptually complex (e.g. one service has 8+ methods, or a single complex query): give it a dedicated file.
  - If item count < 5: fold into `README.md` as a section.
  - If 0 items: skip the file entirely.
  - If item count > 20: split further — propose sub-pages by category (e.g. `api/auth-endpoints.md`, `api/inspection-endpoints.md`).

Read `conventions/<stack>.md` for the canonical artifact set and per-stack thresholds.

### 2. Decide cross-cutting

For each cross-cutting concern in the inventory:
- Write **one** doc in `docs/cross-cutting/<concern>.md`.
- In each module that uses it, the relevant section will be a stub linking to the cross-cutting doc.

### 3. Decide reference pages

Based on `repo_wide` items:
- `reference/config.md` — env vars, settings, feature flags
- `reference/scripts.md` — npm scripts, manage.py commands, makefile targets
- `reference/deployment.md` — CI/CD, Dockerfile, deploy targets
- `reference/dependencies.md` — top-level deps with one-line each on what they're for

Skip files with 0 source items.

### 4. Decide how-to pages

`how-to/local-dev.md` — synthesized from existing README + tooling
`how-to/<task>.md` — one per non-trivial task you find mentioned in README/CONTRIBUTING (running tests, regenerating openapi, building APK, etc.)

### 5. Estimate cross-repo links

For each module, predict which cross-repo links you'll write:
- Backend module with `api` artifact → expect inbound links from frontend and mobile
- Frontend/mobile module with `services` artifact → expect outbound links to backend api docs

Don't resolve the links yet — just note the expected count.

### 6. Token estimate

For each module:
- Per-cluster deep dive cost ≈ (god_node count × 5k input + 1k output)
- Plus reference pass ≈ 30k input / 10k output per repo
- Plus group synthesis ≈ 80k input / 30k output

Sum and add 20% overhead.

### 7. Write `.plan.md`

```markdown
# Documentation plan — <repo>

Generated: <timestamp>
Status: PROPOSED   ← change to APPROVED when user confirms (interactive)
                   ← or AUTONOMOUS when self-validated

## Scope summary

- Stack: <stack>
- 8 modules will be documented; 1 will be skipped (too small)
- 3 cross-cutting docs
- 4 reference pages
- 2 how-to pages
- Estimated tokens: ~340k input / ~78k output (~$5 with Sonnet)

## Modules

### inspections (87 nodes, 12 god nodes)
Files (8):
- modules/inspections/README.md
- modules/inspections/api.md       (12 endpoints — separate file)
- modules/inspections/models.md    (5 models — separate file)
- modules/inspections/services.md  (8 methods — separate file)
- modules/inspections/permissions.md (3 classes — separate file)
- modules/inspections/tasks.md     (2 celery tasks — folded into README, BELOW threshold)
                                                                          ↑ note: only 2, so folded

Cross-repo links expected:
- 12 inbound (from upvate-frontend / upvate-mobile services calling these endpoints)

### auth (34 nodes, 5 god nodes)
...

### billing (skipped: only 2 nodes — not enough for a module page)

## Cross-cutting (3)

### permissions
Touches modules: inspections, users, billing, contracts (4)
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
| Cluster ×8  | 280k  |  60k  | EXPENSIVE — subagent target |
| Reference   |  20k  |   8k  | |
| Cross-cut   |  10k  |   4k  | |
| Cross-link  |   3k  |   1k  | |
| **Total**   | 336k | 82k | ~$5 with Sonnet |

## Open questions for the user (interactive only)

- (none; or list any modules where the detection was ambiguous)
```

### 8. Interactive vs autonomous

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
- Total token estimate > 1M? → warn but continue
- Any cross-cutting touching only 1 module? → demote to in-module section
Then mark the plan APPROVED in the file and continue.

### 9. Proceed

Once plan is approved (interactive) or self-validated (autonomous), proceed to `prompts/03-overview.md`.

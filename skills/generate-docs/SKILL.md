---
name: generate-docs
description: Generate comprehensive, navigable, human-readable documentation for a codebase or a group of related codebases (multi-repo). Uses the graphify knowledge graph for navigation and produces module-organized markdown docs with cross-repo links. Supports incremental updates, plan-before-write, marker-based human/auto regions, and parallel cluster generation via subagents (Claude Code).
trigger: /generate-docs
---

# /generate-docs

You are a senior staff engineer writing documentation that an experienced engineer or a thoughtful PM would actually read. Your output is **module-organized markdown** for one repository, or for an entire **group** of related repositories (e.g., backend + frontend + mobile).

You **never vomit files**. You plan, you ask, you produce focused pages with mermaid diagrams where useful, and you keep your work **incremental and idempotent** across re-runs.

---

## Core principles

1. **Plan before write** — produce `docs/.plan.md` and (in interactive mode) confirm before generating files.
2. **Module-first organization** — group docs by feature/module, not by artifact type.
3. **Per-function depth where it matters** — services, complex queries, algorithms get walkthroughs, not just signatures.
4. **Incremental** — track source-file SHAs in `docs/.metadata.json`; on re-runs, skip pages whose sources didn't change.
5. **Preserve human edits** — every generated section is wrapped in `<!-- auto:start id=... -->` / `<!-- auto:end -->` markers; only auto regions are regenerated.
6. **Cross-link, never duplicate** — when one repo's doc references another's symbol, write a link, not a re-explanation.
7. **Surface uncertainty** — sections you're unsure about get a 🟡 marker and appear on the run summary.
8. **Respect the budget** — token-cheap when possible (skip unchanged), expensive only on the cluster pass.

---

## Inputs you'll receive at invocation

The user will trigger you in one of these forms:

- `/generate-docs` — current repo only (default scope)
- `/generate-docs --all` — every repo in the group + group synthesis, in one invocation
- `/generate-docs --setup-only` — runs Pass 0 (domain Q&A) only and stops
- `/generate-docs --autonomous` — no plan-confirmation prompts; use cached config
- `/generate-docs --group` — group-level synthesis only (assumes per-repo docs already exist)
- `/generate-docs --refresh` — only regenerate sections whose sources changed (idempotent)
- `/generate-docs --section <path>` — regenerate one section (e.g. `modules/orders/services.md`)
- `/generate-docs --module <name>` — regenerate one whole module
- `/generate-docs --since <gitref>` — regenerate sections affected by commits since `<gitref>`

If the user passes a path, treat that as the repo root. Default to `.`.

---

## Configuration files you must consult

Before doing anything, locate and read:

| File | Purpose |
|------|---------|
| `~/.graphify-fleet/registry.json` | Find the group this repo belongs to |
| `~/.graphify-fleet/groups/<group>/docs-config.json` | Domain context, group docs path, module overrides |
| `<repo>/graphify-out/GRAPH_REPORT.md` | Communities, god nodes |
| `<repo>/graphify-out/graph.json` | Full per-repo graph (read selectively, not whole file) |
| `~/.graphify/groups/<group>.json` | Merged cross-repo graph (read selectively) |
| `<repo>/docs/.metadata.json` | Per-section source-file SHAs (if exists) |
| `<repo>/docs/.stale.md` | Auto-maintained list of likely-stale sections |
| `<repo>/docs/.plan.md` | Last run's plan (if exists) |

If `docs-config.json` doesn't exist OR `docs-config.json` has `domain: null` (stub created by `gfleet wizard`), you must run **Pass 0** first (domain context Q&A). If the user runs you in `--autonomous` and Pass 0 hasn't been completed, fail loudly with: "Run `/generate-docs` interactively first to complete domain setup."

After Pass 0 completes, by default **continue automatically** into Pass 1 (inventory) and the rest of the flow. The user shouldn't have to invoke twice.

Use `--setup-only` only when the user wants to stop after Pass 0 — for example, to review the saved domain config without committing to a full doc generation immediately.

---

## The pipeline (10 passes)

Each pass has a dedicated prompt file in `prompts/`. **You must read the relevant prompt file at the start of each pass and follow its instructions exactly.** This keeps your active context minimal.

| # | Pass | When to run | Prompt file |
|---|------|-------------|-------------|
| 0 | Domain context Q&A | Only if config missing | `prompts/00-domain-context.md` |
| 1 | Inventory | Always; cheap | `prompts/01-inventory.md` |
| 2 | **Plan** | Always; mandatory before any file write | `prompts/02-plan.md` |
| 3 | Repo overview | After plan confirmed | `prompts/03-overview.md` |
| 4 | **Per-cluster deep dive** | After overview; expensive; subagent target | `prompts/04-cluster.md` |
| 5 | Reference pages | After clusters | `prompts/05-reference.md` |
| 6 | Cross-cutting concerns | After clusters | `prompts/06-cross-cutting.md` |
| 7 | Group synthesis | Only if `--group` mode AND all repos have run | `prompts/07-group-synthesis.md` |
| 8 | Cross-link verification | Always last | `prompts/08-cross-link.md` |
| 9 | VitePress static-site config | Default-on; opt out with `--no-static-site` | `prompts/09-vitepress.md` |

---

## Stack-specific conventions

After reading `prompts/01-inventory.md`, you must determine the repo's stack (the gfleet config tells you, e.g. `react-native`, `python`, `node`, `go`, `infra-terraform`, `infra-cdk`, or `generic`). Then read the matching file from `conventions/`:

```
conventions/
├── django.md           ← Python+Django specifically
├── fastapi.md          ← FastAPI (use this instead of python-generic when applicable)
├── python-generic.md   ← Python without Django
├── react.md            ← React (Vite, Next, CRA)
├── react-native.md     ← Expo / RN
├── vue.md              ← Vue (Nuxt, Vite-Vue, Quasar)
├── sveltekit.md        ← SvelteKit / Svelte
├── flutter.md          ← Flutter / Dart
├── rails.md            ← Ruby on Rails
├── spring.md           ← Spring Boot (Java / Kotlin)
├── go.md
├── infra-terraform.md
├── infra-cdk.md
└── generic.md          ← fallback
```

If your stack isn't here yet, run `gfleet conventions add` to draft a new one (interactive, AI-assisted via the `extend-convention` skill).

The convention file tells you:
- What "module" means in this stack
- Which artifact files to produce per module (api.md vs components.md vs handlers.md)
- Splitting thresholds (when one file becomes multiple)
- Stack-specific patterns to look for

---

## Scope: single repo vs whole group

**Default scope is the current repo only.** The skill runs on whatever repo you invoked it from.

**With `--all` flag**: orchestrate all repos in the group, then synthesize:
1. Read the gfleet registry to discover all repos in the group + their paths.
2. For each repo, run the full per-repo pipeline (Pass 1-6).
   - On Claude Code with the Agent tool: spawn one subagent per repo, in parallel batches of 2-3 (subagents themselves use further subagent batches for cluster passes).
   - On Windsurf: process repos sequentially in your own context.
3. After all per-repo runs complete, run **Pass 7 (Group synthesis)** which uses the merged group graph and the per-repo `.inventory.json` files.
4. Run **Pass 8 (Cross-link)** across all generated docs (per-repo + group).
5. Print a unified run summary covering every repo + group.

For the user, `--all` means: one invocation, complete documentation of the whole group. Cost is higher (3× the per-repo cost + group synthesis cost), but no IDE-juggling.

If you're running `--all` and Pass 0 (domain Q&A) is needed, do it ONCE at the start, before per-repo orchestration. The same domain context applies across all repos.

## Runtime detection — Claude Code vs Windsurf

At the top of Pass 4 (cluster deep dive), check whether the **Agent tool** (subagent dispatch) is available in your runtime.

**If Agent tool is available (Claude Code):**
- Process clusters in parallel batches of 5 via subagents.
- Each subagent receives one cluster's source files + `prompts/04-cluster.md` + the relevant `conventions/<stack>.md`.
- Each subagent returns a single finished markdown file.
- You collect, write to disk, update `docs/.metadata.json`.
- This keeps your own context lean and parallelizes the slow work.

**If Agent tool is NOT available (Windsurf):**
- Process clusters sequentially in your own context.
- After every 10 clusters, write progress to `docs/.plan.md` checkpoint section so a partial failure doesn't lose work.
- Use the same prompt file; just no parallelism.

The subagent prompt is `prompts/04-cluster.md` — read it once and pass it (along with cluster-specific data) when spawning.

---

## Output marker rules (CRITICAL — read once at start)

Every markdown file you generate uses these markers. Read `snippets/auto-marker-rules.md` for the full rules. Quick version:

```markdown
<!-- docs:auto -->
# Orders module

<!-- auto:start id=overview -->
This module handles the order lifecycle from creation through publication.
<!-- auto:end -->

<!-- human:start -->
> Note: We're migrating to the new state machine in Q3.
<!-- human:end -->

<!-- auto:start id=key-concepts -->
## Key concepts
...
<!-- auto:end -->
```

On re-runs:
- Files with `<!-- docs:manual -->` at top → never touch
- Files with `<!-- docs:auto -->` at top → regenerate auto:* blocks only
- Preserve all human:* blocks and any prose between blocks
- If you must split or restructure a file, move the human content faithfully

---

## Confidence markers

Two distinct markers — read `snippets/confidence-markers.md` for full rules. Quick version:

- **🟡 Uncertain** — you read the code, but conclusion is sparse/inferred. *Document a guess; reader verifies.*
- **🔴 Incomplete** — you ran out of budget/context. **List the specific unread items by name. Never write a vague "N additional methods to be confirmed" placeholder** — that misleads readers into thinking the section was at least reviewed.

Both propagate to the run summary, separately. 🔴 sections become the next-run target list.

---

## Cross-repo links

When you find a call to another repo (mobile → backend, frontend → backend), write a link in this format:

```markdown
Calls `POST /api/v1/orders/` (backend handler:
[`myapp-backend/orders.api.create_order`](../../../myapp-backend/docs/modules/orders/api.md#post-apiv1inspections)).
```

Pass 8 (cross-link verification) will confirm the anchor exists. If not, it falls back to a non-anchored link with `(anchor TBD)` and adds the broken link to the run summary.

To resolve cross-repo paths: read the gfleet registry to find each repo's filesystem path, then compute a relative path from the current doc to the target.

---

## Plan-first enforcement

You **must not** write any module/reference/cross-cutting file before:
1. Pass 2 has run.
2. `docs/.plan.md` exists and was reviewed (interactive) or self-validated (autonomous).

If asked to skip the plan, refuse and explain why. The plan prevents over-generation.

---

## Stale tracking

After every successful pass, update `docs/.metadata.json` with the source-file SHAs for the sections you wrote. The post-commit hook reads this metadata to maintain `docs/.stale.md` between your runs.

On every run, read `docs/.stale.md` first. If `--refresh` mode, regenerate only what's listed there.

---

## Run summary (always print at end)

When you complete a run, print a structured summary:

```
✓ generate-docs complete — repo: myapp-backend, group: myapp

Generated/updated:
  - 8 modules (~/Documents/Projects/MyApp/myapp-backend/docs/modules/)
  - 3 cross-cutting docs
  - 4 reference pages
  - 11 mermaid diagrams

Skipped (unchanged):
  - 12 modules

Flagged 🟡 for review (5):
  - modules/orders/services.md (3 sections)
  - modules/billing/api.md (1 section)
  - cross-cutting/permissions.md (1 section)

Incomplete 🔴 (requires follow-up) (3):
  - modules/orders/api.order.md   [11 unread actions: cancel, get_extras, devices, assigned_devices, assign_devices, assigned_contacts, assign_contacts, assigned_contracts, create_note, delete_note, get_notes]
  - modules/scheduling/api/index.md     [all @actions unread — scheduler_viewset.py is 3,472 lines]
  - modules/mobile-api/README.md        [all @actions unread]

  → To resolve: /generate-docs --section <each-path-above>
  → Or: /generate-docs --module <module-name>

Cross-repo links:
  - 18 created
  - 2 broken (anchor TBD) — see .plan.md "broken-links" section

Knowledge persisted via save-result: 23 findings (per-module)
  - 8 cross-repo flows
  - 11 emergent behaviors
  - 4 architectural patterns

Token usage: 312k input / 78k output
Wall time: 6m 42s

Next steps:
  1. Resolve 🔴 incomplete sections (highest priority — those are gaps, not guesses)
  2. Review 🟡 sections
  3. Run /generate-docs --group  (group-level synthesis)
```

**Important for the run summary**:
- 🔴 incomplete count is the most important number — surface it at the top, distinct from 🟡
- For each 🔴 section, list the specific unread items by name (not just "N additional methods")
- Always include the resolution command (`--section <path>` or `--module <name>`) so the user can re-run targeted

---

## Closed-loop via `graphify save-result` (use it!)

When you discover a non-trivial fact during doc generation — especially in Passes 4 and 7 — **persist the finding via `graphify save-result`**. The MCP server reads `graphify-out/memory/` alongside the graph, so saved results surface in all future graph queries (yours and other agents') at zero re-compute cost.

When to call `save-result` during doc generation:

| Situation | `--type` | Where it triggers |
|-----------|----------|-------------------|
| Traced a cross-repo HTTP boundary (mobile fn → backend handler) | `path_query` | Pass 4 (mobile/frontend services), Pass 7 (group flows) |
| Identified an emergent behavior (multi-file causal chain) | `query` | Pass 4 (services), Pass 7 (user journeys) |
| Documented an architectural pattern (registry, strategy) | `explain` | Pass 4 (services), Pass 6 (cross-cutting) |
| Worked out a complex query / business rule | `query` | Pass 4 (services, repositories) |

How to call it (Bash tool):

```bash
graphify save-result \
  --question "<the question this section answers>" \
  --answer   "<a 2-5 sentence factual summary, NOT the full doc page>" \
  --type     <query|path_query|explain> \
  --nodes    "<node-label-1>" "<node-label-2>" ...
```

The `--question` should be phrased as a question someone might actually ask the graph later (not a heading). The `--answer` is a *summary*, not the full markdown — keep it dense and factual. `--nodes` lists the canonical node labels you cited.

**Always save** for cross-repo boundaries and emergent behaviors. Skip it for trivial structural facts that the graph already encodes.

After completion, mention the save-result count in the run summary:
```
Knowledge persisted via save-result: 12 findings (4 cross-repo, 6 emergent, 2 patterns)
```

## Closed-loop: doc nodes in the graph

The next `/graphify .` run after you finish will ingest the `docs/` you just
wrote. On future runs you may see doc nodes in graph queries.

Source-of-truth rules when prior docs are in the graph:
1. **Code disagreement**: if a prior doc says X and current code says Y, **code wins**. Regenerate the doc.
2. **`<!-- docs:manual -->` files**: treat as ground truth. Quote from them, cross-link to them, but never overwrite.
3. **Untagged prose** (between auto blocks): treat as human-written. Preserve.
4. **`docs:auto` content**: treat as your own previous guess — useful but not authoritative.
5. **🟡 marked sections from prior runs**: do not cite as fact in new sections.
6. **ADRs and glossary**: high-trust. Use vocabulary and decisions consistently.

This avoids the auto-amplification trap where the skill cites its own past guesses as ground truth.

---

## Now: start working

1. Read `prompts/00-domain-context.md` if `docs-config.json` is missing OR has `domain: null` (stub).
2. **If `--setup-only` flag is present and Pass 0 just completed**: stop. Print "Setup complete — run /generate-docs to continue." Exit. (Without `--setup-only`, continue automatically into Pass 1.)
3. Always read `prompts/01-inventory.md` next.
4. Always read `prompts/02-plan.md` and produce `docs/.plan.md`.
5. In interactive mode: STOP and ask the user to review the plan. Wait for confirmation.
6. In autonomous mode: self-validate the plan (check for obvious problems, modules with 0 nodes, etc.) and continue.
7. Then proceed pass-by-pass per the table above, reading each pass's prompt file when you enter it.
8. Print the run summary at the end.

When in doubt, prefer **fewer, better pages over many shallow ones**.

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

- `/generate-docs` — full flow on the current repo (interactive)
- `/generate-docs --autonomous` — no confirmations; use cached config
- `/generate-docs --group` — group-level synthesis only (after per-repo runs)
- `/generate-docs --refresh` — only regenerate sections whose sources changed
- `/generate-docs --section <path>` — regenerate one section (e.g. `modules/inspections/services.md`)
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

If `docs-config.json` doesn't exist, you must run **Pass 0** first (domain context Q&A). If the user runs you in `--autonomous` and config is missing, fail loudly with: "Run `gfleet docs init <group>` first."

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
| 9 | Optional: mkdocs config | Only if `--with-mkdocs` flag | `prompts/09-mkdocs-config.md` |

---

## Stack-specific conventions

After reading `prompts/01-inventory.md`, you must determine the repo's stack (the gfleet config tells you, e.g. `react-native`, `python`, `node`, `go`, `infra-terraform`, `infra-cdk`, or `generic`). Then read the matching file from `conventions/`:

```
conventions/
├── django.md           ← Python+Django specifically
├── python-generic.md   ← Python without Django
├── react.md            ← React (Vite, Next, CRA)
├── react-native.md     ← Expo / RN
├── go.md
├── infra-terraform.md
├── infra-cdk.md
└── generic.md          ← fallback
```

The convention file tells you:
- What "module" means in this stack
- Which artifact files to produce per module (api.md vs components.md vs handlers.md)
- Splitting thresholds (when one file becomes multiple)
- Stack-specific patterns to look for

---

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
# Inspections module

<!-- auto:start id=overview -->
This module handles the inspection lifecycle from creation through publication.
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

When you're uncertain about something — name inferred without strong evidence, behavior guessed from sparse code, missing context — prefix the section with 🟡:

```markdown
<!-- auto:start id=permissions -->
## 🟡 Permissions

This module appears to use `IsAuthenticated` and a custom `IsClientOwner`
check. *Behavior of `IsClientOwner` was inferred from a single call site —
verify before relying on this section.*
<!-- auto:end -->
```

These propagate to the run summary so the user knows what to review.

---

## Cross-repo links

When you find a call to another repo (mobile → backend, frontend → backend), write a link in this format:

```markdown
Calls `POST /api/v1/inspections/` (backend handler:
[`upvate_core/inspections.api.create_inspection`](../../../upvate_core/docs/modules/inspections/api.md#post-apiv1inspections)).
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
✓ generate-docs complete — repo: upvate-core, group: upvate

Generated/updated:
  - 8 modules (~/Documents/Projects/UpVate/upvate_core/docs/modules/)
  - 3 cross-cutting docs
  - 4 reference pages
  - 11 mermaid diagrams

Skipped (unchanged):
  - 12 modules

Flagged 🟡 for review (5):
  - modules/inspections/services.md (3 sections)
  - modules/billing/api.md (1 section)
  - cross-cutting/permissions.md (1 section)

Cross-repo links:
  - 18 created
  - 2 broken (anchor TBD) — see .plan.md "broken-links" section

Token usage: 312k input / 78k output
Wall time: 6m 42s

Next steps:
  - Review 🟡 sections
  - Run /generate-docs --group  (group-level synthesis)
```

---

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

1. Read `prompts/00-domain-context.md` only if `docs-config.json` is missing.
2. Always read `prompts/01-inventory.md` next.
3. Always read `prompts/02-plan.md` and produce `docs/.plan.md`.
4. In interactive mode: STOP and ask the user to review the plan. Wait for confirmation.
5. In autonomous mode: self-validate the plan (check for obvious problems, modules with 0 nodes, etc.) and continue.
6. Then proceed pass-by-pass per the table above, reading each pass's prompt file when you enter it.
7. Print the run summary at the end.

When in doubt, prefer **fewer, better pages over many shallow ones**.

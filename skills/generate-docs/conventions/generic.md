# Stack convention: generic (fallback)

> Graph-searchability: every generic-stack doc inherits the universal backtick contract from `_graph-searchability.md`. Whatever symbols you discover in the graph (functions, classes, files, modules) go in backticks every time you mention them, including in headings. This is the rule that makes the docs link back to code at query time.

Use this when no specific convention applies: an unknown stack, a polyglot mix, a monorepo with no clear structure, or an experimental layout. The agent's job here is to **detect intent from the graph**, not to apply a template.

## Core principle

The filesystem cannot be trusted to follow any known pattern. **Lean on the graphify graph as the source of truth** for structure, and use natural-language walkthroughs (not annotated code) for the docs.

## Module discovery

Use **graphify communities** as the primary signal:

1. Pull communities from the merged graph (Leiden / Louvain output already attached to nodes).
2. Filter to significant communities: ≥5 nodes AND ≥1 god node (high in-degree or high betweenness).
3. For each surviving community:
   a. Find the dominant directory — which parent path do most god nodes share?
   b. Use that directory's name as the proposed module name.
   c. If no clear directory dominates, use the most common file-name prefix or the highest-centrality node's filename stem.
4. Sort modules by community size (largest first) so the plan review surfaces the biggest first.
5. The user can rename or merge modules in plan review — never block on perfect naming.

Edge cases:
- **Polyglot repo** (e.g. Python backend + JS frontend in one repo): treat the major language directories as separate "sub-repos" and document them under `docs/<language>/`. Note in the index that they are distinct.
- **Monorepo with `packages/`, `apps/`, `services/`, or `libs/`**: treat each top-level entry as a module candidate; flag whether each should be promoted to its own gfleet repo entry.
- **Single tightly-coupled blob** (one giant community, no sub-structure): produce a single module page covering the whole thing; don't force a split that isn't there.

## Canonical artifact files

Don't assume a fixed taxonomy. **Per module**:

- `README.md` — always. Module purpose, public surface, how to enter the code, key files, key dependencies, key consumers.
- Additional per-artifact files only when the graph or naming clearly indicates a separable concern. Detection cues:
  - **API-like** (route handlers, endpoint defs, request handlers, RPC stubs): names containing `route`, `handler`, `controller`, `endpoint`, `view`, `api`, `rpc`. Threshold ≥3 → `api.md`; otherwise fold into README.
  - **Model-like** (data shapes, domain types, schemas): names containing `model`, `entity`, `schema`, `dto`, `type`, `record`. Threshold ≥3 → `models.md`; otherwise fold.
  - **Service / orchestration** (business logic, use cases, coordinators): names containing `service`, `usecase`, `orchestrator`, `manager`, `workflow`. Threshold ≥2 → `services.md`; otherwise fold.
  - **Storage / persistence** (data access, repos, queries): names containing `repository`, `repo`, `store`, `dao`, `query`, `db`. Threshold ≥1 → `storage.md`; otherwise fold.
  - **Background / async** (jobs, tasks, workers, schedulers, listeners): names containing `task`, `job`, `worker`, `consumer`, `listener`, `handler` (when paired with queue/event). Threshold ≥1 → `tasks.md`; otherwise fold.
  - **Config / wiring** (DI containers, config loaders, factories): names containing `config`, `factory`, `module` (DI), `container`, `bootstrap`. Document in README unless ≥2 distinct concerns → `config.md`.
- `flows.md` — when ≥2 services or ≥2 modules collaborate on a coherent operation, draw a sequence/flow diagram.

When unsure whether to split or fold, **fold**. Splits should be earned by content volume.

## How to write each file

Default to **natural-language walkthroughs**, not annotated code. The reader is a human who wants to understand, not a compiler.

### `README.md` (per module)
- One paragraph: what this module is for and where it sits in the system.
- "Entry points" subsection: which files/functions are the front door (god nodes from the graph).
- "Public surface" subsection: what the rest of the system depends on (top inbound edges).
- "Key dependencies" subsection: top outbound edges (other modules / external libs).
- "How to navigate" subsection: 3-5 bullet pointers ("if you're touching X, start at Y").
- Cross-repo links to consumers and providers via the merged graph.

### Artifact files (when split out)
- Group by the most natural unit (class, file, route, command — whichever the codebase uses).
- Per unit: 1-3 paragraphs covering purpose, signature/inputs, behavior, side effects, error modes.
- Mermaid diagrams when orchestration involves ≥3 collaborators or ≥3 sequential steps.
- Code references as file:line anchors, not large code blocks. Quote a single line or signature only when load-bearing.
- Cross-repo links wherever the merged graph shows callers/callees in other repos.

### What to avoid
- Annotated code dumps (paste-and-comment style).
- Per-function tables that mechanically list every name — readers can grep for that.
- Inventing structure the graph doesn't support.
- Documenting test files as if they were product code.

## Confidence and uncertainty

When a stack is unknown, you'll guess. Mark guesses:
- 🟢 derived directly from the graph or explicit code (definitions, imports, decorators).
- 🟡 inferred from naming or weak signals (say so: "appears to be...", "likely...").
- 🔴 unknown / could not verify — surface explicitly so the user knows where to look.

Never silently smooth over uncertainty. A 🟡 marker is more useful than a confident wrong claim.

## Cross-repo links

The merged graph spans repos. For every god node and every public-surface symbol:
- Resolve callers across repos and link them.
- Resolve providers across repos and link them.
- If a symbol is used in N repos with N>3, list the top 3 by call count and summarize the rest.

## Common gotchas

- **Be conservative.** If you can't tell what something is, say so. Don't fabricate a category.
- **Polyglot confusion.** When a single module mixes languages (e.g. Python with embedded SQL or generated protobufs), document the primary language and reference the others — don't try to unify them.
- **Generated code.** If files look auto-generated (banner comments, suspiciously uniform structure, sit under `gen/`, `generated/`, `pb/`, `__generated__/`), exclude them from per-artifact docs and mention generation in README only.
- **Vendored dependencies.** Skip `vendor/`, `third_party/`, `node_modules/`, `_vendor/`, etc.
- **Build outputs and caches.** Skip `dist/`, `build/`, `target/`, `out/`, `.cache/`, `__pycache__/`.
- **No stack-specific patterns assumed.** No "every X has a Y" claims unless the graph shows it.
- **Don't invent idioms.** If the project doesn't use a service layer, don't pretend it does. Document what's actually there.
- **Mark ambiguity.** When two interpretations are plausible, list both and let the user choose at plan review.
- **Tiny modules.** If a "module" has fewer than ~5 meaningful nodes, fold it into a sibling or note it as a utility — don't generate a stub page.

# Stack convention: generic (fallback)

When no specific convention applies (mixed project, monorepo with no clear structure, unusual stack).

## Module discovery

Use **graphify communities only** — filesystem can't be trusted to follow a known pattern.

For each significant community (≥5 nodes, ≥1 god node):
1. Find the dominant directory (most god nodes share which parent path?).
2. Use the directory's name as the proposed module name (or the most common file prefix).
3. The user can override in the plan review.

## Canonical artifact files

Don't assume any specific artifact taxonomy. Per module:
- `README.md` — always
- For each detected pattern (file naming or graph cluster sub-structure), propose a section:
  - "API-like" files (route handlers, endpoint definitions) → fold into README or split if many
  - "Model-like" files (data shapes) → same
  - "Service-like" files (orchestration) → same

The skill's job here is to detect intent from naming and graph structure rather than apply a template.

## Writing rules

Same general principles as `prompts/04-cluster.md`:
- 1-3 paragraphs per significant function
- Mermaid for orchestration
- Cross-repo links via merged graph
- Confidence markers when guessing

## Common gotchas

- If the project is genuinely mixed (e.g. a Python backend + JS frontend in the same repo), treat the major language directories as separate "sub-repos" and document them separately.
- If this is a monorepo with `packages/`, treat each package as a module; consider whether each package should be its own gfleet repo entry.

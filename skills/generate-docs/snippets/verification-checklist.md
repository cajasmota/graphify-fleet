# Verification checklist (run before returning success)

Every subagent (and the orchestrator on Windsurf) MUST run this before marking a file as complete and moving to the next module.

If any item fails: either **fix the file in place** OR mark the section 🔴 INCOMPLETE with specific reason. **Never return success on a file that has unverified items.**

---

## Universal checklist (every file)

Before saving any `.md` output:

- [ ] File starts with `<!-- docs:auto -->` (auto-generated; preserve human edits via markers)
- [ ] All `<!-- auto:start id=X -->` blocks have matching `<!-- auto:end -->`
- [ ] No vague placeholders like "additional N methods to be confirmed", "see source for details", "TODO"
- [ ] No empty sections (heading with no content)
- [ ] No 🟡 used to mean "I didn't read this yet" — that's 🔴
- [ ] Code references include file path AND line number: `path/to/file.py:42`
- [ ] All cross-repo links: either resolved with valid anchors, or written without anchor + added to `.cross-link-todo.md`
- [ ] Last-generated timestamp footer present
- [ ] At least one save-result was written for non-trivial findings discovered while reading source for this file (or explicit reason why none warranted)
- [ ] **Graph-searchability** (per `conventions/_graph-searchability.md`):
  - [ ] Every code symbol named in this doc appears at least once wrapped in backticks (classes, functions, file paths, module/route names, env vars, CLI flags).
  - [ ] Headings that name a specific code symbol put that symbol in backticks IN the heading text (e.g. `` ### `OrderViewSet` ``, NOT `### OrderViewSet (class)`).
  - [ ] Every fenced code block carries a language tag (` ```python `, ` ```ts `, ` ```bash `, etc.) — no bare ` ``` ` blocks for real code.
  - [ ] No bold / italic / quotation marks used as a substitute for backticks on code symbols.
- [ ] **God-node canonical-link rule**: if your doc references any node listed under `## God nodes` in `.plan.md`, you link to its canonical anchor (`../../cross-cutting/<concern>.md#<node-id>`) and you do NOT re-describe the node. A one-line clarification of how THIS module uses it is fine; a paragraph explaining the node itself fails this check.
- [ ] **Cross-cutting anchor links**: every link to `../../cross-cutting/<concern>.md#<anchor>` either targets an anchor in that stub's YAML `anchors:` list, OR you've added the anchor to the list (Pass 6 will define it), OR you've used a non-anchor link with `(anchor TBD)` and added an entry to `.cross-link-todo.md`.
- [ ] **Cross-repo-pending marker**: any cross-repo link to a doc that doesn't exist yet is wrapped in `<span class="cross-repo-pending">...</span>` (or has a `[^cross-repo]` footnote suffix) AND has been appended to `<repo>/docs/.cross-repo-pending.md`.
- [ ] **Glossary auto-append**: every domain term you used in italics or in a definition-tone sentence is in the glossary — either pre-existing (in the human-curated section) or auto-appended by you (in the `<!-- generate-docs:glossary-auto-append:start --> ... <!-- :end -->` block at the bottom). Code symbols (in backticks) are NOT eligible for the glossary.
- [ ] **Digest-first compliance**: if your dispatch payload included a digest path, you read the digest first and only read targeted line ranges from the source. You did NOT full-read the source unless the digest was missing or closure depth-1 was insufficient.

---

## `modules/<name>/api/<class>.md` — per-ViewSet/controller (Swagger-card format)

After writing this file, verify:

- [ ] **File-level summary table** present (Source / Mounted at / Auth / Cross-repo callers) — single source for cross-repo "no callers" so it doesn't repeat per-action
- [ ] **Action TOC** at the top: navigable table with method emoji + path link + at-a-glance column. Every action MUST have a section below (count match)
- [ ] For each endpoint card:
  - [ ] Heading uses method emoji: `### 🟢 GET \`/path\`` (🟢 GET, 🟡 POST, 🔵 PUT, 🟣 PATCH, 🔴 DELETE, ⚪ HEAD/OPTIONS)
  - [ ] One-line summary in a blockquote immediately after the heading
  - [ ] **Auth** stated, always visible (NOT inside `<details>`)
  - [ ] `<details><summary>📋 Parameters (N)</summary>` table when params exist
  - [ ] `<details><summary>📥 Request body</summary>` when applicable: JSON example + validation rules table
  - [ ] `<details><summary>📤 Response 2xx</summary>` JSON example
  - [ ] `<details><summary>⚠️ Errors</summary>` table: status / when / body (only if any non-200 documentable; skip block if truly none)
  - [ ] `<details open><summary>⚙️ How it works</summary>` — **always present, open by default**, plain natural-language walkthrough
  - [ ] `<details><summary>📦 Side effects</summary>` only when there ARE side effects (skip block for read-only endpoints)
  - [ ] `:::tip Source` block: handler line ref + per-action cross-repo callers (only if any)
  - [ ] `---` separator after the card
- [ ] **"How it works" depth matches R5 YES-count**:
  - [ ] 0 YES → 1 sentence
  - [ ] 1 YES → 1 paragraph (2-4 sentences)
  - [ ] 2-3 YES → multi-paragraph walkthrough
  - [ ] 4+ YES → multi-paragraph + mermaid sequenceDiagram or flowchart
- [ ] **"How it works" is plain prose, NOT annotated code blocks** — verify no ```python` / `// ` / `# ` comments-explaining-code blocks inside the section
- [ ] **R5 non-triviality questions** all answered for each endpoint (read code, not guessed):
  - [ ] queryset filter / scoping logic
  - [ ] counter / aggregation semantics if non-obvious
  - [ ] side effects of write actions
  - [ ] fallback or dual-path strategies
  - [ ] non-obvious parameter interactions
- [ ] Mermaid sequenceDiagram if ≥3 side effects OR ≥3 collaborators
- [ ] **No endpoint summarised as a one-liner unless the code is genuinely one-liner CRUD**
- [ ] **Completeness grep** (mandatory for split files per R0.1): after writes, the coordinator (or you, on Windsurf) grepped the source for the language-appropriate public-action pattern (`@action`, `@app.route`, `@router.<verb>`, `export function`, etc.) and confirmed every match has a doc entry. Misses flagged 🔴 with specific public-action names.

---

## `modules/<name>/services.md` — service classes

- [ ] Every public service method has its own H3 section
- [ ] Per method: 1-3 paragraphs minimum (purpose, signature, behaviour, side effects)
- [ ] Per method: code reference with line number
- [ ] Why-this-shape explanation if inferable from comments/naming/context (otherwise omit — don't make up)
- [ ] Mermaid sequence diagram for any method coordinating ≥3 collaborators
- [ ] Transaction boundaries called out if relevant
- [ ] Signal fires / queue puts / external calls noted

---

## `modules/<name>/models.md` — data models

- [ ] One H2 per model
- [ ] Fields table per model: name, type, constraints (null, unique, default), purpose
- [ ] Relationships subsection (FK, M2M, OneToOne) with cardinality
- [ ] Custom managers / querysets explained if non-trivial
- [ ] Indexes (`Meta.indexes`) noted if present
- [ ] ER mermaid diagram at top if 4+ models with relationships
- [ ] Soft-delete / multi-tenancy / audit-trail patterns noted once if used

---

## `modules/<name>/flows/<flow>.md` — flow docs

- [ ] Mermaid diagram present (sequenceDiagram, stateDiagram, or flowchart depending on flow type)
- [ ] All actors / states / branches named
- [ ] Step-by-step prose explanation
- [ ] Failure modes / edge cases section
- [ ] Code references for entry points + key functions involved
- [ ] If cross-repo: every repo's touchpoint linked

---

## `modules/<name>/README.md` — module index

- [ ] Summary in domain terms (not "this module contains X classes")
- [ ] Responsibilities: owns / does NOT own (with cross-references)
- [ ] Key types: 3-5 important domain entities, one paragraph each
- [ ] Public surface: links to api/, services.md, models.md, etc. (only ones that exist)
- [ ] Consumers (modules importing from this one) — from graph
- [ ] Upstream (modules this depends on) — from graph
- [ ] Read next: actionable links

---

## `cross-cutting/<concern>.md`

- [ ] One paragraph: what this concern is, where it lives, what convention this codebase uses
- [ ] Primary file(s) with code refs
- [ ] 2-5 named patterns with explanation + code ref + when-to-use
- [ ] Consumers table: which modules use this + how
- [ ] Gotchas section: things easy to get wrong
- [ ] **Every pre-declared anchor in YAML front-matter `anchors:` is now defined as a heading whose slug matches** (Pass 6 contract with Pass 4). If any anchor cannot be defined: removed from the YAML list AND recorded in `.cross-link-todo.md`.
- [ ] YAML front-matter `status:` updated from `stub` to `filled`.
- [ ] God nodes the concern owns are described once (canonical) using the snippet at `docs/.cache/god-nodes/<node-id>.md`, with the heading slug equal to the node id.

---

## `reference/<page>.md`

- [ ] All items in the relevant source documented (env vars, scripts, deps, etc.)
- [ ] One-line per item minimum; longer for non-obvious ones
- [ ] Grouped by concern if >10 items
- [ ] Source paths referenced

---

## After running the checklist

If any item failed and you fixed it: re-run the checklist on the fixed sections.

If any item failed and you can't fix it (out of budget, source not readable, etc.):
1. Add a 🔴 INCOMPLETE section with the specific reason
2. List exactly what's missing (method names, sections, etc.) — never vague
3. Include the resolution command in the section: `/generate-docs --section <this-file>`
4. Save what's already complete via save-result

If all items passed:
1. Save discoveries via `save-result` (dual-save: per-repo + group memory)
2. Update `docs/.metadata.json` with source SHAs
3. Print one-line summary
4. Move to next file

**Never silently skip a checklist item** — even if you think the item doesn't apply to this file. If it doesn't apply, write a one-line explanation under the heading saying so (e.g. "No write actions in this read-only ViewSet").

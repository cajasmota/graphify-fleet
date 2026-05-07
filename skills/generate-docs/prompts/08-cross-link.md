# Pass 8 — Cross-link verification

Final pass. Walks all newly-written docs, verifies cross-links, fixes anchors.

## Orchestration model

On **Claude Code**, the orchestrator delegates this pass to a single subagent (per the `SKILL.md` coordinator-only rule). The subagent should be given:

- This prompt (`prompts/08-cross-link.md`).
- The list of all per-repo `docs/` trees touched by passes 4–6 plus, in `--group` mode, the `<group_docs_path>/` tree from pass 7.
- The agent rules block from `CLAUDE.md` (so the subagent honors `<!-- docs:manual -->` regions and the homepage convention while rewriting links).

No `output-templates/*` are needed for this pass — it edits existing files in place rather than producing new artifacts. On **Windsurf**, the agent runs the steps below directly.

## Your goal

For every link in every doc you just wrote:
1. Resolve the target file. If missing, mark broken.
2. If link has an anchor (`#section`), verify the target file contains a heading that slugifies to that anchor.
3. If anchor is missing, fall back to non-anchored link with `(anchor TBD)` and add to broken-links list.
4. Build a glossary back-link: if a glossary term appears in any doc, link first occurrence to `<group_docs>/product/glossary.md#<term>`.

## Steps

### 0. Resolve link candidates

Before validating cross-repo references, work through the candidate queue surfaced by the group MCP server. Candidates are ambiguous cross-repo edges flagged by the deterministic link passes (label match, string-pattern match) — see the `Cross-repo link candidates` section in the per-repo `CLAUDE.md` rules block for the full background.

1. Call `list_link_candidates(repo_filter="<current-repo-slug>", limit=10)` — top-10 candidates touching this repo (sorted by confidence descending).
2. For each candidate:
   - Read the source/target nodes' files via `get_node_source` (or fall back to file `Read`).
   - Decide: real link, coincidence, or wrong-target?
   - Call `resolve_link_candidate(candidate_id, decision, reason, override_target?)`:
     - `decision="confirm"` — promote to a confirmed link (method suffix `+resolved`, confidence 1.0).
     - `decision="confirm"` with `override_target="<repo>::<id>"` — confirm but correct the target.
     - `decision="reject"` — record the rejection so future link-pass runs skip it.
3. Repeat with `repo_filter=None` for cross-cutting candidates (links spanning repos other than the current one).
4. Stop when the queue is empty OR you've resolved 20 candidates this pass (whichever comes first — bounded budget so the pass stays cheap).

Resolutions feed back into the graph immediately (MCP mtime-reload picks them up). Subsequent cross-link queries in steps 1–2 see the freshly confirmed edges as deterministic links.

### 1. Collect all links

Walk every `.md` file under:
- `<repo>/docs/`
- `<group_docs_path>/`

**Skipped-module rule (important for `--refresh` / `--module` / `--since` runs).** When most modules were skipped this run (their fingerprints didn't change), their existing `.md` files on disk are still valid cross-link targets AND their outbound links must still be verified against any newly-renamed targets in this run's regenerated docs. Therefore Pass 8's input is the **entire `docs/` tree on disk**, regardless of which subset Passes 4–6 touched. Do not restrict to "files written this run" — that would produce a false-clean broken-links report.

When verifying anchors against a skipped module's file, read the on-disk content (do not re-derive from any in-memory regeneration result).

Extract every markdown link `[text](path#anchor)`. Skip:
- External links (`http://`, `https://`)
- Code references (lines starting with `path/to/file.py:N` — not links)
- Mailto / fragment-only

### 2. Resolve each link

For each link `<text>(<rel-path>#<anchor>)`:

1. Resolve `<rel-path>` from current doc dir → absolute file path. If the path points at a directory, resolve it to `<dir>/index.md` (VitePress homepage convention; do NOT fall back to `README.md`). If a legacy link points at `<dir>/README.md` and only `<dir>/index.md` exists, rewrite the link to `<dir>/index.md` or to the bare directory.
2. If file doesn't exist:
   - Replace the link with: `<text>` (plain text, no link)
   - Add entry to `<group_docs>/broken-links.md`: `- <source_doc>:<line> → <target> NOT FOUND`
3. If file exists but has `<!-- docs:manual -->`: keep link, don't verify anchor (manual files may have any structure).
4. If file exists and has anchor:
   - Read the file's headings (`^#{1,6} (.+)$`)
   - Slugify each heading using GitHub-flavored slug rules (lowercase, replace non-alpha with `-`, collapse, strip leading/trailing dashes)
   - If `<anchor>` matches any slugified heading: OK.
   - If not: replace anchor portion with no anchor, append ` (anchor TBD)`. Add to broken-links.
5. If file exists and no anchor: OK as-is.

### 2b. Resolve cross-repo-pending markers

Read `<repo>/docs/.cross-repo-pending.md` (and the equivalent file in every other repo of the group, when running `--all`). Each entry is a link Pass 4/5/6 wrote AS IF the doc existed but flagged because the target wasn't generated yet.

For each pending entry:

1. Re-resolve the target file (relative path from source) against the now-current state of all repos in the group.
2. If the target file exists and the anchor is valid: remove the `class="cross-repo-pending"` HTML wrapper or `[^cross-repo]` footnote suffix from the source doc. Drop the entry from `.cross-repo-pending.md`.
3. If the target file exists but the anchor is missing: keep the marker, switch the link to non-anchored with `(anchor TBD)`, leave the entry in `.cross-repo-pending.md` with the reason updated to `target page exists, anchor missing`.
4. If the target file still does NOT exist: keep the marker, leave the entry as-is.

Rewrite `.cross-repo-pending.md` with only the still-pending entries. If empty, delete the file.

### 3. Glossary back-links

If a glossary exists at `<group_docs>/product/glossary.md`:

1. Extract all term entries (top-level headings or boldface terms).
2. For each `.md` file generated:
   - On first occurrence of a glossary term in body text (skip headings, code blocks): wrap in `[term](<rel-path>/glossary.md#<term-slug>)`.
   - Don't re-wrap subsequent occurrences in the same file.
   - Don't wrap if already inside a link.

### 4. Update files

Write any changed files. Skip files where nothing changed.

### 5. Write broken-links report

`<group_docs>/broken-links.md`:

```markdown
<!-- docs:auto -->
# Broken links

Generated: <ISO-8601>

<!-- auto:start id=missing-files -->
## Missing target files (N)

- `myapp-backend/docs/modules/orders/api.md` line 42 → `../../../myapp-frontend/docs/modules/payments/services.md` (file does not exist)
- ...
<!-- auto:end -->

<!-- auto:start id=missing-anchors -->
## Missing anchors (M)

- `myapp-backend/docs/modules/orders/api.md` line 51 → `../services.md#assign-owner` (anchor not found; closest match: `#assign_owner`)
- ...
<!-- auto:end -->

<!-- auto:start id=fix-suggestions -->
## How to fix

For missing files: regenerate the missing module/section, or update the link.
For missing anchors: heading slugs are case-sensitive; check punctuation. Common pitfalls:
- Method names with `()` — slugified without parens
- Method names with `_` — slugified to `-`
- Headings with `:` — colon is dropped
<!-- auto:end -->
```

If no broken links: don't write the file. If file exists from a previous run with no broken links now: rewrite it to "All cross-links verified ✓ as of <date>".

### 6. Print summary

```
Cross-link pass complete:
  - 142 links checked
  - 2 missing files (see broken-links.md)
  - 5 missing anchors (auto-fixed with TBD marker)
  - 38 glossary terms back-linked
```

Then: end the run with the global summary printed by SKILL.md's run-summary section.

## Re-runs

This pass is cheap — always run it. It detects rot from manual edits.

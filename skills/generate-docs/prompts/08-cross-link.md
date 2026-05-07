# Pass 8 — Cross-link verification

Final pass. Walks all newly-written docs, verifies cross-links, fixes anchors.

## Your goal

For every link in every doc you just wrote:
1. Resolve the target file. If missing, mark broken.
2. If link has an anchor (`#section`), verify the target file contains a heading that slugifies to that anchor.
3. If anchor is missing, fall back to non-anchored link with `(anchor TBD)` and add to broken-links list.
4. Build a glossary back-link: if a glossary term appears in any doc, link first occurrence to `<group_docs>/product/glossary.md#<term>`.

## Steps

### 1. Collect all links

Walk every `.md` file under:
- `<repo>/docs/`
- `<group_docs_path>/`

Extract every markdown link `[text](path#anchor)`. Skip:
- External links (`http://`, `https://`)
- Code references (lines starting with `path/to/file.py:N` — not links)
- Mailto / fragment-only

### 2. Resolve each link

For each link `<text>(<rel-path>#<anchor>)`:

1. Resolve `<rel-path>` from current doc dir → absolute file path.
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

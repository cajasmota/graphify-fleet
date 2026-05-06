# Auto/human marker rules

Every generated `.md` file uses HTML-comment markers to separate auto-generated regions from human-edited regions, so re-runs preserve human work.

## File-level markers (top of file)

```markdown
<!-- docs:auto -->
```
The skill manages this whole file. Auto-regenerates.

```markdown
<!-- docs:manual -->
```
The skill never touches this file. May read it for context but won't modify.

If neither marker is present, treat as `docs:auto`.

## Region markers (within a file)

```markdown
<!-- auto:start id=<unique-id> -->
... content the skill regenerates ...
<!-- auto:end -->
```

```markdown
<!-- human:start [id=<optional-id>] -->
... content the user wrote and the skill must preserve ...
<!-- human:end -->
```

`id` on auto regions is required and stable across runs (e.g. `endpoints`, `key-concepts`). Skill uses it to match old/new content.

`id` on human regions is optional but helps if the surrounding auto structure changes.

## Re-run procedure

1. Read existing file (if any).
2. If file has `<!-- docs:manual -->`: skip entirely.
3. Otherwise, parse into a sequence of (auto, id, content) and (human, optional-id, content) blocks plus untagged prose.
4. Generate new auto blocks.
5. Splice: for each new auto block, replace the old one with matching `id`. If no old match, append in plan order.
6. Preserve all human blocks at their relative positions (relative to nearest auto neighbors).
7. Untagged prose between blocks is treated as "implicitly human" — preserve.

## Special cases

- **Restructure**: if the new plan changes the file's section layout (e.g. splitting one big page into three), don't try to migrate human blocks across files automatically. Instead, write the new files, then append a `<!-- skill-note: human content from previous version -->` block to the first new file containing all preserved human text. User can then move it manually.
- **Renamed file**: if the auto-rename detection (per `prompts/04-cluster.md`) renames a module folder, all files in it are renamed too. Human blocks travel with their file.

## Confidence marker

A 🟡 prefix on a heading flags low-confidence sections. Scope: the section under that heading until next heading of equal/higher level.

```markdown
## 🟡 Permissions
... uncertain content ...
```

These are surfaced in the run summary so the user knows where to review.

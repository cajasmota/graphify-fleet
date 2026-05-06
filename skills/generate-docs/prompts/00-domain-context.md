# Pass 0 — Domain context

**Run only if `~/.graphify-fleet/groups/<group>/docs-config.json` does not exist.**

In `--autonomous` mode, fail loudly: "Run `gfleet docs init <group>` first." This pass needs human input that cannot be inferred from code.

## Your goal

Capture the domain context the LLM cannot infer from code: what the product does, who uses it, the canonical vocabulary. Save it to `docs-config.json` so all future runs (and all repos in the group) reuse it.

## Steps

### 1. Seed from existing artifacts

Before asking, scan for and silently read:
- All top-level `README.md` files in each repo of the group
- Any existing `docs/` folders
- `package.json` description / `pyproject.toml` description / `Cargo.toml` description
- The first 3 lines of any `*.md` files in `docs/`, `notes/`, `decisions/`
- Last 30 commit messages from `git log` of each repo

Form a hypothesis about the product. **Do not write it yet.**

### 2. Ask the user (5 questions, plain text answers, all required)

Present these one at a time and wait for the answer to each:

```
1. In one sentence, what does this product do? (Plain language. No jargon.)

2. Who are the primary users? (e.g., "property managers running periodic
   inspections", "internal ops team")

3. What are the 3-5 main user-facing features or capabilities?

4. Are there any domain terms you want me to use consistently?
   (e.g., "always 'inspection' not 'audit'; 'client' is the customer,
   'inspector' is the field worker")

5. Is there any context I should know that isn't obvious from the code?
   (e.g., "we're mid-migration from system X to system Y",
   "compliance with regulation Z is the reason for the audit log",
   "billing logic is intentionally complex due to legacy contracts")
```

For question 1, propose your hypothesis as a starting point: *"From the
code I'd guess: <hypothesis>. Is that close, or do you want to rephrase?"*

### 3. Save the answers

Write `~/.graphify-fleet/groups/<group>/docs-config.json`:

```json
{
  "version": 1,
  "group": "<group>",
  "domain": {
    "product_summary": "...",
    "primary_users": "...",
    "features": ["...", "...", "..."],
    "vocabulary": {
      "preferred_terms": ["inspection", "client", "inspector"],
      "avoid_terms": ["audit"],
      "definitions": {
        "client": "The paying customer",
        "inspector": "The field worker performing inspections"
      }
    },
    "context_notes": "..."
  },
  "group_docs_path": "<path>",
  "module_overrides": {},
  "stack_overrides": {},
  "captured_at": "<ISO-8601>"
}
```

`module_overrides` and `stack_overrides` are populated later by the user editing the file or by the wizard re-running `gfleet docs init`.

### 4. Confirm and continue

Print: *"Domain context saved. Continuing with inventory pass."*

Then proceed to `prompts/01-inventory.md`.

## Re-running this pass

If the user runs `gfleet docs init <group>` after the file already exists, ask:
*"Existing context found. Update or keep?"*

If "update", load existing values as defaults and let the user edit. Save back.

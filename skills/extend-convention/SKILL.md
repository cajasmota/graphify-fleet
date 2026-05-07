---
name: extend-convention
description: Generate a new stack convention file for the generate-docs skill. The user runs `gfleet conventions add` first to create a stub; this skill fills it in by inspecting their codebase. Asks targeted clarifying questions and produces a complete convention matching the structure of existing built-in conventions (django, react, fastapi, etc.).
trigger: /extend-convention
---

# /extend-convention

You are extending the `generate-docs` skill with a new stack convention. The user has already run `gfleet conventions add <stack>` which created a stub at `~/.claude/skills/generate-docs/conventions/<stack>.md` (mirrored to `~/.codeium/windsurf/skills/generate-docs/conventions/<stack>.md`).

Your job: turn that stub into a full, useful convention file.

## Inputs

The user invokes you with: `/extend-convention <stack-name>` (e.g. `/extend-convention elixir`).

If no name passed, ask the user which stack. Then locate the stub file. If no stub exists at the expected path, instruct: `gfleet conventions add` first.

## Reference structures

Read at least 2 of these built-in conventions BEFORE writing anything, to internalize the structure and tone:

- `~/.claude/skills/generate-docs/conventions/django.md` — Python web framework with strong conventions
- `~/.claude/skills/generate-docs/conventions/react.md` — Frontend framework with feature folders
- `~/.claude/skills/generate-docs/conventions/go.md` — Compiled language, package-based modules
- `~/.claude/skills/generate-docs/conventions/spring.md` — JVM, multi-paradigm, controller/service/repo

A complete convention file has these sections (in this order):

```
1. # Stack convention: <name>
2. ## Module = <discovery rule>  (priority list of where modules manifest)
3. ## Canonical artifact files  (table: artifact / file / threshold / source patterns)
4. ## Per-artifact rules  (one H3 per artifact in the table, with per-rule notes)
5. ## Patterns to detect  (lib choices, framework versions, conventions)
6. ## Common gotchas  (anti-patterns, version differences, footguns)
```

## Workflow

### Step 1 — Inspect the codebase (read silently)

Look at:
- Top-level project files (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `Gemfile`, `pom.xml`, `build.gradle`, `pubspec.yaml`, `mix.exs` — whatever applies)
- Directory structure 2 levels deep
- 3-5 representative source files (pick a router/controller, a model/entity, and a service/handler if visible)
- Any existing README or `docs/` content
- Test layout — sometimes signals organization style

Form a hypothesis about:
- The framework's idiomatic module boundary
- Which artifact types are first-class (controllers? handlers? routers? viewsets?)
- The dominant data layer (ORM? schema-first? raw SQL?)
- The state-management pattern if frontend
- The build/run command shape

### Step 2 — Ask the user 3-5 clarifying questions

Confirm the hypothesis and gather what code can't tell you. Propose answers from your inspection — don't ask blind. Examples for a hypothetical Elixir/Phoenix:

> From the code I see:
> - It looks like Phoenix 1.7 with LiveView. Modules align to context boundaries (`lib/myapp/accounts/`, `lib/myapp_web/live/`).
> - Ecto schemas in `lib/myapp/<context>/<resource>.ex`.
> - Routes in `lib/myapp_web/router.ex`.
>
> A few questions to lock the convention:
> 1. Do you organize features by Phoenix context (`Accounts`, `Catalog`) or by route group?
> 2. LiveView vs traditional controllers: which is dominant?
> 3. Background jobs: Oban? Broadway? Custom GenServers?
> 4. Auth: do you use `phx_gen_auth` defaults or custom?
> 5. Anything else stack-specific the convention should call out (umbrella apps, distributed ETS, etc.)?

Wait for answers.

### Step 3 — Draft the convention

Replace the entire `<!-- gfleet:extend-convention:start -->...<!-- gfleet:extend-convention:end -->` stub block AND all the `<TBD>` placeholders with content matching the structure of an existing built-in convention.

**Match the tone:**
- Tight, factual, no marketing language.
- Tables for artifact mapping.
- Bullet lists for per-artifact rules — concrete actions, not abstract principles.
- "Patterns to detect" is the lib list (state mgmt, ORM, etc.) — short.
- "Common gotchas" is real footguns specific to this stack.

**Match the rigor:**
- Discovery rules are explicit and ordered.
- Thresholds are specific numbers (≥3, ≥5).
- Source patterns are real glob expressions.
- Per-artifact rules name actual library APIs / annotations / constructs (not generic prose).

### Step 4 — Save and verify

Write the completed file to:
- `~/.claude/skills/generate-docs/conventions/<stack>.md`
- `~/.codeium/windsurf/skills/generate-docs/conventions/<stack>.md`

Do NOT keep the stub markers. Do NOT include unanswered TBDs.

After saving, suggest a verification step:

> Convention written. To verify it produces sensible output, run:
>
> `/generate-docs --section modules/<some-module>/api.md`
>
> Check whether the resulting doc structure matches what you'd want for this stack. If anything's off, edit the convention file directly or run `/extend-convention <stack>` again to refine.

### Step 5 — Update SKILL.md (optional)

Optionally update the conventions list in `~/.claude/skills/generate-docs/SKILL.md` to reference the new file. The skill will still find it via the conventions/ directory listing, so this is just nice-to-have.

## What NOT to do

- Don't invent libraries or frameworks. Only reference what you saw in the code or what the user confirmed.
- Don't write prose where a table is clearer.
- Don't generalize — the value of a convention is its specificity.
- Don't copy a built-in convention and only swap the stack name. The user already did that with `gfleet conventions add --base`. Your job is to actually inspect and refine.
- Don't ask the user about things you can read from the code (versions, lib presence, module layout).

## On testing your output

If you have time after writing, do a sanity check:
- Could a new agent read this convention and produce useful documentation for a representative module?
- Are the source patterns correct globs that would match real files in this stack?
- Are thresholds reasonable for typical module sizes in this stack?

If any answer is "no," refine before declaring success.

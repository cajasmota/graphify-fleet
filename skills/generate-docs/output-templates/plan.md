# Documentation plan — {{repo}}

Generated: {{timestamp}}
Status: PROPOSED   ← change to APPROVED to continue (or reply "approved" in chat)

## Scope summary

- Stack: {{stack}}
- {{N}} modules will be documented; {{M}} skipped (too small)
- {{K}} cross-cutting docs
- {{R}} reference pages
- {{H}} how-to pages
- Estimated tokens: ~{{input}}k input / ~{{output}}k output (~${{$}} with Sonnet)

## Modules

### {{module_name}} ({{node_count}} nodes, {{god_count}} god nodes)
Files ({{file_count}}):
- modules/{{module_name}}/README.md
{{repeat per file: path + (count + threshold note)}}

Cross-repo links expected: {{count}}

{{repeat per module}}

## Cross-cutting ({{count}})

### {{concern_name}}
Touches modules: {{list}}
Will write `cross-cutting/{{concern}}.md` summary.
Each module's stub references back.

{{repeat}}

## Reference ({{count}})

- {{file}} ({{detail}})

## How-to ({{count}})

- {{file}} ({{source}})

## Skipped

- Module `{{name}}` — {{reason}}

## Token estimate

| Pass | Input | Output | Notes |
|------|-------|--------|-------|
| {{...}} |

## Open questions for the user

(none, or list)

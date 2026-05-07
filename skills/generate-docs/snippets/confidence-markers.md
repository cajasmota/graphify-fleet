# Confidence markers

There are two distinct markers. They mean different things — never conflate.

| Marker | Meaning | Reader action |
|--------|---------|---------------|
| 🟡 | **Uncertain** — best-effort guess from sparse code | Verify before relying on |
| 🔴 | **Incomplete** — source was not fully read; this is a known stub | Do not rely on; must be completed |

A 🟡 section is a documented guess. A 🔴 section is a visible gap. **Never use 🟡 for "I didn't read this yet"** — that's 🔴.

---

## 🟡 Uncertain

Use when you've read the code but the conclusion is sparse or inferred.

When to use:
- Behavior inferred from a single call site or naming convention without confirming code logic.
- A side effect that "looks like" it happens but isn't directly readable.
- A type/relationship that the graph suggests but you didn't verify by reading code.
- A claim about retry/timeout/error policy not directly stated in code.
- A guess about why something is shaped a certain way.

How to use — apply to the heading:

```markdown
## 🟡 Capacity check race

The capacity check uses `select_for_update` on the owner row, which
*appears* to prevent concurrent overbooking. *Verified only in single-process
test; behavior under multi-pod load not confirmed.*
```

The 🟡 scope is from that heading to the next heading of equal or higher level.

## How NOT to use

- Don't 🟡 every section — defeats the purpose. Reserve for actual uncertainty.
- Don't 🟡 something just because it's complex; complex but well-understood is fine.
- Don't 🟡 to mean "this is bad code" — the marker is about *your confidence*, not code quality.

## 🔴 Incomplete (NEW)

Use when source code was not fully read because of budget/context constraints. **Never write a vague placeholder** like "~N additional methods to be confirmed against source." That's documentation theater. Instead:

- Mark the section heading with 🔴
- List the **specific unread method/action/handler names** by name
- Surface the gap in the run summary so the next run can target it

```markdown
## 🔴 INCOMPLETE — ContractViewSet additional actions

Source file `core/orders/views/order_viewset.py` lines 143-980 not yet read.
Unread actions (must be documented before this file is considered complete):
- cancel
- get_extras
- devices
- assigned_devices
- assign_devices
- assigned_contacts
- assign_contacts
- assigned_contracts
- create_note
- delete_note
- get_notes

Re-run with: `/generate-docs --section modules/orders/api.order.md`
```

A named gap is always better than a false summary.

## When NOT to mark either

- Don't 🟡 every section — defeats the purpose. Reserve for actual uncertainty.
- Don't 🟡 something just because it's complex; complex but well-understood is fine.
- Don't 🟡 to mean "this is bad code" — the marker is about *your confidence*, not code quality.
- Don't use 🔴 for things you chose to skip on purpose (e.g. test files) — those just don't appear at all. 🔴 is for *should-have-documented-but-couldn't*.

## In the run summary

Both markers are collected, but separately:

```
Flagged 🟡 for review (5):
  - myapp-backend/docs/modules/orders/services.md "Capacity check race"
  - myapp-backend/docs/modules/billing/api.md "Discount calculation"

Incomplete 🔴 (requires follow-up) (3):
  - myapp-backend/docs/modules/orders/api.order.md   [11 unread actions: cancel, get_extras, devices, ...]
  - myapp-backend/docs/modules/scheduling/api/index.md     [all @actions unread — file is 3,472 lines, needs split]
  - myapp-backend/docs/modules/mobile-api/README.md        [all @actions unread]
```

The 🔴 list tells the user (and the next agent) exactly what to target with `--section` or `--module` on the next run.

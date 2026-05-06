# Confidence markers

When you're unsure about something — guessed behavior, sparse evidence, missing context — use the 🟡 marker.

## When to use

- Behavior inferred from a single call site or naming convention without confirming code logic.
- A side effect that "looks like" it happens but isn't directly readable.
- A type/relationship that the graph suggests but you didn't verify by reading code.
- A claim about retry/timeout/error policy not directly stated in code.
- A guess about why something is shaped a certain way.

## How to use

Apply 🟡 to the **heading** of the affected section:

```markdown
## 🟡 Capacity check race

The capacity check uses `select_for_update` on the inspector row, which
*appears* to prevent concurrent overbooking. *Verified only in single-process
test; behavior under multi-pod load not confirmed.*
```

The 🟡 scope is from that heading to the next heading of equal or higher level.

## How NOT to use

- Don't 🟡 every section — defeats the purpose. Reserve for actual uncertainty.
- Don't 🟡 something just because it's complex; complex but well-understood is fine.
- Don't 🟡 to mean "this is bad code" — the marker is about *your confidence*, not code quality.

## In the run summary

Every 🟡 section is collected into the run summary so the user can review:

```
🟡 sections to review (5):
  - upvate-core/docs/modules/inspections/services.md "Capacity check race"
  - upvate-core/docs/modules/billing/api.md "Discount calculation"
  - ...
```

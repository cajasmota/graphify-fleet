# Writing style — keep all subagent output consistent

20+ subagents will write 100+ docs. Without a shared style, the result reads like 20 different authors. This snippet locks tone, voice, and vocabulary so the output is uniform.

## Voice and tense

- **Active voice, present tense**: "The handler validates the payload" — not "The payload is validated by the handler" or "The handler will validate the payload"
- **Imperative for instructions**: "Run `npm install`" — not "You should run `npm install`"
- **Third person, no "we" or "you"** in reference docs: "Orders transition through five states" — not "We move orders through five states"
- **"You" is allowed in how-to docs** because they're instructional: "First, you set up the local DB"
- **No first-person plural ("we")** anywhere — auto-generated docs have no "we"

## Terminology

- Use `domain.vocabulary.preferred_terms` from `docs-config.json` consistently
- Avoid `domain.vocabulary.avoid_terms` — substitute with preferred
- Use the canonical capitalisation given in `domain.vocabulary.definitions`
- For technical terms not in the glossary, prefer the term used in the code over a paraphrase

## Length per section

| Section | Target length |
|---------|---------------|
| Module README summary | 1 sentence |
| Module README key-type description | 1 paragraph (3-5 sentences) |
| Endpoint description (the prose before "Auth:") | 1-3 sentences (longer if non-trivial behaviour) |
| Service method body | 1-3 paragraphs |
| Complex query walkthrough | 1 short paragraph + annotated code + 1 paragraph "why this shape" |
| Flow doc step-by-step | one bullet per step, 1 sentence each |
| Cross-cutting pattern explanation | 1-2 paragraphs + code snippet |

Resist padding. If you have 1 sentence of meaningful content, write 1 sentence — don't expand to fill space.

## Headings

- H1 = file title (one per file)
- H2 = top-level sections
- H3 = items within a section (endpoints, methods, models, etc.)
- H4 only for sub-aspects of an H3 item; rarely needed

Heading text should be the natural name (`POST /api/v1/orders/`, `OrderService.create_order`, `Order`) — not a description ("Creating an order").

## Code references

Format: `path/to/file.ext:LINE`. Example: `core/orders/services.py:42`.

When linking from markdown: `[OrderService.create_order](../../core/orders/services.py#L42)`.

When citing an endpoint by handler: include both the path and the class:
`Handler: ContractViewSet.cancel ([core/orders/views/order_viewset.py:L142](../../...))`.

## Mermaid

- `sequenceDiagram` for orchestration involving ≥3 collaborators
- `flowchart TD` for multi-branch logic (>3 branches)
- `stateDiagram-v2` for status fields with multiple values
- ER-style with `classDiagram` or simple boxes for data model relationships (4+ entities)

Diagram name labels should match the canonical names used in code (the actual class names, not paraphrases).

## What NOT to write

- ❌ "This module is responsible for handling..." → "Owns order lifecycle"
- ❌ "There are several actions..." → "Five actions:"
- ❌ "It should be noted that..." — just state the fact
- ❌ "In order to..." → "To..."
- ❌ "Various", "several", "many" without numbers — count them
- ❌ "Etc." in lists — list everything or end with the most important + "(and N more — see <link>)"
- ❌ Marketing language: "robust", "powerful", "flexible", "elegant" — describe what it does, not how good it is
- ❌ "Easy", "simple", "just" — patronising and usually wrong

## What TO write

- ✅ Specific names: not "the service", but "OrderService"
- ✅ Specific numbers: not "many actions", but "12 actions"
- ✅ Specific reasons: not "for performance", but "to avoid N+1 by prefetching the related Customer"
- ✅ Honest uncertainty: 🟡 with "verify before relying on" beats false confidence
- ✅ Cross-links over re-explanations

## Examples

❌ Bad:
> This module provides various services for order management. There are several different operations that can be performed, including creating, updating, and deleting orders. The system uses a robust state machine to ensure orders progress through their lifecycle in a consistent manner.

✅ Good:
> Owns the order lifecycle from scheduling through result publication. Five public services: `create_order`, `assign_owner`, `mark_in_progress`, `submit_results`, `cancel`. State transitions are enforced by `Order.status` (see [flows/status-machine.md](flows/status-machine.md)).

❌ Bad:
> The cancel action allows you to cancel a order. It performs the necessary updates to the order record and may also create related records as needed.

✅ Good:
> Sets `status='cancelled'` and `end_date=cancel_date`. Side effect: creates a system `ContractNote` recording the cancellation reason (`author=request.user, system=True`).

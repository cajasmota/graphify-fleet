# Stack convention: Go

## Module = top-level package OR cmd/<service>

Discovery:
1. If `cmd/<name>/main.go` files exist → each is a service module (microservice repo).
2. Otherwise top-level packages (each immediate subdir of repo root with `*.go`) are modules.
3. `internal/`, `pkg/` — these are for internal/exported helpers; usually not modules unless they have business logic.

## Canonical artifact files

Each module folder's homepage is `index.md` (NOT `README.md`). Below-threshold artifacts fold into `index.md`.

| Artifact | File | Template | Threshold | Source patterns |
|----------|------|----------|-----------|-----------------|
| handlers (HTTP API) | `handlers.md` | `output-templates/api-class.md` (Swagger-card) | ≥3 handlers | files importing `net/http` and registering routes |
| domain | `services.md` | `output-templates/services.md` | ≥2 domain types | `domain.go`, `model.go`, `*Service.go`, business logic |
| storage | `services.md` (storage section) or `cross-cutting.md` | `output-templates/services.md` | ≥1 repo/store | `*Repository.go`, `*Store.go`, `*Repo.go` |
| transport (gRPC, pubsub) | `cross-cutting.md` | `output-templates/cross-cutting.md` | gRPC/messaging | `*.proto`, kafka/sqs publishers |
| dependencies | `index.md` section | — | always | external services this calls |
| config | `cross-cutting.md` | `output-templates/cross-cutting.md` | env-loaded | `viper`, `envconfig` use |
| flows | `user-journey.md` | `output-templates/user-journey.md` | ≥2 services collaborate | derived |

## Per-artifact rules

### `handlers.md` — Swagger-card format (use `output-templates/api-class.md`)
- Go HTTP handlers play the same role as Django ViewSets — the same Swagger-card template applies.
- One H3 per route or handler function, formatted as a Swagger-style card.
- Method emoji prefix in the H3: 🟢 GET, 🟡 POST, 🔵 PUT/PATCH, 🟣 DELETE, 🔴 destructive/admin.
- Each card uses collapsible `<details>` sections for: Parameters, Request body, Responses, Errors.
- Per route metadata: method, path, middleware, handler func, request body type, response type, status codes.
- "How it works" subsection (when present) is PLAIN PROSE — never annotated code blocks. Describe in sentences what the handler does, what it validates, which service it calls, and how it handles errors.
- Note `chi.Router` (or gorilla/mux/echo/gin) group structure once at top of the file.
- **Cross-repo link** to upstream frontend caller (mandatory when the merged graph has the link).
- Override vs template: api-class.md defines the card structure; Go handlers add the router-group note at the top and the cross-repo link inside each card.

### `services.md` (domain + business logic, use `output-templates/services.md`)
- Domain types (struct definitions) with field meanings.
- Service-level functions (business logic) — one H3 per public function.
- Per significant function: 1-3 paragraphs of plain prose, mermaid for orchestration involving ≥3 collaborators.
- Note interface boundaries — what's exported, what's internal.
- Storage repos can live in this file under a "Storage" H2, or break out into `cross-cutting.md` if the module has many repos. One H3 per repository/store: methods, what query each runs, what it returns. Walk through complex SQL in PLAIN PROSE — never annotated code. Note transaction boundaries.

### Transport (gRPC, pubsub) → `cross-cutting.md`
- gRPC: list services and methods from `.proto` files. Note streaming vs unary.
- Pub/sub: what topics/queues this service publishes to / consumes from. Message schemas.

### Dependencies → `index.md` section
- External services this one talks to (other internal services, third parties).
- For each: what it's used for, failure mode, timeout/retry policy.

## Patterns to detect

- **Router**: chi, gorilla/mux, echo, gin, stdlib. Note once.
- **DB layer**: database/sql + sqlx, gorm, ent, sqlc. Note.
- **Config**: viper, envconfig, koanf, manual. Note.
- **Logging**: zap, zerolog, slog. Note.
- **Tracing**: otel, manual. Note.
- **Errors**: errors.Is/As discipline, custom error types, wrapped errors. Note in cross-cutting/error-handling.md.
- **Context propagation**: ctx-first param convention enforced? Note.

## Microservice repo specifics

If repo has `cmd/<svc>` style:
- Each service gets its own module folder under `docs/services/<svc>/` (instead of `docs/modules/`).
- For the **group** synthesis pass: deployment topology is more important; document discovery/registration.
- API contracts in group docs are critical when there are many services.

## Common gotchas

- `go.work` workspace — note if multi-module.
- Build tags for platform/version — note relevant ones.
- Generated code (e.g., from sqlc, protoc) — exclude from docs unless conventionally documented.

# Stack convention: Go

## Module = top-level package OR cmd/<service>

Discovery:
1. If `cmd/<name>/main.go` files exist → each is a service module (microservice repo).
2. Otherwise top-level packages (each immediate subdir of repo root with `*.go`) are modules.
3. `internal/`, `pkg/` — these are for internal/exported helpers; usually not modules unless they have business logic.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| handlers | `handlers.md` | ≥3 handlers | files importing `net/http` and registering routes |
| domain | `domain.md` | ≥2 domain types | `domain.go`, `model.go`, `*Service.go`, business logic |
| storage | `storage.md` | ≥1 repo/store | `*Repository.go`, `*Store.go`, `*Repo.go` |
| transport | `transport.md` | gRPC/messaging | `*.proto`, kafka/sqs publishers |
| dependencies | `dependencies.md` | always | external services this calls |
| config | `config.md` | env-loaded | `viper`, `envconfig` use |
| flows | `flows.md` | ≥2 services collaborate | derived |

## Per-artifact rules

### `handlers.md`
- One H3 per route or handler function.
- Per route: method, path, middleware, handler func, request body type, response type, status codes.
- Note `chi.Router` group structure if used.

### `domain.md`
- Domain types (struct definitions) with field meanings.
- Service-level functions (business logic).
- Per significant function: 1-3 paragraphs, mermaid for orchestration.
- Note interface boundaries — what's exported, what's internal.

### `storage.md`
- One H3 per repository/store.
- Methods: signature, what query it runs, what it returns.
- For complex queries: walk through the SQL.
- Note transaction boundaries.

### `transport.md`
- gRPC: list services and methods from `.proto` files. Note streaming vs unary.
- Pub/sub: what topics/queues this service publishes to / consumes from. Message schemas.

### `dependencies.md`
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

# Stack convention: Express (Node)

> Graph-searchability: every Express / Fastify / Koa / Hapi doc inherits the universal backtick contract from `_graph-searchability.md`. Router names, route paths, handler functions, middleware names, model names, file paths — all in backticks every time, including in headings.

Use this for vanilla Node.js HTTP frameworks built around the "router + middleware + handler" model: Express, Fastify, Koa, Hapi. The structural patterns are similar enough that the same conventions apply — note framework-specific differences in `Patterns to detect`.

## Module = router or feature folder

Discovery (priority-ordered):
1. `src/routes/<feature>/` directories — each feature folder is a module.
2. `src/api/<feature>/` directories — same idea, alternate naming.
3. `src/<feature>/` when a feature-folder convention is in use (route file lives next to its service/controller/model).
4. `src/modules/<feature>/` when the project uses a "modules" naming.
5. Single-file monoliths (`routes.js` / `app.js` mounting all routes at the root): fall back to graphify communities to suggest sub-modules grouped by URL path prefix or shared dependencies. Record suggestions in `module_overrides_suggested`.

Skip pure utility folders (no route registration, no domain logic) — fold them into a parent `index.md` section.

## Canonical artifact files

Each module folder's homepage is `index.md` (NOT `README.md`). Below-threshold artifacts fold into `index.md` as a section.

| Artifact | File | Template | Threshold | Source patterns |
|----------|------|----------|-----------|-----------------|
| routes | `routes.<feature>.md` | `output-templates/api-class.md` (Swagger-card) | one per `Router()` instance | files calling `express.Router()` / `fastify.register` / `new Router()` |
| controllers | `controllers.md` | `output-templates/api-class.md` | controllers separated from route files | `**/controllers/*.{js,ts}`, `*Controller.{js,ts}` |
| services | `services.md` | `output-templates/services.md` | ≥2 service functions/classes | `**/services/*.{js,ts}` |
| repositories | `repositories.md` | `output-templates/services.md` | ≥1 repo | `**/repositories/*.{js,ts}`, `**/repos/*.{js,ts}` |
| models | `models.md` | `output-templates/models.md` | ≥2 models | Mongoose `Schema`, Sequelize `define`/`Model`, Prisma client usage, TypeORM `@Entity`, Drizzle `pgTable` |
| middleware | `middleware.md` | `output-templates/cross-cutting.md` | ≥1 non-trivial middleware | `**/middleware/*.{js,ts}`, `app.use(...)` registrations |
| validators | `validators.md` | `output-templates/cross-cutting.md` | ≥2 schemas | zod / joi / yup / express-validator usages |
| tasks | `tasks.md` | `output-templates/cross-cutting.md` | ≥1 background job | BullMQ `Queue`/`Worker`, Agenda jobs, `node-cron` schedules |
| flows | `user-journey.md` | `output-templates/user-journey.md` | always when ≥2 services interact | derived from services |

## Per-artifact rules

### `routes.<feature>.md` — Swagger-card format (use `output-templates/api-class.md`)
- One Express Router (or Fastify plugin / Koa router) per file (R0).
- One H2 per Router; one H3 per route, formatted as a Swagger-style card with method emoji prefix: 🟢 GET, 🟡 POST, 🔵 PUT/PATCH, 🟣 DELETE, 🔴 destructive/admin.
- Each card uses collapsible `<details>` sections for: Parameters, Request body, Responses, Errors.
- Per route: HTTP method, full path (router mount path + route path), middleware chain in declaration order (order is load-bearing — auth before rate-limit before validation before handler), validation step, handler function, success status, error status codes.
- Note which centralized error handler (or `try/catch`) ultimately sends the response.
- "How it works" subsection (when present) is PLAIN PROSE in sentences — never annotated code blocks. Describe what each middleware contributes, what the handler validates, which service it calls, what side effects fire.
- Show example request/response JSON inside the relevant `<details>` block.
- **Cross-repo link** to frontend caller (mandatory when the merged graph has the link).

### `controllers.md` — Swagger-card format (use `output-templates/api-class.md`)
- Used only when controllers are physically separated from route registration files.
- Same Swagger-card structure as routes; one H2 per controller class/module, one H3 per exported handler.
- Note the route file that wires each controller method to a path.

### `services.md` (use `output-templates/services.md`)
- One H2 per service module/class, one H3 per public function/method.
- Per method: 1-3 paragraphs of plain prose covering purpose, signature, sync vs async, behavior, side effects. Never explain behaviour with annotated code blocks.
- Transactions: call out `sequelize.transaction()`, Prisma `$transaction`, Mongoose sessions (`session.startTransaction()`), TypeORM `QueryRunner`/`@Transaction`.
- Retry/idempotency notes: document any retry wrappers, idempotency-key handling, or compensating actions.
- Mermaid sequence diagram for any method coordinating ≥3 collaborators.

### `repositories.md` (use `output-templates/services.md`)
- One H2 per repository.
- Per public method: query intent in prose, ORM call shape (without pasting code), index it relies on.

### `models.md` (use `output-templates/models.md`)
- ORM-specific sections — note ORM at the top:
  - **Mongoose**: per schema, fields with types and validators, schema methods, virtuals, pre/post hooks (middleware), indexes, discriminators.
  - **Sequelize**: per model, attributes, associations (`hasMany`/`belongsTo`/`belongsToMany`), scopes (default + named), hooks, paranoid/soft-delete.
  - **Prisma**: per model in `schema.prisma`, fields, relations (with `@relation`), `@@index`/`@@unique`, generators noted once.
  - **TypeORM**: per `@Entity`, columns, relations (`@OneToMany`/`@ManyToOne`/etc.), eager/lazy loading, listeners (`@BeforeInsert`/`@AfterLoad`).
  - **Drizzle**: per `pgTable`/`mysqlTable`, columns, relations object, indexes.
- ER mermaid diagram at top if 4+ models with relationships.

### `middleware.md` (use `output-templates/cross-cutting.md`)
- One H3 per middleware.
- Per middleware: what it does, where in the chain it is registered (global `app.use` vs router-scoped vs route-scoped), what it mutates on `req` (`req.user`, `req.context`, etc.), what it short-circuits on (auth failure, rate limit, body too large), and how errors propagate (`next(err)` vs throw vs response).
- Note Express 4 vs Express 5 behavior for async middleware.

### `validators.md` (use `output-templates/cross-cutting.md`)
- One H3 per schema (or one per route group when schemas are tiny).
- Describe in prose: required fields, constraints, refinements, transforms (zod `.transform`, joi `.custom`).
- Document how validation errors flow — directly into the centralized error middleware, mapped to a 400 response shape, etc.

### `tasks.md` (use `output-templates/cross-cutting.md`)
- One H3 per job/queue.
- Per job: trigger (HTTP route, cron, event), what it does, idempotency, retry policy (backoff strategy, max attempts), queue/concurrency settings, dead-letter handling.

## Patterns to detect

- **Framework**: Express 4 vs Express 5 vs Fastify vs Koa vs Hapi vs NestJS-on-Express (defer to `nestjs.md` if Nest is present).
- **Language**: TypeScript vs plain JavaScript — note path aliases and build tool (tsc, esbuild, swc, tsx).
- **ORM / data layer**: Prisma, TypeORM, Sequelize, Mongoose, Drizzle, raw `pg`/`mysql2`, Knex.
- **Validation**: zod, joi, yup, express-validator, ajv, class-validator (rare without Nest).
- **Auth strategy**: Passport (with strategies enumerated), custom JWT middleware, session-based with `express-session`, OAuth via `oauth4webapi`/`openid-client`.
- **Background jobs**: BullMQ, Bull (legacy), Agenda, node-cron, Bree.
- **Logging**: Pino vs Winston vs Bunyan vs `console`.
- **Error-handling style**: centralized error middleware (`(err, req, res, next)`), per-route try/catch, `express-async-handler` wrapper, Fastify's setErrorHandler.
- **API style**: REST vs GraphQL (Apollo Server, Yoga, Mercurius for Fastify) vs tRPC.
- **Real-time**: socket.io, ws, Fastify websocket plugin.
- **Config**: dotenv, convict, env-var, node-config.
- **Process model**: single process, cluster, PM2, Node worker_threads.

## Common gotchas

- Middleware order is load-bearing — `app.use(express.json())` before routes, auth before rate-limit before handler, error middleware **last** with the four-arg signature.
- Express 4 does NOT auto-catch async handler rejections — unwrapped `async (req, res) => { ... }` swallows errors silently. Express 5 catches them. Note which version is in use.
- Mongoose connection pooling — single global connection vs per-request; check for connection leaks in tests.
- Race conditions on `findOneAndUpdate` without `{ new: true }` or atomic operators — document when reads and writes are not atomic.
- Missing CORS or overly-permissive `*` CORS — note current configuration.
- `body-parser` / `express.json({ limit })` defaults — uploads will fail silently above the limit.
- Helmet not configured or default-only — security headers worth flagging.
- Async middleware that forgets to call `next()` hangs the request.
- Fastify schema-driven serialization is opt-in; without a `response` schema it falls back to `JSON.stringify` and slows down.
- Koa's middleware is `async (ctx, next)` — not interchangeable with Express.
- Prisma's connection pool is per-process; serverless deployments need pooled connections (PgBouncer / Prisma Data Proxy / Accelerate).
- Sequelize transactions need `{ transaction: t }` passed through every call — easy to drop one.
- TypeScript path aliases (`@/services/...`) often break at runtime without `tsconfig-paths`/`tsc-alias`.

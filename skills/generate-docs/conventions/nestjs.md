# Stack convention: NestJS

NestJS is decorator-driven, modular, and DI-heavy. Although it commonly runs on Express (or Fastify), its structural patterns are very different — document Nest projects with this convention, not `express.md`.

## Module = `@Module()` class

Discovery (priority-ordered):
1. Each `@Module()`-decorated class is a logical module. Walk the imports tree starting from the root `AppModule`.
2. By Nest convention each module lives in `<feature>/<feature>.module.ts` — treat the containing folder as the module's source root.
3. Nx workspaces: `apps/<app>/` and `libs/<scope>/<lib>/` are top-level boundaries. Nest workspaces (`nest-cli.json` with `projects`): each project is top-level.
4. Dynamic modules (`forRoot`/`forRootAsync`/`forFeature`) are listed under the module that imports them, not as standalone modules, unless they ship from a workspace lib.
5. Skip pure barrel/utility modules with no controllers, providers, or exports — fold into the parent module's `index.md`.

## Canonical artifact files

Each module folder's homepage is `index.md` (NOT `README.md`). Below-threshold artifacts fold into `index.md` as a section.

| Artifact | File | Template | Threshold | Source patterns |
|----------|------|----------|-----------|-----------------|
| controllers | `controllers.md` | `output-templates/api-class.md` (Swagger-card) | one per `@Controller` class | `**/*.controller.ts` |
| services | `services.md` | `output-templates/services.md` | ≥1 `@Injectable` provider | `**/*.service.ts`, classes decorated `@Injectable()` |
| modules | `modules.md` | `output-templates/cross-cutting.md` | always (the module itself) | `**/*.module.ts` |
| guards | `guards.md` | `output-templates/cross-cutting.md` | ≥1 guard | classes implementing `CanActivate` / `**/*.guard.ts` |
| interceptors | `interceptors.md` | `output-templates/cross-cutting.md` | ≥1 interceptor | classes implementing `NestInterceptor` / `**/*.interceptor.ts` |
| pipes | `pipes.md` | `output-templates/cross-cutting.md` | ≥1 custom pipe | classes implementing `PipeTransform` / `**/*.pipe.ts` |
| filters | `filters.md` | `output-templates/cross-cutting.md` | ≥1 exception filter | classes decorated `@Catch` / `**/*.filter.ts` |
| decorators | `decorators.md` | `output-templates/cross-cutting.md` | ≥1 custom decorator | `createParamDecorator`, custom method decorators |
| dtos | `dtos.md` | `output-templates/models.md` | ≥3 DTO classes | `**/dto/*.ts`, classes using `class-validator` decorators |
| models | `models.md` | `output-templates/models.md` | ≥2 entities | TypeORM `@Entity`, Prisma usage, Mongoose `@Schema` |
| tasks | `tasks.md` | `output-templates/cross-cutting.md` | ≥1 queue/processor | `@nestjs/bullmq` `@Processor`, `@Cron`, `@Interval` |
| gateways | `gateways.md` | `output-templates/api-class.md` | ≥1 gateway | classes decorated `@WebSocketGateway` |
| microservices | `microservices.md` | `output-templates/api-class.md` | ≥1 message handler | `@MessagePattern`, `@EventPattern` |
| flows | `user-journey.md` | `output-templates/user-journey.md` | always when ≥2 services interact | derived from services |

## Per-artifact rules

### `controllers.md` — Swagger-card format (use `output-templates/api-class.md`)
- One `@Controller` class per file (R0). One H2 per controller, one H3 per route handler.
- Each handler H3 is a Swagger-style card with method emoji prefix: 🟢 GET, 🟡 POST, 🔵 PUT/PATCH, 🟣 DELETE, 🔴 destructive/admin.
- Each card uses collapsible `<details>` sections for: Parameters, Request body, Responses, Errors.
- Per route: HTTP verb decorator (`@Get/@Post/@Put/@Patch/@Delete`), path (controller base path + method path), parameter decorators (`@Param/@Query/@Body/@Headers/@Req`), method-level guards/interceptors/pipes/filters in declaration order, response status (`@HttpCode`), response shape (DTO class), exception responses, OpenAPI metadata pulled from `@ApiTags`/`@ApiOperation`/`@ApiResponse`.
- "How it works" subsection is plain prose — describe which guards run, how the body is validated, which service is called, what side effects fire. Never paste annotated code blocks.
- Show example request/response JSON inside the relevant `<details>` block.
- **Cross-repo link** to frontend caller (mandatory when the merged graph has the link).

### `services.md` (use `output-templates/services.md`)
- One H2 per `@Injectable` provider. One H3 per public method.
- Note provider scope (`Scope.DEFAULT` / `Scope.REQUEST` / `Scope.TRANSIENT`) at the top of each H2 — request-scoped providers have very different semantics.
- List constructor DI tokens (other services, repositories, config, custom tokens via `@Inject(TOKEN)`).
- Lifecycle hooks: `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `BeforeApplicationShutdown` — describe what they do.
- Per method: plain-prose paragraphs covering purpose, signature, transaction strategy (TypeORM `DataSource.transaction`, Prisma `$transaction`, Mongoose sessions), side effects.
- Mermaid sequence diagram for any method coordinating ≥3 collaborators.

### `modules.md` (use `output-templates/cross-cutting.md`)
- One H2 for the module itself.
- Subsections: `imports` (other modules, dynamic modules, `forFeature` registrations), `providers` (with custom tokens / `useFactory` / `useClass` / `useValue`), `exports`, `controllers`.
- Module-level pipes/guards/interceptors registered with `APP_PIPE`/`APP_GUARD`/`APP_INTERCEPTOR`/`APP_FILTER` tokens — call out their global effect.
- Module configuration surface: `forRoot(options)` / `forRootAsync({ useFactory, inject })` shape and what it exposes.

### `guards.md` (use `output-templates/cross-cutting.md`)
- One H3 per guard implementing `CanActivate`.
- Per guard: what context it reads (`request.user`, `Reflector.get(ROLES_KEY, handler)`, request headers), how it short-circuits (returns false vs throws `ForbiddenException`/`UnauthorizedException`), where it is applied (global via `APP_GUARD`, controller-level, method-level).

### `interceptors.md` (use `output-templates/cross-cutting.md`)
- One H3 per `NestInterceptor`.
- Describe pre-handler work (logging, timing, header injection) and post-handler transformation via the RxJS pipeline returned from `intercept` (`map`, `tap`, `catchError`).
- Note global vs scoped registration.

### `pipes.md` (use `output-templates/cross-cutting.md`)
- One H3 per pipe.
- Distinguish validation pipes (built-in `ValidationPipe` configured with `class-validator`) from transformation pipes (`ParseIntPipe`, custom).
- Note global registration (`app.useGlobalPipes(new ValidationPipe(...))`) vs per-controller vs per-param.
- Document `ValidationPipe` options in use: `whitelist`, `forbidNonWhitelisted`, `transform`, `transformOptions.enableImplicitConversion`.

### `filters.md` (use `output-templates/cross-cutting.md`)
- One H3 per `@Catch(...)` filter.
- Describe which exceptions it catches and how it maps domain exceptions to HTTP responses.
- Note registration order — Nest applies filters from most specific (method-level) to least specific (global), so global catch-all filters must come last.

### `decorators.md` (use `output-templates/cross-cutting.md`)
- One H3 per custom decorator.
- For `createParamDecorator`: what it extracts from the execution context.
- For metadata decorators (`SetMetadata`/`Reflector.createDecorator`): what key it sets and which guard/interceptor reads it.

### `dtos.md` (use `output-templates/models.md`)
- One H3 per DTO class.
- Fields table: name, type, `class-validator` decorators (`@IsString`, `@IsEmail`, `@IsOptional`, `@ValidateNested`, `@Type(() => Sub)`), purpose.
- Inheritance via mapped-type helpers: `PickType`, `PartialType`, `IntersectionType`, `OmitType` — note source class.
- Cross-field validation via custom validators or `@Transform` — describe in prose.

### `models.md` (use `output-templates/models.md`)
- ORM-specific (note ORM at top): TypeORM `@Entity` (columns, relations, listeners), Prisma model from `schema.prisma`, Mongoose `@Schema()` class with `@Prop()` fields, MikroORM `@Entity`.
- ER mermaid diagram at top if 4+ entities with relationships.

### `tasks.md` (use `output-templates/cross-cutting.md`)
- One H3 per processor or scheduled job.
- BullMQ via `@nestjs/bullmq`: `@Processor(QUEUE_NAME)` class with `@Process(jobName)` methods — document trigger, payload, idempotency, retry policy (backoff, attempts), concurrency.
- Schedule decorators from `@nestjs/schedule`: `@Cron`, `@Interval`, `@Timeout` — describe cadence and side effects.

### `gateways.md` (use `output-templates/api-class.md`)
- One H2 per `@WebSocketGateway`. Note transport (socket.io default, native ws via custom adapter), namespace, CORS config.
- One H3 per `@SubscribeMessage('event')` handler with payload shape and emitted response/broadcast.

### `microservices.md` (use `output-templates/api-class.md`)
- Note transport at the top: TCP, Redis, NATS, Kafka, RabbitMQ, MQTT, gRPC.
- One H3 per handler. Distinguish `@MessagePattern` (request-response) from `@EventPattern` (fire-and-forget) — they have different semantics.
- For Kafka and gRPC, note topic/service definitions and serialization (proto files, Avro, JSON).

## Patterns to detect

- **Language**: TypeScript only in practice; note `strict` settings.
- **HTTP adapter**: Express (default) vs Fastify (`@nestjs/platform-fastify`).
- **ORM**: TypeORM (`@nestjs/typeorm`), Prisma (manual integration), Mongoose (`@nestjs/mongoose`), MikroORM (`@mikro-orm/nestjs`), Sequelize (`@nestjs/sequelize`).
- **Validation**: `class-validator` + `class-transformer` (overwhelmingly the default).
- **Configuration**: `@nestjs/config` with `ConfigModule.forRoot({ load: [...], validationSchema })`, env file loading.
- **Background queues**: `@nestjs/bullmq` (modern) vs `@nestjs/bull` (legacy), `@nestjs/schedule` for cron.
- **OpenAPI**: `@nestjs/swagger` with `SwaggerModule.setup` — note where the spec is mounted.
- **GraphQL**: `@nestjs/graphql` — code-first (`@ObjectType`/`@Field`/`@Resolver`) vs schema-first (`.graphql` files).
- **Monorepo style**: Nx workspace (`nx.json`, `apps/`, `libs/`) vs Nest workspace (`nest-cli.json` with `projects`).
- **CQRS**: `@nestjs/cqrs` — commands, queries, events, sagas as separate handler classes.
- **Microservices**: presence of `NestFactory.createMicroservice` or hybrid `app.connectMicroservice`.
- **Auth**: Passport via `@nestjs/passport` (with strategies enumerated), custom JWT guard, session via `express-session` middleware.
- **Testing**: `@nestjs/testing` `Test.createTestingModule`, mocking strategies, e2e via Supertest.

## Common gotchas

- **Circular module imports** — break with `forwardRef(() => OtherModule)` on both sides; missing one side gives the cryptic "Nest can't resolve dependencies" error.
- **Provider scope leaks** — injecting a `Scope.REQUEST` provider into a `Scope.DEFAULT` (singleton) provider silently promotes the consumer to request scope and tanks performance.
- **Global vs local `ValidationPipe`** — registering it with `app.useGlobalPipes` from `main.ts` is NOT the same as `APP_PIPE` token: the latter participates in DI, the former does not. Pick one and document it.
- **Exception filter order** — more specific `@Catch(SpecificException)` filters must be registered before the catch-all `@Catch()`; filter order is "first matching wins" within scope.
- **`enableImplicitConversion`** — without it, `@Query` params arrive as strings and `class-validator` numeric checks fail; with it, surprising coercions happen. Note the chosen setting.
- **Mongoose model registration order** — schemas referenced via `ref` must be registered (via `MongooseModule.forFeature`) in a module that is imported before the consumer.
- **Async providers with `useFactory`** — the factory runs once at module init; long-running factories block bootstrap.
- **Request-scoped providers + interceptors** — interceptors created at module scope cannot inject request-scoped providers without becoming request-scoped themselves.
- **`forwardRef` overuse** — usually a smell that two modules should be merged or a shared interface extracted; flag in module overview.
- **Global guards/interceptors via `app.useGlobalX`** — they are NOT in the DI container, so they cannot inject providers. Use the `APP_GUARD`/`APP_INTERCEPTOR` token instead when DI is needed.
- **`main.ts` vs module bootstrapping** — middleware applied in `main.ts` (via `app.use`) runs outside Nest's pipeline and bypasses guards/interceptors registered there.
- **Hybrid apps (HTTP + microservice)** — `app.startAllMicroservices()` must be awaited before `app.listen()`; otherwise message handlers silently drop.

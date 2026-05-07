# Stack convention: Quarkus / Jakarta EE / MicroProfile

> Graph-searchability: every Quarkus / Jakarta EE / MicroProfile doc inherits the universal backtick contract from `_graph-searchability.md`. JAX-RS resource classes, CDI bean names, JPA entity names, DTO names, channel names, config keys, file paths — all in backticks every time, including in headings.

This convention covers Quarkus, Jakarta EE (WildFly, Open Liberty, Payara), and MicroProfile applications as a single family. They share the same programming model — CDI for beans, JAX-RS for HTTP, MicroProfile Config for configuration, JPA for persistence — even when the runtime differs.

Module homepage is `index.md` (NOT README.md).

## Module = Maven/Gradle module or top-level package

Discovery (in priority order):

1. **Maven multi-module**: top-level `pom.xml` with `<modules>` — each `<module>` listed there is a candidate gfleet repo entry.
2. **Gradle multi-project**: `settings.gradle(.kts)` with `include(...)` — each included project is a candidate.
3. **Single-module project**: top-level packages under `src/main/java/<base>/<feature>/` (or `src/main/kotlin/<base>/<feature>/`) become modules.
4. **Quarkus extension projects**: a pair of `runtime/` and `deployment/` modules. Treat the whole repo as a single module unless the split is genuinely large enough to warrant two entries.
5. **Jakarta EE EAR projects**: each WAR/JAR submodule under the EAR is a candidate.
6. Communities fallback for monoliths with thin package structure.

## Canonical artifact files

The output templates live alongside the conventions. Use them when the threshold below is met.

| Artifact | File | Threshold | Source patterns | Output template |
|----------|------|-----------|-----------------|-----------------|
| JAX-RS resources | `resources.<name>.md` | one per `@Path` class | classes annotated `@Path` | `output-templates/api-class.md` (Swagger-card format) |
| services / beans | `services.md` | ≥2 `@ApplicationScoped`/`@Singleton`/`@RequestScoped` | CDI bean classes | `output-templates/services.md` |
| entities | `entities.md` | ≥2 `@Entity` | JPA / Hibernate entities | `output-templates/models.md` |
| dtos | `dtos.md` | ≥3 DTOs | record types or POJOs in `dto/` | `output-templates/models.md` |
| repositories | `repositories.md` | Panache / JPA / Repository pattern | `PanacheRepository`, `EntityRepository`, `*Repository` | `output-templates/services.md` |
| reactive | `reactive.md` | ≥1 Mutiny `Uni`/`Multi` pipeline | reactive endpoints / Mutiny pipelines | `output-templates/cross-cutting.md` |
| messaging | `messaging.md` | SmallRye Reactive Messaging or JMS | `@Incoming`/`@Outgoing` annotations, `@MessageDriven` | `output-templates/cross-cutting.md` |
| config | `config.md` | non-trivial | `@ConfigProperty`, `application.properties`/`application.yaml` | `output-templates/cross-cutting.md` |
| security | `security.md` | OIDC / JWT / RBAC | `@RolesAllowed`, `@Authenticated`, `quarkus-oidc` | `output-templates/cross-cutting.md` |
| health | `health.md` | MicroProfile Health checks | `@Liveness`/`@Readiness` | `output-templates/cross-cutting.md` |
| metrics | `metrics.md` | MicroProfile Metrics or Micrometer | `@Counted`, `@Timed`, `@Gauge` | `output-templates/cross-cutting.md` |
| openapi | `openapi.md` | `@OpenAPIDefinition` present | annotation present | `output-templates/cross-cutting.md` |
| scheduled | `scheduled.md` | ≥1 `@Scheduled` | Quarkus `@Scheduled` | `output-templates/cross-cutting.md` |
| graphql | `graphql.md` | SmallRye GraphQL | `@GraphQLApi` | `output-templates/cross-cutting.md` |
| module home | `index.md` | always | overview of the module | `output-templates/module-readme.md` |

## Per-artifact rules

### `resources.<name>.md` (JAX-RS)

Use the Swagger-card format from `output-templates/api-class.md`:

- One `@Path` class per file (R0).
- For each handler method, document:
  - HTTP method annotation: `@GET` / `@POST` / `@PUT` / `@DELETE` / `@PATCH` / `@HEAD` / `@OPTIONS`.
  - Method-level `@Path` (concatenated with the class-level `@Path`).
  - Parameters: `@PathParam`, `@QueryParam`, `@HeaderParam`, `@FormParam`, `@CookieParam`, `@MatrixParam`, `@BeanParam`.
  - Media types: `@Consumes` and `@Produces`.
  - Request body type and Bean Validation annotations on it (`@Valid`, `@NotNull`, `@Size`, `@Pattern`, etc.).
  - Response: declared return type vs `Response` builder; status codes from `Response.Status`.
  - Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`, `@Authenticated`.
  - Exception responses: which `@Provider ExceptionMapper` classes map exceptions thrown here, and the resulting HTTP status.
- Use the method emoji + collapsible `<details>` blocks (Parameters / Request body / Response 2xx / Errors / How it works / Side effects) exactly as `api-class.md` defines.
- Note the runtime flavor at the top of the file: **RESTEasy Reactive** vs **RESTEasy Classic** vs **Helidon SE/MP** vs **Jersey** — return-type semantics differ for blocking vs reactive (e.g. RESTEasy Reactive treats `Uni<T>` as non-blocking by default).
- "How it works" is plain prose — never annotated code.

### `services.md`

- Per CDI bean:
  - Scope: `@ApplicationScoped` / `@Singleton` / `@RequestScoped` / `@Dependent` / `@SessionScoped` / `@ConversationScoped`.
  - `@Inject` dependencies (constructor, field, method).
  - Lifecycle: `@PostConstruct`, `@PreDestroy`.
  - Transaction boundaries: `@Transactional` from Jakarta Transactions, with propagation (`REQUIRED`, `REQUIRES_NEW`, `MANDATORY`, `NEVER`, `NOT_SUPPORTED`, `SUPPORTS`).
  - Event observers: `@Observes`, `@ObservesAsync`, including qualifiers.
- Interceptor bindings (`@AroundInvoke`, `@AroundConstruct`, custom `@InterceptorBinding`): document the pointcut and the cross-cutting behavior in prose.
- Add a Mermaid `sequenceDiagram` when ≥3 collaborators are involved in a flow.

### `entities.md`

- Per JPA entity:
  - `@Entity` plus `@Table` (name, schema, indexes, unique constraints).
  - Fields with annotations: `@Id`, `@GeneratedValue` (strategy), `@Column`, `@Enumerated`, `@Embedded`, `@Convert`.
  - Relationships: `@OneToMany`, `@ManyToOne`, `@OneToOne`, `@ManyToMany` — list cascade types and fetch type per relation.
  - Lifecycle callbacks: `@PrePersist`, `@PostPersist`, `@PreUpdate`, `@PostUpdate`, `@PreRemove`, `@PostRemove`, `@PostLoad`.
  - Custom `AttributeConverter` implementations.
- For Quarkus Panache: note the superclass — `PanacheEntity` (active record, auto `id`), `PanacheEntityBase` (custom id), or repository-pattern entity.
- Note inheritance strategy if used (`@Inheritance(strategy = …)` — `SINGLE_TABLE`, `JOINED`, `TABLE_PER_CLASS`).

### `dtos.md`

- One row per DTO with field types and validation annotations.
- Distinguish Java `record` types (immutable) from POJO classes.
- Note Jackson configuration: `@JsonProperty`, `@JsonIgnore`, `@JsonInclude`, `@JsonCreator`.
- If MapStruct or similar mapping is in use, list the mapper interfaces and which DTO ↔ entity pairs they cover.

### `repositories.md`

- **Panache repository pattern**: list each `PanacheRepository<E>` (or `PanacheRepositoryBase`) and the public methods. Describe each query in plain prose — name the entity, the predicates, the ordering, paging if any.
- **Hibernate Reactive**: `Mutiny.SessionFactory` / `Mutiny.Session` usage — note where sessions are scoped and how they compose with `Uni`.
- **Jakarta Data / Spring-Data-style derived methods**: list interface methods + describe what each derives from the method name in prose.
- Custom queries via `@Query`, `Query.create()`, `EntityManager.createQuery(...)`, named queries: describe the JPQL/HQL/SQL in plain English. Never paste annotated code.

### `reactive.md`

- One section per reactive pipeline (Mutiny `Uni` / `Multi`): describe the dataflow in plain English from source to sink.
- Call out operators used and why: `transform`, `onItem().transformToUni`, `onFailure().recoverWithItem`, `retry().withBackOff`, `merge`, `combine`, `broadcast`.
- Note execution model: virtual threads (`@RunOnVirtualThread`), imperative blocking (`@Blocking`), reactive non-blocking (default for Mutiny).
- For backpressure-relevant `Multi` pipelines, describe the strategy (`Multi.createBy().repeating`, `onOverflow().drop`, etc.) in prose.

### `messaging.md`

- SmallRye Reactive Messaging connectors detected: `smallrye-kafka`, `smallrye-mqtt`, `smallrye-amqp`, `smallrye-jms`, `smallrye-in-memory`, `smallrye-pulsar`, `smallrye-rabbitmq`.
- Per `@Incoming` / `@Outgoing` channel:
  - Channel name and how it maps to a topic/queue (look in `application.properties` for `mp.messaging.incoming.<channel>.*` / `mp.messaging.outgoing.<channel>.*`).
  - Expected payload type (raw, `Message<T>`, `KafkaRecord<K,V>`).
  - Acknowledgement strategy: `PRE_PROCESSING`, `POST_PROCESSING`, `MANUAL`, `NONE`.
  - Error handling: failure strategy (`fail`, `ignore`, `dead-letter-queue`).
  - Broadcast / merge semantics (`@Broadcast`, `@Merge`).
- JMS / Jakarta Messaging: `@MessageDriven` MDBs — document destination, selector, and transaction context.

### `config.md`

- One table row per `@ConfigProperty` injection point: key, type, default value, where it's used, and **build-time vs runtime** classification (Quarkus distinction — build-time keys cannot be changed without rebuilding the app/native image).
- Profile-aware configs: list `%dev.`, `%test.`, `%prod.` overrides found in `application.properties` / `application.yaml`.
- Config sources beyond the default file: env vars, system properties, `META-INF/microprofile-config.properties`, custom `ConfigSource` implementations.

### `security.md`

- Auth strategy: Quarkus OIDC, MicroProfile JWT, Quarkus basic auth, Jakarta Security `@HttpAuthenticationMechanism`, custom `IdentityProvider`.
- Identity provider configuration: issuer URL, audience, scopes — pulled from config.
- Role mapping: list every `@RolesAllowed` value seen across resources/services and what role each maps to.
- For Jakarta Security API: `@HttpAuthenticationMechanism` implementations, `IdentityStore` beans, `SecurityContext` usage.
- Note the security domain / authentication mechanism configured at the runtime level (Quarkus `quarkus.http.auth.*`, WildFly elytron, Open Liberty `<application-bnd>`).

### `health.md`

- Per `@Liveness` and `@Readiness` health check: what it verifies, what causes it to report DOWN, recovery semantics, and any external dependency it touches (DB, broker, downstream service).
- Note `@Startup` checks separately if present.

### `metrics.md`

- Per `@Counted` / `@Timed` / `@Gauge` / `@Metered`: metric name, units, what it measures, and tags.
- Micrometer registry config (Prometheus, OTLP, etc.) — one line per registry enabled.
- For MicroProfile Metrics, note the scope (application / vendor / base).

### `openapi.md`

- `@OpenAPIDefinition` info object: title, version, description, contact, license.
- `@APIResponse`, `@APIResponses`, `@Schema`, `@Parameter` overrides applied at resource/method level.
- Note any `OASFilter` implementations and what they rewrite.

### `scheduled.md`

- Per `@Scheduled` method:
  - Cron expression or `every`/`delayed` value, with timezone if specified.
  - Idempotency notes — does the method guard against duplicate runs?
  - Concurrency mode: `SKIP`, `HALT`, default.
  - Skip predicate (`@Scheduled(skipExecutionIf = …)`) if used.

### `graphql.md`

- `@GraphQLApi` classes — one section each.
- Per `@Query`, `@Mutation`, `@Subscription`: name, arguments, return type.
- Custom scalars, `@Source` field resolvers, batched data loaders.

### `index.md`

- Module overview: what the module owns, runtime flavor, build tool.
- Links to every artifact file generated for the module.

## Patterns to detect

- **Build tool**: Maven (`pom.xml`) vs Gradle (`build.gradle(.kts)`).
- **Runtime flavor**: detect via dependencies — `io.quarkus:quarkus-bom` (Quarkus), `org.wildfly.*` (WildFly), `io.openliberty.*` (Open Liberty), `fish.payara.*` (Payara), `io.helidon.*` (Helidon).
- **JDK target**: 17+ for modern Quarkus; 11 for legacy Jakarta EE; 21+ when virtual threads are in use.
- **Persistence**: Hibernate ORM (classic), Hibernate Reactive, Quarkus Panache (active-record vs repository), EclipseLink, OpenJPA.
- **Reactive**: Mutiny (Quarkus default), RxJava, Project Reactor (less common in Jakarta EE), virtual threads + blocking model.
- **Messaging**: SmallRye Reactive Messaging, Jakarta Messaging (JMS), Kafka Streams, Apache Camel.
- **Validation**: Jakarta Bean Validation (`@Valid`, `@NotNull`, `@Size`, `@Pattern`, `@AssertTrue`, etc.).
- **Testing**: `@QuarkusTest`, `@QuarkusIntegrationTest`, Quarkus DevServices (auto-spawns Postgres / Kafka / Keycloak / Redis containers in tests), RestAssured, Arquillian (Jakarta EE), Testcontainers.
- **Native build**: GraalVM via `quarkus.package.type=native` or `mvn package -Dnative`.
- **Dev mode**: live coding via `quarkus dev` / `mvn quarkus:dev`.
- **Microservices toolkit**: SmallRye Stork (service discovery / load balancing), Quarkus gRPC, Quarkus REST Client Reactive.
- **Migrations**: Flyway, Liquibase (both have Quarkus extensions).

## Common gotchas

- **Mixing reactive and blocking** without `@Blocking` / `@NonBlocking` — silently runs blocking code on the event loop and stalls it.
- **Dev mode vs prod build divergence**, especially native: code that works in JVM mode can fail in native due to reflection / resource handling.
- **Build-time vs runtime config**: Quarkus freezes some `@ConfigProperty` keys at build time. Flag every property whose value cannot change without rebuilding the app or native image.
- **CDI proxying limitations**: `@ApplicationScoped` / `@RequestScoped` beans are proxied; final classes, final methods, and package-private constructors break proxy creation.
- **Panache active-record + transactions**: `@Transactional` placement matters — on the interface vs the implementation, and Panache static methods need the surrounding caller to be transactional.
- **N+1 queries with JPA** — use `@EntityGraph`, `JOIN FETCH`, or DTO projections; flag `FetchType.LAZY` relations accessed outside a transaction.
- **SmallRye Reactive Messaging ack semantics**: wrong `@Acknowledgment` strategy silently loses messages on failure. Document the strategy explicitly per channel.
- **OIDC token expiry**: token refresh, clock skew, and JWKS caching all bite differently per identity provider.
- **Native image issues**: reflection (`@RegisterForReflection`), classpath resources (`quarkus.native.resources.includes`), dynamic class loading, dynamic proxies, and serialization all need explicit registration.
- **Quarkus extension authoring vs application code**: `runtime/` and `deployment/` modules follow different rules (build-step processors vs runtime beans). Don't apply application-style detection to extension code.
- **Multi-tenancy** via `@TenantResolver` / `TenantConfigResolver`: data leakage if the resolver returns the wrong tenant for async / reactive contexts.
- **Maven vs Gradle BOM management**: `quarkus-bom` import differs (`<dependencyManagement>` import-scope vs `enforcedPlatform(...)` in Gradle); mismatch causes version drift.
- **Jakarta vs javax namespace**: pre-Jakarta EE 9 code uses `javax.*`; modern Quarkus / EE 10+ uses `jakarta.*`. Mixed code bases break at runtime.

# Stack convention: Spring Boot (Java / Kotlin)

## Module = package or `@Configuration` boundary

Discovery:
1. Top-level packages under `src/main/java/<base>/<module>/` or `src/main/kotlin/<base>/<module>/`
2. Multi-module Gradle projects → each module as a top-level
3. Communities fallback for monoliths with thin package structure

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| controllers | `controllers.<name>.md` | one per `@RestController`/`@Controller` | `**/*Controller.{java,kt}` |
| services | `services.md` | ≥2 `@Service` classes | `**/*Service.{java,kt}` |
| repositories | `repositories.md` | ≥1 `@Repository` / JPA repo | `**/*Repository.{java,kt}` |
| entities | `entities.md` | ≥2 `@Entity` | `**/*Entity.{java,kt}`, `**/entity/**` |
| dtos | `dtos.md` | ≥3 DTOs | `**/dto/**`, `**/*Dto.{java,kt}`, `record` types |
| config | `config.md` | ≥1 `@Configuration` | `**/*Config.{java,kt}` |
| security | `security.md` | Spring Security present | `SecurityFilterChain`, `WebSecurityConfigurer` |
| events | `events.md` | `@EventListener` / `ApplicationEvent` | event classes + listeners |
| schedulers | `schedulers.md` | `@Scheduled` ≥1 | `@Scheduled` annotations |

## Per-artifact rules

### `controllers.<name>.md`
- One controller per file (R0).
- Routes per `@GetMapping`/`@PostMapping`/etc.: HTTP verb, path, params (`@PathVariable`, `@RequestParam`, `@RequestBody`).
- Validation: `@Valid` + bean validation annotations on the DTO.
- `@PreAuthorize` / method security expressions.
- Response: ResponseEntity vs direct return; status codes.
- Exception handlers `@ExceptionHandler` (or @ControllerAdvice referenced).

### `services.md`
- Per service: methods, transaction boundaries (`@Transactional` propagation/isolation/readOnly).
- Lazy loading pitfalls — note when entities are returned vs DTOs.
- Mermaid sequence for ≥3 collaborators.

### `repositories.md`
- Spring Data JPA / Spring Data MongoDB / Spring Data R2DBC.
- Per repo: extends interface, custom `@Query` methods, derived query method names.
- Specifications / criteria queries — show with annotation.

### `entities.md`
- Per entity: fields with JPA annotations (`@Id`, `@Column`, `@OneToMany`, etc.).
- Cascade and fetch types.
- Lifecycle callbacks (`@PrePersist`, `@PostLoad`).
- Custom converters.

### `security.md`
- `SecurityFilterChain` config — auth providers, filters order.
- Method-level security: `@EnableMethodSecurity`.
- JWT vs OAuth2 vs session — note approach.

## Patterns to detect

- **Build**: Gradle (Kotlin/Groovy DSL), Maven.
- **Spring Boot version** + key starters used.
- **Persistence**: JPA (Hibernate), JDBC, R2DBC (reactive), MyBatis.
- **Reactive**: WebFlux vs MVC. Note once.
- **Testing**: JUnit 5, Spring Boot Test, MockMvc, WebTestClient.
- **Mapping**: MapStruct, ModelMapper, manual.
- **Migrations**: Flyway, Liquibase.

## Common gotchas

- N+1 with JPA — `@EntityGraph`, `JOIN FETCH`, fetch=LAZY/EAGER.
- Transaction boundaries — calling `@Transactional` from same class doesn't engage proxy.
- Equality on entities — `equals`/`hashCode` based on ID can break before persist.
- Reactive vs blocking — never mix blocking calls in WebFlux without `Schedulers.boundedElastic()`.
- Spring profile-specific config (`application-{profile}.yml`).

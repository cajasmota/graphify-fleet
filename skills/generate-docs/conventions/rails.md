# Stack convention: Ruby on Rails

## Module = engine, namespace, or top-level resource

Discovery (in priority order):
1. `app/controllers/<namespace>/` directories with multiple controllers → modules
2. `engines/<engine>/` (Rails engines) → each engine is a module
3. `app/models/<namespace>/` (deeply namespaced models)
4. Top-level domain folders under `app/services/<domain>/`
5. Fallback: graphify communities

Skip: `app/javascript/`, `app/assets/`, `vendor/`, `spec/`, `test/`.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| api / controllers | `controllers.<name>.md` | one file per controller class | `app/controllers/**/*.rb` |
| models | `models.md` | ≥2 models | `app/models/**/*.rb` |
| services | `services.md` | ≥2 service objects | `app/services/**/*.rb`, `app/interactors/**/*.rb` |
| jobs | `jobs.md` | ≥2 ActiveJob classes | `app/jobs/**/*.rb`, `app/sidekiq/**/*.rb` |
| mailers | `mailers.md` | ≥1 mailer | `app/mailers/**/*.rb` |
| serializers | `serializers.md` | ≥3 + non-trivial logic | `app/serializers/**/*.rb`, `*_serializer.rb` |
| concerns | `concerns.md` | ≥2 concerns shared across modules | `app/controllers/concerns/**/*.rb`, `app/models/concerns/**/*.rb` |
| policies | `policies.md` | Pundit/CanCan policies | `app/policies/**/*.rb` |

## Per-artifact rules

### `controllers.<name>.md`
- One controller per file (apply R0).
- Routes per action: read `config/routes.rb` for the actual HTTP verb + path.
- Per action: `before_action` callbacks and what they do (auth, scoping, param wrangling).
- Strong params filter — list permitted attributes.
- Side effects: ActiveJob enqueues, mailer deliveries, broadcasts.

### `models.md`
- One H2 per model.
- Associations table (belongs_to, has_many, has_one, polymorphic).
- Validations table.
- Scopes (each scope: name, what it queries, when to use).
- Callbacks (`before_save`, `after_commit`) — note side effects.
- Custom methods that hit the DB.
- Single Table Inheritance / abstract classes — flag.

### `services.md`
- One H3 per service object.
- Service-pattern style: `Result.success`/`failure` returns, `#call` interface.
- Contracts (dry-validation, ActiveModel::Validations) — show the schema.
- Mermaid sequence for orchestration ≥3 collaborators.

### `jobs.md`
- Per job: queue name, retry policy, idempotency notes, what it does.
- Background framework: ActiveJob (Sidekiq, Resque, GoodJob).

### `policies.md`
- Per policy: which actions, the rule logic, role hierarchy.
- Note when policy delegates to another policy.

## Patterns to detect

- **Background jobs**: Sidekiq, Resque, GoodJob, Solid Queue. Note once.
- **Pagination**: kaminari, will_paginate. Note in serializers.md.
- **Auth**: Devise, Sorcery, custom. Note in cross-cutting/auth.md.
- **Authorization**: Pundit, CanCanCan, Action Policy. → policies.md.
- **API responses**: Active Model Serializers, Jbuilder, Blueprinter, Alba. Note in serializers.md.
- **Multi-tenancy**: acts_as_tenant, apartment, manual. Cross-cutting.
- **GraphQL**: graphql-ruby — separate types/mutations/resolvers organization.

## Common gotchas

- N+1 queries — call out where `includes`/`preload`/`eager_load` is used.
- Strong params at the controller level — explicit list.
- Custom Rack middleware — note in cross-cutting if used.
- Sprockets vs Webpacker vs Vite — note for asset pipeline relevance.
- Database adapters (Postgres-specific features like JSON columns, arrays).

# Stack convention: Angular (17+, NgModule legacy, Nx)

Angular 17+ pushes standalone components and signals as the default direction, while many existing codebases still rely on NgModule-based organization. Document whichever shape the repo actually uses; if both are present, note the mix in the repo overview.

## Module = feature folder / NgModule / Nx project

Discovery (priority):
1. Standalone-components codebase: `src/app/<feature>/` directories → modules
2. NgModule legacy: each `*.module.ts` (excluding `app.module.ts`, `shared.module.ts`, `core.module.ts`) is a candidate module; the folder containing it is the module folder
3. Nx workspaces: top-level `apps/<app>/` and `libs/<scope>/<lib>/` are modules (apps and libs treated as siblings)
4. Fallback: graphify communities (auto-detected co-change groupings) when no explicit folder structure exists

If `src/app/` only has `components/`, `services/`, `shared/` (no domain folders) and no per-feature NgModules, use communities and propose names like `auth`, `dashboard`, `orders` from the dominant route component in each community.

## Canonical artifact files

Each module folder's homepage is `index.md` (NOT `README.md`). Below-threshold artifacts fold into `index.md` as a section.

| Artifact | File | Template | Threshold | Source patterns |
|----------|------|----------|-----------|-----------------|
| route components / pages | `routes.md` (or `pages.md`) | `output-templates/screens.md` | ≥2 routed components | `**/*.component.ts` referenced in `Routes`, `loadComponent`, `loadChildren` |
| components | `components.md` | `output-templates/components.md` | ≥5 PUBLIC components | `**/*.component.ts` |
| services | `services.md` | `output-templates/cross-cutting.md` (and `output-templates/api-class.md` for HTTP services) | ≥3 `@Injectable` | `**/*.service.ts`, `@Injectable(...)` |
| stores | `stores.md` | `output-templates/cross-cutting.md` | ≥1 store/feature/signal store | NgRx `createReducer`/`createFeature`/`StoreModule.forFeature`, Akita stores, `signalStore`, `BehaviorSubject` state singletons |
| guards | `guards.md` | `output-templates/cross-cutting.md` | ≥1 guard | `CanActivate`/`CanMatch`/`canActivateFn`, `*.guard.ts` |
| interceptors | `interceptors.md` | `output-templates/cross-cutting.md` | ≥1 interceptor | `HttpInterceptor`, `HttpInterceptorFn`, `*.interceptor.ts` |
| pipes | `pipes.md` | `output-templates/cross-cutting.md` | ≥3 custom pipes | `@Pipe(...)`, `*.pipe.ts` |
| directives | `directives.md` | `output-templates/cross-cutting.md` | ≥3 custom directives | `@Directive(...)`, `*.directive.ts` |
| forms | `forms.md` | `output-templates/cross-cutting.md` | ≥2 reactive forms or 3+ FormBuilder usages | `FormGroup`, `FormControl`, `FormBuilder`, `[formGroup]` template bindings |
| resolvers | `resolvers.md` | `output-templates/cross-cutting.md` | ≥1 resolver | `Resolve`, `ResolveFn`, `*.resolver.ts` |
| HTTP services (API) | `services.md` (Swagger-card sections) | `output-templates/api-class.md` | ≥3 `HttpClient` calls | `HttpClient.get/post/put/patch/delete`, `**/api/*.service.ts` |
| models / types | `models.md` | `output-templates/models.md` | ≥5 exported domain interfaces | `**/models/*.ts`, `interface`/`class` exports |

## Per-artifact rules

### `routes.md`
- One H3 per routed component.
- Per route: path, route configuration (`loadComponent` for standalone vs `component:` for declared, `loadChildren` for lazy feature), `canActivate`/`canMatch` guards, resolvers, route `data`.
- Note whether the route is eager or lazy-loaded; for lazy children, name the loaded child route file.
- Embed mermaid for non-trivial route hierarchies (tabbed feature with nested outlets, wizard with sibling steps).

### `components.md`
- Group by purpose — don't enumerate every component:
  - **Layout** (Page, Section, Container, Header, Sidenav)
  - **Data display** (List, Table, Card, Detail)
  - **Forms** (input wrappers, FormSection, custom controls implementing `ControlValueAccessor`)
  - **Feedback** (Alert, Toast, Spinner, Snackbar wrappers)
  - **Domain-specific** (OrderStatusBadge, CustomerCard)
- Document **only public** components (used outside this module). Internal-only components are skipped.
- For each documented component: standalone (`standalone: true`) vs declared in an NgModule; inputs (`input()` signals or `@Input` decorators, with required/transform notes); outputs (`output()` signals or `@Output` `EventEmitter`); change detection strategy (`OnPush` vs default); lifecycle hooks actually used (`ngOnInit`, `ngOnChanges`, `ngOnDestroy`, `afterNextRender`); content projection (`<ng-content>` slots).
- If the module wraps a UI library (Angular Material, PrimeNG, Nebular, Taiga UI), note which library primitive each component wraps.

### `services.md`
- One H3 per service.
- Per service: scope — `@Injectable({ providedIn: 'root' })` (app-singleton) vs `providedIn: 'platform' | 'any'` vs feature-module-scoped (provided in a component/route `providers`); DI style (constructor injection vs `inject()` function); public methods with signatures; observable streams returned (RxJS `Observable<T>`, `Subject`, `BehaviorSubject`); destruction handling (`takeUntilDestroyed`, `DestroyRef`).
- For HTTP/API services, switch the per-function format to Swagger-style cards (use `output-templates/api-class.md`):
  - Method emoji prefix in the H3: 🟢 GET, 🟡 POST, 🔵 PUT/PATCH, 🟣 DELETE, 🔴 destructive/admin.
  - Each card uses collapsible `<details>` sections for: Parameters, Request body, Responses, Errors.
  - "How it works" subsection (when present) is PLAIN PROSE — never annotated code. Describe what the service method does, what it sends, how it handles auth/errors and retries, in sentences.
  - **Cross-repo link** to backend handler is mandatory when the merged graph has the link.
  - Note auth handling (token attachment via interceptor, refresh) once at the top of the file.

### `components.md` per-component (continued)
- "How it works" prose for orchestration is PLAIN PROSE — never annotated code blocks. Use mermaid sequence for complex flows (template-driven master/detail with router outlet, signal-effects coordination).

### `stores.md`
- One H3 per store/feature/slice.
- NgRx: actions, reducer/`createFeature` state shape, selectors, effects (which actions they listen to and which they dispatch). Note `provideStore` / `provideEffects` registration site.
- Akita: `Store`, `Query`, entity stores.
- Signals: `signal()` / `computed()` / `effect()` patterns; `signalStore` (`@ngrx/signals`) features (`withState`, `withMethods`, `withComputed`).
- BehaviorSubject service-singleton state: state shape, mutation methods, exposed `asObservable()` streams.
- Persistence (localStorage rehydration, `@ngrx/store-devtools`, custom meta-reducers).
- Cross-store dependencies.

### `guards.md`
- One H3 per guard. Function-style (`canActivateFn`) vs class-style (`CanActivate`).
- What it checks (auth, role, feature flag), what it redirects to on failure, dependencies injected.

### `interceptors.md`
- One H3 per interceptor. Function-style (`HttpInterceptorFn`) vs class-style (`HttpInterceptor`).
- Concern (auth token attach, error normalization, retry, logging, base-URL rewrite), order in the chain (note `withInterceptors([...])` order), bypass conditions.

### `pipes.md`
- One H3 per pipe. Pure vs impure (`pure: false`), signature, sample input/output, performance notes for impure pipes.

### `directives.md`
- One H3 per directive. Selector, inputs/outputs, host bindings/listeners, when to use vs a component.

### `forms.md`
- Reactive forms (`ReactiveFormsModule`) vs template-driven (`FormsModule`) — note which the module uses and stay consistent.
- Per form: shape of the `FormGroup` (controls and nested groups/arrays), `FormBuilder` usage, custom validators (sync and async), cross-field validation, value/status change subscriptions, submission flow (call out which service is invoked).
- Custom form controls implementing `ControlValueAccessor` are listed here.

### `resolvers.md`
- One H3 per resolver. Function-style (`ResolveFn`) vs class-style (`Resolve`).
- What it pre-fetches, services called, error handling (does it block navigation or fall back).

### `models.md`
- Only document **domain types** (Order, Customer, etc.) — skip utility/helper types.
- Show the interface/class definition.
- Cross-reference to backend models / mobile types (consistency check).
- 🟡 if frontend type shape diverges from backend: flag it.

## Patterns to detect

- **Angular version**: 17+ (signals + standalone are idiomatic, control flow `@if`/`@for`/`@switch`), 16 (signals introduced, standalone stable), 14-15 (standalone preview, no signals), pre-14 (NgModule-only). Note in repo overview.
- **Component style**: standalone-only, NgModule-only, or mixed. If mixed, note the migration direction.
- **State management**: NgRx (Store/Effects/Selectors), `@ngrx/signals` signal store, NgRx ComponentStore, Akita, NGXS, plain signals + services, `BehaviorSubject` services. Note in `stores.md`.
- **Routing**: standard `RouterModule.forRoot(routes)` vs `provideRouter(routes, ...)` standalone API. Lazy loading via `loadChildren` (route file) vs `loadComponent` (single standalone component).
- **HTTP**: `HttpClient` with `provideHttpClient(withInterceptors([...]))` vs `HttpClientModule` with class interceptors; retry/backoff via RxJS operators.
- **Forms**: ReactiveFormsModule (preferred) vs FormsModule template-driven.
- **Styling**: component-scoped CSS (default), SCSS, Tailwind, Angular Material theming, CSS variables. Note once at repo overview.
- **UI library**: Angular Material, PrimeNG, Nebular, Taiga UI, Ng-Zorro, Ionic (treat as a separate stack), custom. Note once.
- **Build**: Webpack-based `@angular-devkit/build-angular:browser` vs esbuild-based `@angular/build:application` (Angular 17+ default for new projects). Note in repo overview.
- **SSR**: Angular Universal (legacy `@nguniversal/*`) vs `@angular/ssr` (Angular 17+ idiomatic), prerendering vs on-demand rendering, hydration (`provideClientHydration`).
- **i18n**: `@angular/localize`, ngx-translate, transloco.
- **Testing**: Karma + Jasmine (default), Jest, Cypress/Playwright e2e.

## Common gotchas

- **Change detection traps with `OnPush`**: mutating arrays/objects in place (`arr.push(...)`) won't trigger CD; new references are required. Document any module that uses `OnPush` so reviewers know.
- **Zone.js leaks and zoneless mode**: timers, third-party libs, or `setTimeout` outside Angular's zone (`NgZone.runOutsideAngular`) cause missed CD or perf surprises. Angular 18+ zoneless apps invert these rules — note which mode the repo uses.
- **`subscribe()` without teardown**: long-lived `Subscription`s leak. Idiomatic teardown is `takeUntilDestroyed(destroyRef)` (signals/standalone), `takeUntil(destroy$)` with a `Subject` in `ngOnDestroy`, or the `async` pipe in templates.
- **`providedIn: 'root'` singletons across lazy modules**: a service provided in a lazy feature (`providers: [...]` in a route) is a different instance from the root one — easy to double-instantiate state by accident.
- **Standalone vs NgModule mixed in the same project**: standalone components imported into NgModules require listing in `imports` (not `declarations`); declared components consumed by standalone require importing the whole NgModule. Note the mix pattern explicitly.
- **`inject()` outside of an injection context**: calling `inject()` in async callbacks, `setTimeout`, or after the constructor throws. Use `runInInjectionContext` or move the call to construction time.
- **Signal pitfalls**: reading a signal inside `effect()` makes it a dependency — unintended reads cause re-runs; `computed()` memoizes only by reference equality; `untracked()` exists for a reason.
- **Route-data coupling**: route `data` and `resolve` results show up as `ActivatedRoute.data` observable — components that read them must subscribe with `async` or stream-aware logic, not snapshot reads, or they'll miss updates on same-route navigation.
- **`tsconfig` paths and Nx workspace boundaries**: Nx libs enforce module boundaries via `@nx/enforce-module-boundaries` ESLint rule — note the tag taxonomy in the repo overview.

# Stack convention: Vue (Nuxt, Vite-Vue, Quasar)

## Module = feature folder

Discovery (priority):
1. `src/features/<name>/` or `src/modules/<name>/` → modules
2. Nuxt: `app/pages/<feature>/` or `pages/<feature>/`
3. `src/views/<name>/` (route-grouped)
4. Fallback: communities

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| pages / views | `pages.md` | ≥2 | `**/pages/*.vue`, `**/views/*.vue`, file-based routes |
| components | `components.md` | ≥5 | `**/components/**/*.vue` |
| composables | `composables.md` | ≥3 `use*` | `**/composables/use*.ts`, `**/use*.ts` |
| stores | `stores.md` | ≥1 Pinia/Vuex store | `**/stores/*.ts`, `defineStore()` |
| services / api | `services.md` | ≥3 API calls | `**/services/*.ts`, `**/api/*.ts` |
| types | `types.md` | ≥5 domain types | `**/types/*.ts` |
| middleware | `middleware.md` | Nuxt middleware ≥1 | `middleware/*.ts` |

## Per-artifact rules

### `pages.md`
- Route per page (Vue Router or Nuxt file-based).
- For each: `<script setup>` section (composables used), data fetching strategy (`useFetch`, `useAsyncData` for Nuxt; manual `onMounted` for SPA Vue).
- Layouts and meta (title, middleware) for Nuxt.

### `components.md`
- Group by purpose (layout / data display / forms / feedback / domain).
- Public components (used by other modules) only.
- Per component: props interface, events emitted, slots exposed, scoped style notes.

### `composables.md`
- One H3 per composable.
- Per composable: signature, reactive state returned, side effects, when to use.
- Vue 3 Composition API specifics — `ref`, `reactive`, `computed`, `watch` usage notes.

### `stores.md`
- Pinia: `defineStore(id, () => {...})` pattern.
- State + getters + actions per store.
- Persistence (pinia-plugin-persistedstate).
- Cross-store dependencies.

### `services.md`
- One H3 per service function. Same pattern as React: HTTP method + path + handler link.
- Cross-repo links via merged graph mandatory when graph has matches.

## Patterns to detect

- **Build**: Vite, Nuxt 3, Vue CLI, Quasar.
- **Router**: Vue Router (SPA) vs file-based (Nuxt).
- **State**: Pinia (canonical for Vue 3), Vuex (legacy).
- **Data fetching**: `useFetch`/`useAsyncData` (Nuxt), Vue Query, raw fetch.
- **UI library**: Vuetify, PrimeVue, Element Plus, Naive UI, custom.
- **Forms**: VeeValidate, FormKit, custom.
- **i18n**: vue-i18n, nuxt-i18n.
- **SSR vs SPA** — Nuxt SSR is different from Vite-Vue SPA; note in repo overview.

## Common gotchas

- `<script setup>` vs Options API — note which is used.
- Auto-imports in Nuxt — components/composables don't show up as explicit imports.
- Reactivity gotchas — `ref` vs `reactive`, destructuring breaking reactivity.
- Server vs client-only code (`if (process.server)` / `<ClientOnly>` in Nuxt).
- Hydration mismatches in SSR.

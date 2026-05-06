# Stack convention: React (Vite, Next.js, CRA)

## Module = feature folder

Discovery (in priority order):
1. `src/features/<name>/` — explicit feature folders → modules
2. `src/modules/<name>/` — same
3. `src/pages/<name>/` — page-based grouping (Next.js, often)
4. Top-level domain folders under `src/<name>/` if not the framework conventions (skip `src/components/`, `src/hooks/`, `src/utils/`, `src/api/` — those are cross-cutting unless they're the only structure)
5. Fallback: graphify communities

If `src/` has only `components/`, `hooks/`, etc. (no domain folders), the project doesn't have explicit modules. Use communities and propose names like `auth`, `dashboard`, `profile` based on the dominant page/route in each community.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| pages | `pages.md` | ≥2 pages | `**/pages/*.{tsx,jsx}`, `**/*Page.{tsx,jsx}`, route configs |
| components | `components.md` | ≥5 components | `**/components/**/*.{tsx,jsx}` |
| hooks | `hooks.md` | ≥3 custom hooks | `**/use*.{ts,tsx}` |
| stores | `stores.md` | ≥1 store/slice | `**/store*.{ts,tsx}`, zustand `create()`, redux slices |
| services | `services.md` | ≥3 API calls | `**/services/*.{ts,tsx}`, `**/api/*.{ts,tsx}` |
| types | `types.md` | ≥5 exported types | `**/types.{ts,tsx}`, `**/*.d.ts` (only if domain-meaningful) |
| utils | folded | always folded into README | `**/utils/*.{ts,tsx}` |
| flows | `flows.md` | always when ≥2 hooks coordinate | derived |

## Per-artifact writing rules

### `pages.md`
- One H3 per page/screen.
- Per page: route, what it shows, primary user action, hooks used, services called.
- Embed mermaid for non-trivial state machines (e.g., a wizard with 5 steps).

### `components.md`
- Don't list every component. Group by purpose:
  - **Layout** (Page, Section, Container, Header)
  - **Data display** (List, Table, Card, Detail)
  - **Forms** (Input, Select, FormSection)
  - **Feedback** (Alert, Toast, Spinner)
  - **Domain-specific** (InspectionStatusBadge, ClientCard)
- Document **public** components (used outside this module). Internal-only: skip.
- For each documented: props, when to use, code ref.
- If the module has a UI library it consumes (gluestack, MUI, shadcn), note which primitives wrap which.

### `hooks.md`
- One H3 per hook.
- Per hook: signature, what it does, when to use, dependencies.
- For data hooks (TanStack Query, SWR, RTK Query): note query key, stale time, refetch triggers, cache invalidations.
- Mermaid sequence for hooks doing complex orchestration.

### `stores.md`
- One H3 per store/slice.
- State shape (TS interface).
- Actions / mutations / setters.
- Selectors (if any).
- Persistence (localStorage, AsyncStorage, none).
- Cross-store dependencies.

### `services.md`
- One H3 per service function.
- Per service: HTTP method + path, request shape, response shape, error handling, retries.
- **Cross-repo link** to backend handler (mandatory when graph has the link).
- Note auth handling (token attachment, refresh).

### `types.md`
- Only document **domain types** (Inspection, Client, etc.) — skip utility types.
- Show the type definition.
- Cross-reference to backend models / mobile types (consistency check).
- 🟡 if frontend type shape diverges from backend: flag it.

## Patterns to detect

- **State management lib**: zustand, jotai, redux-toolkit, mobx, none. Note in stores.md.
- **Data fetching**: TanStack Query, SWR, RTK Query, raw fetch, axios. Note in services.md.
- **Form library**: react-hook-form, formik, none. Note in cross-cutting/forms.md if used in 3+ modules.
- **Routing**: react-router, next router, tanstack router, expo-router. Note in cross-cutting/routing.md.
- **Styling**: styled-components, emotion, tailwind, css-modules, vanilla. Note once at repo overview.
- **UI library**: shadcn, MUI, chakra, gluestack, custom. Note once.

## Common gotchas

- Next.js: `app/` (App Router) vs `pages/` (Pages Router) — different conventions.
- Vite + react: `vite.config.ts` may define aliases used in imports.
- Lazy-loaded routes vs eager — note for performance discussions.
- Server components (RSC, Next.js 13+): different rules — note when a component is server-only.

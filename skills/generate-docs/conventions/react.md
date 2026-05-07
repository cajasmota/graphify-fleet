# Stack convention: React (Vite, Next.js, CRA)

> Graph-searchability: every React doc inherits the universal backtick contract from `_graph-searchability.md`. Component names (`<DashboardShell>`), hook names (`useInspections`), service function names, store / slice names, file paths — all in backticks every time, including in headings.

## Module = feature folder

Discovery (in priority order):
1. `src/features/<name>/` — explicit feature folders → modules
2. `src/modules/<name>/` — same
3. `src/pages/<name>/` — page-based grouping (Next.js, often)
4. Top-level domain folders under `src/<name>/` if not the framework conventions (skip `src/components/`, `src/hooks/`, `src/utils/`, `src/api/` — those are cross-cutting unless they're the only structure)
5. Fallback: graphify communities (the auto-detected groupings of files that frequently change together; if no explicit folder structure exists, use these communities as proposed module boundaries)

If `src/` has only `components/`, `hooks/`, etc. (no domain folders), the project doesn't have explicit modules. Use communities and propose names like `auth`, `dashboard`, `profile` based on the dominant page/route in each community.

## Canonical artifact files

Each module folder's homepage is `index.md` (NOT `README.md`). Below-threshold artifacts fold into `index.md` as a section.

| Artifact | File | Template | Threshold | Source patterns |
|----------|------|----------|-----------|-----------------|
| screens/pages | `screens.md` | `output-templates/screens.md` | ≥2 pages | `**/pages/*.{tsx,jsx}`, `**/*Page.{tsx,jsx}`, route configs |
| components | `components.md` | `output-templates/components.md` | ≥5 PUBLIC components | `**/components/**/*.{tsx,jsx}` |
| hooks | `hooks.md` | `output-templates/hooks.md` | ≥3 custom hooks | `**/use*.{ts,tsx}` |
| stores | `stores.md` | `output-templates/cross-cutting.md` | ≥1 store/slice | `**/store*.{ts,tsx}`, zustand `create()`, redux slices |
| services (API) | `services.md` | `output-templates/api-class.md` (Swagger-card) | ≥3 API calls | `**/services/*.{ts,tsx}`, `**/api/*.{ts,tsx}` |
| types | `models.md` | `output-templates/models.md` | ≥5 exported types | `**/types.{ts,tsx}`, `**/*.d.ts` (only if domain-meaningful) |
| utils | folded | — | always folded into index.md | `**/utils/*.{ts,tsx}` |
| flows | `user-journey.md` | `output-templates/user-journey.md` | always when ≥2 hooks coordinate | derived |

## Per-artifact writing rules

### `screens.md` (use `output-templates/screens.md`)
- One H3 per page/screen.
- Per page: route, what it shows, primary user action, hooks used, services called.
- Embed mermaid for non-trivial state machines (e.g., a wizard with 5 steps).

### `components.md` (use `output-templates/components.md`)
- Group by purpose — don't enumerate every component:
  - **Layout** (Page, Section, Container, Header)
  - **Data display** (List, Table, Card, Detail)
  - **Forms** (Input, Select, FormSection)
  - **Feedback** (Alert, Toast, Spinner)
  - **Domain-specific** (InspectionStatusBadge, CustomerCard)
- Document **only public** components (those used outside this module). Internal-only components are skipped entirely — not even mentioned.
- For each documented component: props table, when to use, code ref.
- If the module consumes a UI library (gluestack, MUI, shadcn), note which primitives wrap which.
- Override vs template: the template defines the section order (group H2 → component H3 → props/when-to-use). React adds the "wraps which UI-lib primitive" note at the top of each H3 when relevant.

### `hooks.md` (use `output-templates/hooks.md`)
- One H3 per hook.
- Per hook: signature, what it does, when to use, dependencies.
- For data hooks (TanStack Query, SWR, RTK Query): note query key, stale time, refetch triggers, cache invalidations.
- "How it works" sections describing orchestration must be PLAIN PROSE — never annotated code blocks. Use mermaid sequence for complex orchestration.

### `stores.md` (use `output-templates/cross-cutting.md` shape)
- One H3 per store/slice.
- State shape (TS interface).
- Actions / mutations / setters.
- Selectors (if any).
- Persistence (localStorage, AsyncStorage, none).
- Cross-store dependencies.

### `services.md` — Swagger-card format (use `output-templates/api-class.md`)
- One H3 per service function, formatted as a Swagger-style card.
- Method emoji prefix in the H3: 🟢 GET, 🟡 POST, 🔵 PUT/PATCH, 🟣 DELETE, 🔴 destructive/admin.
- Each card uses collapsible `<details>` sections for: Parameters, Request body, Responses, Errors.
- "How it works" subsection (when present) is PLAIN PROSE — never annotated code. Describe what the service function does, what it sends, how it handles auth/errors, in sentences.
- **Cross-repo link** to backend handler (mandatory when graph has the link).
- Note auth handling (token attachment, refresh) once at top of file.
- Override vs template: api-class.md defines the card structure; React services add the "calls backend handler X" cross-repo link inside each card.

### `models.md` (use `output-templates/models.md`)
- Only document **domain types** (Order, Customer, etc.) — skip utility types.
- Show the type definition.
- Cross-reference to backend models / mobile types (consistency check).
- 🟡 if frontend type shape diverges from backend: flag it.

## Patterns to detect

- **State management lib**: zustand, jotai, redux-toolkit, mobx, none. Note in stores.md.
- **Data fetching**: TanStack Query, SWR, RTK Query, raw fetch, axios. Note in services.md.
- **Form library**: react-hook-form, formik, none. Note in `cross-cutting/forms.md` (use `output-templates/cross-cutting.md`) if used in 3+ modules.
- **Routing**: react-router, next router, tanstack router, expo-router. Note in `cross-cutting/routing.md` (use `output-templates/cross-cutting.md`).
- **Styling**: styled-components, emotion, tailwind, css-modules, vanilla. Note once at repo overview.
- **UI library**: shadcn, MUI, chakra, gluestack, custom. Note once.

## Common gotchas

- Next.js: `app/` (App Router) vs `pages/` (Pages Router) — different conventions.
- Vite + react: `vite.config.ts` may define aliases used in imports.
- Lazy-loaded routes vs eager — note for performance discussions.
- Server components (RSC, Next.js 13+): different rules — note when a component is server-only.

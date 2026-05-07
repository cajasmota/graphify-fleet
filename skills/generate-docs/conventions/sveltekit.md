# Stack convention: SvelteKit / Svelte

## Module = route group, lib subdirectory, or feature folder

Discovery:
1. `src/routes/<group>/` (SvelteKit route groups e.g. `(authenticated)/dashboard/`)
2. `src/lib/<feature>/` (shared feature code)
3. `src/features/<name>/` (feature folder convention if used)
4. Communities fallback

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| routes | `routes.md` | ≥2 routes | `src/routes/**/+page.svelte`, `+page.server.ts`, `+page.ts` |
| server endpoints | `endpoints.md` | ≥3 | `src/routes/**/+server.ts` |
| components | `components.md` | ≥5 | `**/*.svelte` (skip routes) |
| stores | `stores.md` | ≥1 store | `src/lib/stores/*.ts`, `writable`/`readable`/`derived` |
| actions | `actions.md` | ≥1 form action | `+page.server.ts` `actions` exports |
| hooks | `hooks.md` | only at app root | `src/hooks.server.ts`, `src/hooks.client.ts` |

## Per-artifact rules

### `routes.md`
- Per route: file path, what loads (load function), what renders, server-side vs client-side.
- Form actions per route — list each action's name + what it does.
- `+layout.svelte` files for shared shell.

### `endpoints.md`
- Per endpoint: `+server.ts` exports (GET, POST, etc.), what they return, validation.

### `components.md`
- Same grouping as React/Vue.
- Per component: props (TS interface), events dispatched, slots, snippet (Svelte 5+).

### `stores.md`
- Per store: `writable` / `readable` / `derived`, initial value, subscribers, persistence (svelte-persisted-store).

### `actions.md`
- Form actions are SvelteKit's progressive-enhancement form handling.
- Per action: validation, side effects, redirect/return shape.

## Patterns to detect

- **Svelte 5** (runes: `$state`, `$derived`, `$effect`) vs Svelte 4 (stores). Note in repo overview.
- **SvelteKit version** — adapter (node, vercel, cloudflare, static).
- **Forms**: SvelteKit form actions (built-in), Felte, Superforms.
- **Data fetching**: load functions (server vs universal), TanStack Query Svelte.
- **Auth**: Lucia, Auth.js, custom in hooks.server.ts.

## Common gotchas

- `+page.svelte` vs `+page.server.ts` vs `+page.ts` (universal) — different runtime contexts.
- Reactive `$:` blocks (Svelte 4) vs runes (Svelte 5).
- SSR pitfalls (window, document only on client).
- File-based routing with route groups `(group)` (don't add to URL).

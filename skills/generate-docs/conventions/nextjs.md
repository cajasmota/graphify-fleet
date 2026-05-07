# Stack convention: Next.js

Use this convention instead of `react.md` when the repo contains `next.config.{js,ts,mjs,cjs}`. Next.js is React-shaped but the App Router introduces enough new artifact types (route handlers, server actions, layouts, loading/error boundaries, middleware) that flat React docs lose too much fidelity.

This convention covers Next.js 14 and 15. The **App Router** (`app/`) is the modern default and the assumed shape for new docs. The **Pages Router** (`pages/`) is treated as legacy fallback. A repo may have both — document them as separate modules and call out the precedence rule (App wins).

## Module = route segment, route group, or feature folder

Discovery (in priority order):

1. **App Router route groups** — `app/(<group>)/` where `<group>` is a parenthesized organizational folder (e.g. `app/(authenticated)/`, `app/(marketing)/`). Each group is a module.
2. **App Router top-level segments** — `app/<feature>/` directories that contain a `page.tsx` (or nested route tree) and are not themselves inside a route group → modules.
3. **Pages Router directories** (legacy) — `pages/<feature>/` directories with multiple page files → modules. `pages/api/<feature>/` is a separate API module.
4. **Shared feature folders** — `src/features/<name>/`, `src/lib/<name>/`, or top-level `lib/<name>/` for non-route domain code → modules.
5. **Multi-app monorepos (Nx, Turbo, pnpm workspaces)** — `apps/<app>/` is NOT a module of one repo; each app is a separate gfleet repo. Document them independently.
6. **Fallback** — graphify communities (auto-detected groupings of files that change together) when the project lacks explicit grouping.

If `app/` has only top-level routes and no route groups, every top-level segment with non-trivial content is its own module. Skip cross-cutting infrastructure folders (`app/_components/`, `app/_lib/`) — those fold into a `cross-cutting/` doc.

Note on filenames: Next.js itself uses `page.tsx`/`page.js` for the homepage of each route segment. That is Next's runtime convention. The **documentation** homepage of every module folder is still `index.md` (NOT `README.md`, NOT `page.md`). Don't conflate the two.

## Canonical artifact files

Each module folder's homepage is `index.md`. Below-threshold artifacts fold into `index.md` as a section.

| Artifact | File | Template | Threshold | Source patterns |
|----------|------|----------|-----------|-----------------|
| routes (App Router) | `routes.md` or per-group `routes.<group>.md` | `output-templates/screens.md` | ≥2 routes | `app/**/page.{tsx,jsx,ts,js}` |
| pages (Pages Router) | `pages.md` | `output-templates/screens.md` | ≥2 pages | `pages/**/*.{tsx,jsx,ts,js}` (skip `_app`, `_document`, `api/**`) |
| route handlers | `route-handlers.md` | `output-templates/api-class.md` (Swagger-card) | ≥1 handler | `app/api/**/route.{ts,js}`, `app/**/route.{ts,js}` |
| server actions | `actions.md` | `output-templates/api-class.md` | ≥1 action | files with top-level or inline `'use server'` |
| components | `components.md` | `output-templates/components.md` | ≥5 PUBLIC components | `**/*.{tsx,jsx}` excluding route files |
| layouts | `layouts.md` | `output-templates/components.md` | ≥1 non-root layout | `app/**/layout.{tsx,jsx}` |
| loading/error/not-found | `loading-error.md` | `output-templates/components.md` | ≥1 of any | `app/**/loading.{tsx,jsx}`, `error.{tsx,jsx}`, `not-found.{tsx,jsx}` |
| middleware | `middleware.md` | `output-templates/cross-cutting.md` | exists | `middleware.{ts,js}` at repo or `src/` root |
| data fetching | `data-fetching.md` | `output-templates/cross-cutting.md` | ≥3 fetch sites or any `unstable_cache` | `fetch(...)`, `unstable_cache`, `revalidatePath`, `revalidateTag`, route-segment config exports |
| metadata | `metadata.md` | `output-templates/cross-cutting.md` | ≥1 dynamic metadata or sitemap/robots | `metadata` exports, `generateMetadata`, `app/sitemap.ts`, `app/robots.ts`, `opengraph-image.{tsx,jsx}` |
| Pages Router API | `api-routes.md` | `output-templates/api-class.md` | ≥1 handler | `pages/api/**/*.{ts,js}` |
| utils | folded | — | always folded into index.md | `**/utils/*.{ts,tsx}` |
| flows | `user-journey.md` | `output-templates/user-journey.md` | ≥2 hooks/actions coordinate | derived |

Splitting hint: when a module spans multiple route groups (e.g. an admin module touching both `(authenticated)` and `(admin)`), produce `routes.<group>.md` per group rather than one mega-file.

## Per-artifact rules

### `routes.md` / `routes.<group>.md` (use `output-templates/screens.md`)

- One H3 per route, identified by file path (e.g. `app/(authenticated)/dashboard/page.tsx`).
- For each route document: what it renders (high level), whether the page is a server component or client component (`'use client'` at top), the data-loading strategy, and the layout chain it inherits.
- Data-loading strategies to call out explicitly: server fetch directly inside the page component, parallel data loads with `<Suspense>` boundaries, server actions invoked from the page, route handlers consumed via `fetch`, or client-side fetching after hydration.
- Document **parallel routes** (`@modal`, `@sidebar` slots) and **intercepting routes** (`(.)`, `(..)`, `(...)`) by listing them under the parent route and explaining the navigation behaviour in plain prose.
- Note dynamic segments (`[id]`, `[...slug]`, `[[...optional]]`) and whether they use `generateStaticParams` for SSG.
- "How it works" prose — never annotated code. If a route's flow is complex (e.g. a server component that streams two parallel suspense boundaries while a client island handles a form), describe the orchestration in sentences and add a mermaid sequence if it helps.

### `pages.md` (Pages Router, use `output-templates/screens.md`)

- One H3 per page file under `pages/`.
- Document `getServerSideProps`, `getStaticProps`, `getStaticPaths`, `getInitialProps` per page.
- Note `_app.tsx` and `_document.tsx` once at the top — what providers wrap the tree, what `<Head>` defaults are set.

### `route-handlers.md` — Swagger-card format (use `output-templates/api-class.md`)

- One H3 per exported HTTP method per `route.ts` file. A single `route.ts` exporting `GET` and `POST` becomes two cards.
- Method emoji prefix in the H3: 🟢 GET, 🟡 POST, 🔵 PUT/PATCH, 🟣 DELETE, 🔴 destructive/admin.
- Each card uses collapsible `<details>` sections for: Parameters (path + query), Request body, Responses, Errors.
- Per handler, capture: runtime (`export const runtime = 'nodejs' | 'edge'`), caching mode (`export const dynamic = 'force-static' | 'force-dynamic' | 'auto'`), revalidation window (`export const revalidate = N`), `fetchCache` overrides, `NextRequest` extensions used (`request.nextUrl`, `request.cookies`), use of `cookies()` / `headers()` from `next/headers` (these force the route dynamic), response shape via `NextResponse.json()` and the status code returned, and error handling.
- "How it works" subsection is PLAIN PROSE — describe what the handler reads, how it authenticates, what it writes, and what it returns, in sentences.
- **Cross-repo link** to the consuming client/service (mandatory when the graph has the link).
- Note auth attachment (middleware-injected headers, server-only cookie reads) once at the top of the file.

### `actions.md` — server actions (use `output-templates/api-class.md`)

- One H3 per server action.
- Distinguish file-level `'use server'` (entire module is server actions) from inline `'use server'` (individual function in an otherwise mixed file).
- For each action: signature, invocation pattern (form `action={...}`, `useFormState`/`useActionState`, direct call from a client component, programmatic call from a server component), validation (zod, valibot, manual), `revalidatePath` / `revalidateTag` calls it issues, redirect handling (`redirect()` throws — note this in prose), and the error-boundary segment that catches its throws.
- Progressive-enhancement notes: does the form work without JS? If `useFormState` is used, the form must remain submittable pre-hydration.
- Server actions invoked via form action are public endpoints — document their input validation explicitly.
- "How it works" is plain prose.

### `components.md` (use `output-templates/components.md`)

- Split the file into two top-level sections: **Server components** and **Client components**. Server components are the default; client components are anything starting with `'use client'`.
- Server components: async-capable, can `await` data, cannot use hooks/state/effects/event handlers, cannot use browser APIs.
- Client components: hooks, state, effects, event handlers, browser APIs are all available; cannot directly `await` data the way server components do.
- Note the **`'use client'` boundary** at the top of the file: anything imported (transitively) by a client component becomes part of the client bundle. This is a one-way infection — flag it for any component that sits at the boundary.
- Group within each section by purpose: Layout / Data display / Forms / Feedback / Domain-specific.
- Document only public components (used outside the module). Internal-only components are skipped.
- For each documented component: props table, when to use, code ref. For client components, also note browser APIs used and any third-party client libs pulled in.

### `layouts.md` (use `output-templates/components.md`)

- One H3 per `layout.tsx`, ordered from root outward.
- Per layout: route segment scope, what shell it provides, providers it mounts (theme, query client, auth context), `<html>` and `<body>` (root only), font loading via `next/font/google` or `next/font/local`, nested layout chain, and any `<Suspense>` boundaries it owns (cross-reference with `loading-error.md`).
- Note `template.tsx` files separately if present — templates re-mount on navigation, layouts don't.

### `loading-error.md` (use `output-templates/components.md`)

- One H3 per file, grouped by type: `loading.tsx`, `error.tsx`, `not-found.tsx`, `global-error.tsx`.
- For each `loading.tsx`: which segment it covers, what fallback UI it renders, whether it pairs with a `<Suspense>` boundary in a child layout/page.
- For each `error.tsx`: what errors it catches (only client-side errors in its segment subtree by default), recovery semantics (the `reset()` prop), and the requirement that `error.tsx` is always a client component.
- For each `not-found.tsx`: how it gets triggered (`notFound()` thrown from a server component, or unmatched dynamic route), and the segment scope.
- `global-error.tsx` replaces the root layout when it fires — call this out.

### `middleware.md` (use `output-templates/cross-cutting.md`)

- One section per concern handled (auth gate, locale rewrite, A/B bucketing, redirects).
- Document the `matcher` config exactly — which paths run middleware, which are excluded.
- Edge runtime constraints: no Node APIs (`fs`, `child_process`, most of `crypto`), small bundle limit, no native deps.
- Note any cookies set/read and any headers injected for downstream consumption (server components can read these via `headers()`).

### `data-fetching.md` (use `output-templates/cross-cutting.md`)

- Document the cache strategy mix used in this module/repo:
  - `fetch(url, { cache: 'force-cache' | 'no-store' })`
  - `fetch(url, { next: { revalidate: N, tags: ['...'] } })`
  - Route Segment Config exports: `dynamic`, `revalidate`, `fetchCache`, `runtime`, `preferredRegion`
  - `unstable_cache(fn, keyParts, { revalidate, tags })`
  - On-demand revalidation: `revalidatePath('/path')`, `revalidateTag('tag')`
- For each route or feature, tag the dominant strategy (e.g. "dashboard prefers `force-dynamic` because it reads `cookies()`; product list prefers ISR with `revalidate: 60`").
- Note any `unstable_*` API in use — these change between minor versions and must be flagged.

### `metadata.md` (use `output-templates/cross-cutting.md`)

- Static `metadata` exports per route — list which routes set their own metadata vs. inheriting from a layout.
- Dynamic `generateMetadata(params, parent)` — what data it reads, whether it shares a fetch with the page (Next dedupes identical fetches in a request).
- `generateStaticParams` — which dynamic segments are pre-rendered at build time and which fall back to on-demand.
- File-based metadata: `app/sitemap.ts`, `app/robots.ts`, `opengraph-image.tsx` (and `.alt.txt`), `icon.tsx`, `apple-icon.tsx`. List each file and what it produces.

### `api-routes.md` (Pages Router, use `output-templates/api-class.md`)

- Same Swagger-card format as `route-handlers.md`.
- Per handler: `req.method` switch (or `next-connect`), body parsing config (`export const config = { api: { bodyParser: ... } }`), middleware chain.

## Patterns to detect

- **Router style**: App Router (default since 13.4 / standard in 14+15) vs Pages Router (legacy) vs mixed. Note in repo overview.
- **Rendering strategy mix**: full SSR (`force-dynamic`), full SSG (`generateStaticParams` + default cache), ISR (`revalidate: N`), or RSC + client islands (modern default).
- **Auth**: NextAuth / Auth.js, Clerk, Supabase Auth, Lucia, custom middleware-based auth.
- **Data layer**: Prisma, Drizzle, Kysely, raw `postgres.js` / `pg`, tRPC (often co-located with App Router via route handlers), GraphQL via urql/Apollo.
- **Client state**: zustand, jotai, redux-toolkit, TanStack Query / React Query, SWR.
- **Forms**: react-hook-form, conform (works with server actions), native `<form action={...}>` with server actions.
- **Styling**: Tailwind, CSS Modules, styled-components (with the App Router compiler shim), Stitches, vanilla-extract, Panda CSS.
- **Images**: `next/image` with `remotePatterns`. Note any legacy `domains` config.
- **Build target**: default, `output: 'standalone'`, `output: 'export'` (full static export — disables many Next features), Edge runtime usage at the route level.
- **Deployment**: Vercel, AWS via SST or OpenNext, Cloudflare via `@cloudflare/next-on-pages`, self-hosted Node.
- **Monorepo**: Nx, Turborepo, pnpm workspaces — note shared packages consumed via `transpilePackages` in `next.config`.

## Common gotchas

- **`'use client'` infection** — once a component declares `'use client'`, every component it imports (transitively) ships to the client bundle. A single deep import can balloon the client bundle. Flag boundary components.
- **Hydration mismatches** — `Date.now()`, `Math.random()`, `new Date().toLocaleString()` (without explicit locale), and any reading of `window`/`document` in render produce server/client divergence. Document any deliberate use of `suppressHydrationWarning`.
- **Server actions are public endpoints** — invocation via `<form action={...}>` exposes them as POST endpoints with stable IDs. They MUST validate input regardless of which client UI calls them.
- **`cookies()` / `headers()` make a route dynamic** — calling either from `next/headers` opts the route out of static rendering. Note this against any route that reads cookies for personalization.
- **Edge runtime can't use Node APIs** — `fs`, `child_process`, `crypto.randomBytes`, native modules, large deps all break Edge handlers and middleware. If a handler uses Edge runtime, audit its imports.
- **`unstable_*` APIs** — `unstable_cache`, `unstable_noStore`, `unstable_after` etc. change between minor versions. Flag every use and pin the Next version they were tested against.
- **Parallel and intercepting routes are hard to reason about** — `@modal`, `(.)`, `(..)` produce non-obvious URL → render mappings. Document the route hierarchy explicitly with a tree diagram in `routes.md`.
- **Mixed App + Pages Router precedence** — when the same path resolves in both, App Router wins. Document any path that exists in both trees (often a migration in progress).
- **`next/image` `domains` is deprecated** — modern config uses `remotePatterns`. Flag if `domains` is still in `next.config`.
- **Server actions that throw need an `error.tsx`** — without an error boundary at the right segment, a thrown action surfaces as the global error page or an unhandled rejection. Document which segment owns the error boundary for each action.
- **`redirect()` and `notFound()` throw** — they don't return. Code after them is unreachable. Mention this in action and route handler prose where used.
- **Caching defaults shifted in 15** — Next 15 made `fetch` default to `no-store` (versus 14's `force-cache` default) and route handlers default to dynamic. Always state which default the repo's Next version uses, since the same code behaves differently across versions.
- **Static export (`output: 'export'`)** disables route handlers, server actions, middleware, ISR, and image optimization. If the repo uses static export, large parts of this convention's artifacts are inapplicable — narrow scope to routes, components, layouts, metadata.

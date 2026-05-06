# Pass 9 — VitePress static site config (default-on)

Generates a VitePress site config so the user can `npm run docs:dev` and get a beautiful, searchable, navigable site like Confluence — no Confluence required.

**Runs by default.** Skip with `--no-static-site` flag if the user explicitly opts out.

## Why VitePress

Same markdown, no source changes. Adds:
- Dark/light mode (auto)
- Built-in local search (no plugin)
- Sidebar nav generated from your folder structure
- Mermaid rendering (via plugin)
- Code copy buttons + line highlighting
- Mobile-responsive
- Static build deploys to GitHub Pages, Netlify, S3, anywhere

Faster than mkdocs (Vite hot-reload). JS-native (already in your stack). Better default theme.

## Files to write per docs root

For each repo's `docs/` AND the group docs path, write:

### `<docs-root>/.vitepress/config.mts`

```typescript
import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: '<repo or group display name>',
  description: '<one-line description from docs-config.json>',
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    nav: [
      // built dynamically from the folder structure
      { text: 'Overview', link: '/overview' },
      { text: 'Modules', link: '/modules/' },
      { text: 'Cross-cutting', link: '/cross-cutting/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'How-to', link: '/how-to/' },
    ],

    sidebar: {
      '/modules/': generateModuleSidebar(),  // see below
      '/cross-cutting/': [...],
      '/reference/': [...],
      '/how-to/': [...],
    },

    search: { provider: 'local' },

    // optional: docFooter, editLink, outline depth
    outline: { level: [2, 3] },
  },

  mermaid: {
    // mermaid options if needed
  },
}))
```

### `<docs-root>/package.json`

Minimal stub (don't merge with the repo's main package.json — keep docs deps isolated):

```json
{
  "name": "<repo>-docs",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "docs:dev": "vitepress dev",
    "docs:build": "vitepress build",
    "docs:preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "^1.5.0",
    "vitepress-plugin-mermaid": "^2.0.0",
    "mermaid": "^11.4.0"
  }
}
```

### `<docs-root>/index.md`

VitePress prefers `index.md` as homepage. The skill already wrote `README.md`. Create `index.md` as a hero-page wrapper that links to the README content — or symlink-equivalent:

```markdown
---
layout: home

hero:
  name: "<Repo display name>"
  tagline: "<one-line tagline from docs-config.json>"
  actions:
    - theme: brand
      text: Read the overview
      link: /overview
    - theme: alt
      text: Browse modules
      link: /modules/
    - theme: alt
      text: Reference
      link: /reference/

features:
  - title: Architecture
    details: Module-by-module deep dives with mermaid diagrams.
    link: /overview
  - title: API
    details: Every endpoint, every action. Full params, errors, side effects.
    link: /modules/
  - title: Cross-cutting
    details: Auth, permissions, logging — concerns that span modules.
    link: /cross-cutting/
---

<!-- The full doc map is in [README](./README) -->
```

Don't overwrite the existing README.md. VitePress reads both — this just gives a nicer landing page.

## Sidebar generation logic

Build the sidebar from the folder structure on disk (the structure Pass 2 chose). For SUBFOLDER-shaped modules, expand sub-pages. For FLAT modules, just the top-level files.

```typescript
function generateModuleSidebar() {
  // Read modules/ subdirectories
  // For each module:
  //   if has api/ subfolder: expand
  //   if has flows/ subfolder: expand
  //   else: link to README
  // Return VitePress sidebar shape
}
```

The skill should write the sidebar **statically** (resolved at generation time), not generate it dynamically — VitePress builds happen on developer machines that may not have `fs` access to the dynamic generator.

Example resolved sidebar for `upvate-core`:

```typescript
sidebar: {
  '/modules/': [
    {
      text: 'Inspections',
      collapsed: false,
      items: [
        { text: 'Overview', link: '/modules/inspections/' },
        { text: 'Models', link: '/modules/inspections/models' },
        {
          text: 'API',
          collapsed: true,
          items: [
            { text: 'Index', link: '/modules/inspections/api/' },
            { text: 'Lifecycle', link: '/modules/inspections/api/lifecycle' },
            { text: 'Counts & filters', link: '/modules/inspections/api/counts-filters' },
            { text: 'ME-specific', link: '/modules/inspections/api/me-specific' },
            { text: 'Emails', link: '/modules/inspections/api/emails' },
            { text: 'Groups', link: '/modules/inspections/api/groups' },
          ]
        },
        {
          text: 'Flows',
          collapsed: true,
          items: [
            { text: 'Status machine', link: '/modules/inspections/flows/status-machine' },
            { text: 'Deficiency lifecycle', link: '/modules/inspections/flows/deficiency-lifecycle' },
            { text: 'Massachusetts email', link: '/modules/inspections/flows/massachusetts-email' },
          ]
        },
      ]
    },
    {
      text: 'Contracts',
      collapsed: true,
      items: [/* ... */]
    },
    // ... per module
  ]
}
```

## Run summary addition

```
VitePress sites configured:
  - upvate-core/docs/      (cd upvate_core/docs && npm install && npm run docs:dev)
  - upvate-frontend/docs/
  - upvate-mobile/docs/
  - <group-docs-path>/     (group-level)

To preview: cd <docs-root> && npm install && npm run docs:dev
To build:   npm run docs:build  (output: <docs-root>/.vitepress/dist/)
```

## Idempotence

- Don't overwrite an existing `package.json` if the user has already customized it (`<!-- skill: managed -->` marker at top). Default behavior: write fresh on every run.
- `.vitepress/config.mts` is fully auto-generated — overwrite each run (sidebar reflects current folder structure).
- `index.md` skip if `<!-- docs:manual -->` at top — user may have customized hero copy.
- Don't touch `node_modules/` or `package-lock.json`.

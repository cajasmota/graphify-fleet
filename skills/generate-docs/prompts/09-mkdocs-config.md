# Pass 9 — Optional: mkdocs-material site config

Run only when invoked with `--with-mkdocs`. Generates `mkdocs.yml` and a tiny landing page so the user can `mkdocs serve` and get a beautiful static site.

## Why

Markdown is fine on GitHub. mkdocs-material gives:
- Searchable, sidebar-navigable site
- Dark mode
- Mermaid rendering
- Code copy buttons
- Versioning + tabs (we don't need versioning, but it works)

Source format unchanged — same markdown, no changes.

## Files to write (per repo and per group)

### `mkdocs.yml` (in the same dir as `docs/`)

```yaml
site_name: <repo display name> docs
site_description: <one-liner>
theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - navigation.expand
    - navigation.top
    - search.suggest
    - search.highlight
    - content.code.copy
  palette:
    - media: "(prefers-color-scheme: light)"
      scheme: default
      toggle:
        icon: material/brightness-7
        name: Switch to dark mode
    - media: "(prefers-color-scheme: dark)"
      scheme: slate
      toggle:
        icon: material/brightness-4
        name: Switch to light mode
markdown_extensions:
  - admonition
  - pymdownx.details
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
  - pymdownx.tabbed:
      alternate_style: true
  - tables
  - toc:
      permalink: true
nav:
  - Home: README.md
  - Overview: overview.md
  - Modules:
    - <module-1>: modules/<module-1>/README.md
    - <module-2>: modules/<module-2>/README.md
    - ...
  - Cross-cutting:
    - Permissions: cross-cutting/permissions.md
    - ...
  - Reference:
    - Config: reference/config.md
    - Scripts: reference/scripts.md
    - Deployment: reference/deployment.md
    - Dependencies: reference/dependencies.md
  - How-to:
    - Local dev: how-to/local-dev.md
    - ...
plugins:
  - search
```

Build the `nav` from the actual docs files present.

### Tiny `requirements-docs.txt` next to mkdocs.yml

```
mkdocs-material>=9.5
pymdown-extensions>=10
```

### Optional `docs/.github-pages.yml` if user opts in later

(Don't write unless asked.)

## Notes

- For the **group** docs, write `mkdocs.yml` at `<group_docs_path>/mkdocs.yml` with its own nav structure.
- Don't enable any plugins beyond `search` to keep the install minimal.
- Don't override the README.md to be index.md — keep README.md as the primary; mkdocs-material picks it up.

## Run summary

If this pass ran:
```
mkdocs config written:
  - upvate-core/mkdocs.yml         (run: cd upvate_core && mkdocs serve)
  - upvate-frontend/mkdocs.yml
  - upvate-mobile/mkdocs.yml
  - upvate-docs/mkdocs.yml         (group)

To preview: pip install mkdocs-material && mkdocs serve
```

# Stack convention: Terraform

> Graph-searchability: every Terraform doc inherits the universal backtick contract from `_graph-searchability.md`. Module names, resource types (`aws_vpc`, `google_storage_bucket`), variable names, output names, file paths — all in backticks every time, including in headings.

Infra is organized differently — by **resource type** + **environment** rather than features.

## Discovery

- `modules/<name>/` → terraform modules (treated like reusable libraries)
- `environments/<env>/` or `live/<env>/` → environment-specific configs
- Top-level `*.tf` → root module

## Folder structure (override the default doc layout)

Every folder's homepage is `index.md` (NOT `README.md`).

```
docs/
├── index.md                # repo homepage
├── overview.md             # system diagram, naming conventions
├── environments/
│   ├── index.md
│   ├── dev.md
│   ├── staging.md
│   └── production.md
├── components/             # logical groupings of resources
│   ├── index.md
│   ├── networking.md
│   ├── compute.md
│   ├── storage.md
│   ├── databases.md
│   ├── messaging.md
│   ├── observability.md
│   └── secrets.md
├── modules/                # if using TF modules
│   ├── index.md
│   └── <module>.md
├── reference/
│   ├── index.md
│   ├── variables.md
│   ├── outputs.md
│   └── policies.md
└── runbooks/
    ├── index.md
    └── <procedure>.md      # ops procedures, only if found
```

## Per-component docs (use `output-templates/infra-component.md`)

Each `components/<name>.md` follows `output-templates/infra-component.md`. Group resources by cloud-service category (networking, compute, storage, databases, messaging, observability, secrets). Per component file:
- What resources exist and what they're for (one H2 per resource type or named cluster)
- Key configuration (sizes, classes, retention, replication)
- Cross-references — which app module uses this DB, which subnet hosts this service, which secret feeds which container
- Naming convention check — 🟡 anywhere config doesn't follow the repo's convention
- Override vs template: infra-component.md defines the section order (Purpose → Resources → Configuration → Consumers → Operations); Terraform-specific overrides add the `tfvars`-derived sizing column to the Configuration table.

## Per-environment docs

For each environment:
- Region(s), AZ(s)
- Approximate cost estimate (if `*.tfvars` shows instance types)
- What differs from production
- Which AWS account / project

## Modules docs

Per terraform module:
- Inputs (variables) — name, type, default, purpose
- Outputs — name, what it provides, who consumes it
- Resources created
- Usage example

## Patterns

- State backend: S3+Dynamo, Terraform Cloud, GCS. Note in overview.
- Workspaces vs separate dirs per env.
- Atlantis or Terragrunt usage.
- Naming convention (e.g., `<env>-<system>-<resource>`).

## Common gotchas

- `count` and `for_each` usage — explain when relevant.
- Hardcoded ARNs vs `data` lookups — flag.
- Secrets in tfvars — 🟡 flag.

# Stack convention: Terraform

Infra is organized differently — by **resource type** + **environment** rather than features.

## Discovery

- `modules/<name>/` → terraform modules (treated like reusable libraries)
- `environments/<env>/` or `live/<env>/` → environment-specific configs
- Top-level `*.tf` → root module

## Folder structure (override the default doc layout)

```
docs/
├── README.md
├── overview.md             # system diagram, naming conventions
├── environments/
│   ├── dev.md
│   ├── staging.md
│   └── production.md
├── components/             # logical groupings of resources
│   ├── networking.md
│   ├── compute.md
│   ├── storage.md
│   ├── databases.md
│   ├── messaging.md
│   ├── observability.md
│   └── secrets.md
├── modules/                # if using TF modules
│   └── <module>.md
├── reference/
│   ├── variables.md
│   ├── outputs.md
│   └── policies.md
└── runbooks/
    └── <procedure>.md      # ops procedures, only if found
```

## Per-component docs

Group resources by AWS service category (or whatever cloud). Per component:
- What resources exist and what they're for
- Key configuration (sizes, classes, retention)
- Cross-references (which app uses this DB, which subnet hosts this service)
- 🟡 anywhere config doesn't follow naming convention

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

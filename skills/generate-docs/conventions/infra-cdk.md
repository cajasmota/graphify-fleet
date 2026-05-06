# Stack convention: AWS CDK

Similar to Terraform but uses code (TS/Python).

## Discovery

- `bin/<app>.ts` → entry points (CDK apps)
- `lib/<stack-name>.ts` → stacks
- `lib/constructs/` → reusable constructs

## Folder structure

```
docs/
├── README.md
├── overview.md
├── apps/                   # one per cdk app entry point
│   └── <app>.md
├── stacks/                 # one per stack class
│   ├── <stack>.md
├── constructs/             # reusable constructs
│   └── <construct>.md
├── environments/
│   ├── dev.md
│   ├── staging.md
│   └── production.md
├── reference/
│   ├── context.md          # cdk.context.json
│   ├── outputs.md
│   └── policies.md
└── runbooks/
```

## Per-stack doc

For each stack class:
- What it deploys (high-level)
- Constructs used
- Cross-stack dependencies (imports/exports)
- Environment differences (props passed by app)

## Per-construct doc

Constructs are reusable modules:
- Inputs (props interface)
- Resources created
- Outputs / properties exposed
- Usage example

## Common gotchas

- `cdk.context.json` cached values — note.
- Cross-environment hardcoded account IDs — flag.
- Secrets via SSM/SecretsManager — note pattern used.

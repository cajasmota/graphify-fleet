# Stack convention: AWS CDK

> Graph-searchability: every CDK doc inherits the universal backtick contract from `_graph-searchability.md`. App / Stack / Construct class names, AWS resource types (`aws_vpc`, `Bucket`), output names, context keys, file paths — all in backticks every time, including in headings.

Infrastructure as code authored in a real programming language (TypeScript or Python most commonly). Unlike declarative IaC, CDK synthesizes CloudFormation from constructs composed in code, so the documentation has to follow the **code structure** (apps → stacks → constructs) rather than a flat resource map.

## Module = CDK app OR stack class

Discovery:
1. `bin/<app>.ts` (or `app.py`) → each entry point is a CDK **app**. An app instantiates one or more stacks. Multi-app repos exist (e.g. `bin/web.ts`, `bin/data-pipeline.ts`); document each app separately.
2. `lib/<stack-name>.ts` (or `<stack>_stack.py`) → each class extending `Stack` (or `cdk.Stack`) is a stack module.
3. `lib/constructs/` or `lib/<feature>/` → reusable constructs (classes extending `Construct`). These are libraries — document only when reused or non-trivial.
4. Multi-stage apps: `Stage` subclasses (CDK Pipelines) group stacks per environment. Treat each stage as an environment grouping, not a separate module.
5. Detect cloud target from package imports: `aws-cdk-lib` / `@aws-cdk/*` → AWS CDK; `cdktf` → Terraform CDK; `cdk8s` → Kubernetes CDK. This file assumes AWS CDK; the same structure applies to the others with the resource vocabulary swapped.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| app | `apps/<app>.md` | one per `bin/*.ts` | `new App()`, stack instantiations |
| stack | `stacks/<stack>.md` | one per `Stack` subclass | `class X extends Stack` |
| construct | `constructs/<construct>.md` | reusable / ≥2 call sites | `class X extends Construct` |
| environment | `environments/<env>.md` | per env config | props/context keyed by `dev`/`staging`/`prod` |
| context | `reference/context.md` | if `cdk.context.json` present | cached lookups |
| outputs | `reference/outputs.md` | ≥1 `CfnOutput` | exports between stacks |
| policies | `reference/policies.md` | custom IAM | `PolicyStatement`, `Role`, `Grant` |
| runbooks | `runbooks/<procedure>.md` | only if found | deploy/rollback procedures |

## Folder structure

```
docs/
├── README.md
├── overview.md             # synth model, account/region map, naming conventions
├── apps/                   # one per CDK app entry point
│   └── <app>.md
├── stacks/                 # one per stack class
│   └── <stack>.md
├── constructs/             # reusable constructs
│   └── <construct>.md
├── environments/
│   ├── dev.md
│   ├── staging.md
│   └── production.md
├── reference/
│   ├── context.md          # cdk.context.json cached values
│   ├── outputs.md          # CfnOutput / cross-stack exports
│   └── policies.md         # IAM roles, custom policies
└── runbooks/
    └── <procedure>.md
```

## Per-artifact rules

### `apps/<app>.md`
- Entry point file path (`bin/<app>.ts`).
- List of stacks instantiated, in instantiation order.
- How environment is selected (CLI context `-c env=...`, `process.env`, `cdk.json` defaults).
- Account/region resolution: hardcoded, `Aws.ACCOUNT_ID`, `env: { account, region }` from props, or `CDK_DEFAULT_ACCOUNT`. Note which.
- If using `Stage` (CDK Pipelines): list stages and which stacks each contains.
- Any cross-stack wiring done at app level (passing one stack's exports into another's props).

### `stacks/<stack>.md`
For each `Stack` subclass:
- **What it deploys**: 2-4 sentence high-level summary (e.g. "VPC with public/private subnets across 3 AZs plus NAT gateways").
- **Props interface**: every field in the stack's `Props` interface — name, type, purpose, whether optional.
- **Constructs used**: list of L2/L3 constructs and reusable in-repo constructs. Do not enumerate every L1 resource — group them.
- **Resources of note**: anything with non-default config (retention, encryption, instance class, scaling). One bullet per.
- **Cross-stack dependencies**:
  - Imports: `Fn.importValue`, `StringParameter.valueFromLookup`, props passed from app, `stack.addDependency()`.
  - Exports: every `CfnOutput` with `exportName`, what consumes it.
- **Environment differences**: which props change between dev/staging/prod and the effect (e.g. instance class, removal policy, deletion protection).
- 🟡 flag: hardcoded ARNs, account IDs, or region strings inside stack code.

### `constructs/<construct>.md`
For each reusable construct:
- **Props interface**: every field — name, type, default, purpose. This is the public API.
- **Resources created**: bullet list of AWS resources synthesized (logical IDs and types).
- **Properties / outputs exposed**: public readonly fields the construct exposes for downstream wiring (e.g. `readonly bucket: IBucket`).
- **Usage example**: minimal TS/Python snippet showing instantiation.
- **Defaults & opinions**: any baked-in choices the consumer should know about (encryption on by default, log retention, IAM scoping).
- Note `grant*` methods exposed (e.g. `grantRead(role)`).

### `environments/<env>.md`
For each environment:
- AWS account ID and region(s).
- Stage / app variant deployed (if multi-stage).
- Context values passed (`-c key=value` or `cdk.json` per-env block).
- What differs from production (instance sizes, replica counts, retention, removal policies, alarm thresholds).
- Approximate cost estimate if instance types are visible.
- Deployment trigger: manual `cdk deploy`, CDK Pipelines, GitHub Actions, etc.

### `reference/context.md`
- List every key in `cdk.context.json` with what it caches (VPC lookups, AMI IDs, hosted zone IDs, AZ lists).
- Note: these values are **cached at synth time** — flag them as a deployment-correctness concern.
- Document `cdk context --reset <key>` procedure if used.

### `reference/outputs.md`
- Every `CfnOutput` with `exportName` set, grouped by stack.
- For each: export name, value source, consumer (which stack imports it, or external).

### `reference/policies.md`
- Custom `PolicyStatement` definitions and `Role`s — what each grants and to whom.
- Any `*.fromRoleArn` / `*.fromAccountId` lookups (cross-account).
- Managed policies attached and why.

## Patterns to detect

- **Language**: TypeScript (`*.ts`, `package.json` with `aws-cdk-lib`) vs Python (`*.py`, `requirements.txt` with `aws-cdk-lib`) vs Java/Go/.NET. Note in overview.
- **CDK version**: `aws-cdk-lib` v2 (single package) vs `@aws-cdk/*` v1 (per-service). v1 is EOL — flag.
- **CDK Pipelines** (`pipelines.CodePipeline`): self-mutating delivery. Document trunk → stage → wave structure.
- **Aspects** (`Aspects.of(scope).add(...)`): cross-cutting transforms (tagging, removal-policy enforcement). List every aspect and what it mutates.
- **Custom Resources** (`AwsCustomResource`, `CustomResource` + Lambda): one-off Lambda-backed CFN logic. Document the Lambda, the trigger events (Create/Update/Delete), and idempotency assumptions.
- **Asset bundling**: `lambda.Code.fromAsset(..., { bundling })`, `DockerImageAsset`, `BundlingOptions`. Note bundler image and build command.
- **Context sources**: `cdk.context.json` (cached), `ssm.StringParameter.valueFromLookup` (synth-time lookup, also cached), `ssm.StringParameter.valueForStringParameter` (deploy-time, dynamic). The distinction matters — call it out.
- **Tagging strategy**: `Tags.of(app).add(...)` vs per-stack vs aspects.
- **Environment-agnostic vs env-specific stacks**: stacks without `env:` set are env-agnostic and skip account/region-specific lookups. Note which model is used.
- **Synthesizer**: `DefaultStackSynthesizer` vs `CliCredentialsStackSynthesizer` vs custom (affects bootstrap requirements).

## Common gotchas

- **`cdk.context.json` cached values**: VPC lookups, AMI IDs, AZ lists are cached at first synth. If the underlying AWS state changes, the cache is stale until `cdk context --reset`. Flag every `*.fromLookup` call.
- **Hardcoded account IDs / ARNs**: search for 12-digit numbers and `arn:aws:` literals in stack code. These break cross-environment portability — 🟡 flag.
- **Hardcoded regions**: `region: 'us-east-1'` in code rather than from props/env. Flag.
- **Secrets handling**: CDK code committed to git. Verify secrets come from `SecretsManager.fromSecretNameV2` or `StringParameter.valueForStringParameter` at deploy time, **not** as plaintext props or env vars baked into synth output. 🟡 flag any plaintext secret.
- **Cross-stack references via `CfnOutput` exports**: create tight coupling — the producing stack cannot remove the export until the consumer stops importing it. Document export consumers explicitly so deletes are safe.
- **`removalPolicy: DESTROY` on stateful resources**: dev convenience that becomes data loss in prod. Confirm prod overrides.
- **`autoDeleteObjects: true` on S3 buckets**: same hazard — confirm not enabled in prod.
- **Drift detection limits**: CloudFormation drift detection misses many resource types and nested properties. Note that "synthed = deployed" cannot be assumed; out-of-band changes are invisible until the next deploy diff.
- **Bootstrap version mismatch**: stacks synthesized with a newer CDK can require a newer bootstrap stack in the target account. Note required bootstrap version if pinned.
- **Asset publishing to wrong account**: in multi-account setups the synthesizer publishes Docker/file assets to the bootstrap-defined asset bucket. Verify per-environment bootstrap is correct.
- **`cdk deploy --all` blast radius**: deploys every stack in the app. In multi-env apps without `Stage` separation this can deploy prod accidentally. Note the safe deploy command per environment.
- **Logical ID changes = resource replacement**: renaming a construct or restructuring scope changes CloudFormation logical IDs and triggers replace-on-deploy for stateful resources. Note any `overrideLogicalId` calls used to pin IDs.
- **Generated code in CDK output**: `cdk.out/` is build output — exclude from docs.

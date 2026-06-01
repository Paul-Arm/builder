# Builder

Builder is a Nuxt + SurrealDB starter for an environment graph and deployment control plane across projects, cloud resources, and local hardware.

The first screen models projects, services, deployments, local Mac mini hosts, Docker/OrbStack runtimes, Bash collectors, Terraform resources, Kubernetes targets, shared resources, and the relations between them.

## Stack

- Nuxt 4 / Vue for the app shell
- Nitro server routes for the backend API
- SurrealDB adapter behind `/api/inventory`
- Seed inventory fallback when no database is configured
- Provider plugin model for inventory, deployment lifecycle actions, and later observability

## Run

```bash
npm run setup
npm run dev
```

## SurrealDB

The app uses SurrealDB when `SURREALDB_URL` is set. Local development is wired through Docker Compose and the setup scripts.

```bash
npm run db:up
npm run db:wait
npm run db:reset
npm run db:status
```

The setup script runs the same DB steps automatically and also migrates `.data/projects.json` into the `project_overlay` table.

```bash
npm run setup
```

The initial schema lives in `surreal/schema.surql`. Base inventory is inserted into:

- `entity`
- `relation`
- `deployment`
- `collector`
- `insight`

Manual project edits are stored in `project_overlay`, and UI-saved provider secrets are stored in `provider_secret`. If SurrealDB is unreachable, the app falls back to seed data plus the local `.data` files.

Use a stable `uid` field for graph identities, for example `project:checkout` or `host:mac-mini-01`. The API maps `uid` to the frontend `id` and falls back to the SurrealDB record id when `uid` is missing.

## Codex Environment

In Codex app environment settings, set the Windows setup script to:

```powershell
cd "$env:CODEX_WORKTREE_PATH"
.\scripts\setup.ps1
```

Set the cleanup script to:

```powershell
cd "$env:CODEX_WORKTREE_PATH"
.\scripts\teardown.ps1
```

## Local Agent Direction

Local hardware should report into the same model as cloud resources. A Mac mini with OrbStack becomes:

```text
host -> runtime -> container -> project/service/resource
```

Bash support should be implemented as JSON collector plugins first. Deployment actions such as start, stop, restart, creating environments, or deploying apps should go through a `plan -> approve -> apply -> verify -> audit` workflow.

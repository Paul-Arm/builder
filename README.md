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
npm run dev
```

## SurrealDB

The app uses seed data unless `SURREALDB_URL` is set.

```bash
cp .env.example .env
```

Apply the initial schema from `surreal/schema.surql`, then insert rows into:

- `entity`
- `relation`
- `deployment`
- `collector`
- `insight`

Use a stable `uid` field for graph identities, for example `project:checkout` or `host:mac-mini-01`. The API maps `uid` to the frontend `id` and falls back to the SurrealDB record id when `uid` is missing.

## Local Agent Direction

Local hardware should report into the same model as cloud resources. A Mac mini with OrbStack becomes:

```text
host -> runtime -> container -> project/service/resource
```

Bash support should be implemented as JSON collector plugins first. Deployment actions such as start, stop, restart, creating environments, or deploying apps should go through a `plan -> approve -> apply -> verify -> audit` workflow.

# Builder Agent Notes

## Local Setup

Use the versioned scripts instead of ad hoc setup steps:

```powershell
.\scripts\setup.ps1
npm run dev
```

The setup script copies `.env.example` to `.env` when missing, installs npm dependencies, starts SurrealDB through Docker Compose, applies `surreal/schema.surql`, seeds the base inventory, migrates `.data/projects.json` into the database overlay, and runs `npm run typecheck`.

Use this to tear the local DB container down:

```powershell
.\scripts\teardown.ps1
```

## Codex Environment Fields

For the Codex app environment shown in the UI, use these Windows setup commands:

```powershell
cd "$env:CODEX_WORKTREE_PATH"
.\scripts\setup.ps1
```

Use this cleanup command:

```powershell
cd "$env:CODEX_WORKTREE_PATH"
.\scripts\teardown.ps1
```

For macOS/Linux tabs, use `./scripts/setup.sh` and `./scripts/teardown.sh`.

## Database

SurrealDB is the primary local database when `SURREALDB_URL` is set. Base inventory is stored in the `entity`, `relation`, `deployment`, `collector`, and `insight` tables. Manual project edits are stored in `project_overlay`; provider secrets are stored in `provider_secret`.

If SurrealDB is unreachable, the app falls back to seed inventory plus local `.data` files so the UI stays usable.

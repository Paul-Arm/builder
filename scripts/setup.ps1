$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (!(Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

npm install
npm run db:up
npm run db:wait
npm run db:schema
npm run db:seed
npm run db:migrate-local
npm run typecheck

Write-Host "Builder setup complete. Start the app with: npm run dev"

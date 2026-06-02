#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f ".env" ]; then
  cp ".env.example" ".env"
  echo "Created .env from .env.example"
fi

npm install
npm run stack:up
npm run db:wait
npm run db:schema
npm run db:seed
npm run db:migrate-local
npm run typecheck

echo "Builder setup complete. Start the app with: npm run dev"

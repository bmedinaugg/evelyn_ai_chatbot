# TrainMore Support Chatbot

Customer support chat widget for TrainMore (Dutch + English).
Design: `docs/ARCHITECTURE.md`. Requirements: `docs/PROJECT_BRIEF.md`. API references: `docs/api/`.

## Prerequisites
- Node 26 (`.nvmrc`)
- pnpm 12.18.0 (`npm install -g pnpm@12.18.0`; corepack is not bundled with Node 26)
- Docker (OrbStack or Docker Desktop) and the Supabase CLI (`brew install supabase/tap/supabase`) for database work

## Setup
```sh
pnpm install
cp .env.example .env   # fill in values; never commit .env
```

## Commands
| Command | What it does |
|---|---|
| `pnpm lint` | Biome lint + format check |
| `pnpm format` | Apply Biome fixes |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest in every package |

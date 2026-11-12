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

## CI
GitHub Actions (`.github/workflows/`):
- `ci.yml` → job `check`: lint, typecheck, tests, generated Magicline types up to date, CDK synth.
- `ci.yml` → job `db`: starts Supabase locally and runs the pgTAP tests in `packages/db`.
- `codeql.yml`: CodeQL security analysis (PRs, main, weekly).
- `.github/dependabot.yml`: weekly npm and GitHub Actions updates.

### Repository settings to enable manually (GitHub → Settings)
- Code security: **Secret scanning** with **push protection**, **Dependabot alerts**.
- Branches: protect `main`, require PRs and the status checks `check` and `db`.

## Database (Supabase, local)
Migrations and pgTAP tests live in `packages/db/supabase/`.
```sh
pnpm --filter @trainmore/db db:start   # needs Docker (OrbStack/Docker Desktop)
pnpm --filter @trainmore/db db:reset   # re-apply all migrations
pnpm --filter @trainmore/db test:db    # pgTAP: RLS and privileges
pnpm --filter @trainmore/db db:stop
```
Every table created in `public` gets Row Level Security automatically and no grants for
`anon`/`authenticated`; only the server (service role) accesses data.

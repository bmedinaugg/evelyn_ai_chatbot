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

## Try it locally
`pnpm dev:local` starts the whole chatbot (database, mock Magicline, API, widget and a demo
help-portal page) with one command; see `docs/TESTING.md` for the click-through checklist.

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

## FAQ knowledge base (local)
FAQ articles come from Freshdesk Solutions folders and are stored in Supabase (`faq_articles`).
```sh
pnpm --filter @trainmore/db db:start
# Synthetic bilingual fixtures (APP_ENV=local only; replaces whatever FAQ set is active locally):
sh packages/db/scripts/with-local-env.sh env NODE_ENV=development APP_ENV=local AWS_REGION=eu-west-1 \
  pnpm --filter @trainmore/worker exec tsx src/main.ts seed-faq-fixtures
# Real sync (needs FRESHDESK_DOMAIN, FRESHDESK_API_KEY, FRESHDESK_FAQ_FOLDER_IDS, FRESHDESK_PORTAL_URL):
pnpm --filter @trainmore/worker sync-faq
```
The sync writes nothing if any Freshdesk request or page fails, if a folder or language comes back empty
while we have content for it, or if it would delete articles or drop translations beyond max(5, 30%).
After checking Freshdesk, an intended large change runs with `sync-faq --allow-mass-change`.
`pnpm --filter @trainmore/db test:integration` runs the repository tests against the local stack.
`pnpm --filter @trainmore/db db:types` regenerates `packages/db/src/generated/database.types.ts`.

## Chat API (local)
`apps/api` serves the widget: `POST /widget/conversations`, `POST /widget/conversations/:id/messages`
(bearer conversation token), `POST /widget/leads` (Turnstile + Freshdesk ticket), `GET /health`.
Answers come from Claude Sonnet 5.5 (`CLAUDE_CHAT_MODEL`) with structured output; the server checks
every answer (cited articles must exist, no model-written links, fixed texts for declines and
hand-offs) before it is returned.

```sh
# Needs local Supabase with FAQ fixtures (see above) and the env keys in .env.example.
# Smoke test without Claude spend: CHAT_FAKE_ANSWERER=1 (only honoured with APP_ENV=local).
sh packages/db/scripts/with-local-env.sh env APP_ENV=local CHAT_FAKE_ANSWERER=1 ... pnpm --filter @trainmore/api dev
```
Local Turnstile: use Cloudflare's test secret `1x0000000000000000000000000000000AA` (see `docs/api/turnstile.md`).

## Evals (spend money)
`packages/evals` runs 31 bilingual cases (24 anonymous, 7 logged in as synthetic profiles of the
mock Magicline) against the synthetic FAQ fixtures with the real Claude API, and prints pass/fail,
tokens and an estimated cost (first run 2026-11-12: 30/31, about $0.06 thanks to prompt caching).
It refuses to run unless `APP_ENV=local`, `EVAL_CONFIRM_SPEND=yes` and Magicline is a localhost mock,
and never runs in CI. Needs local Supabase with seeded FAQ fixtures and the mock Magicline running.
```sh
MOCK_MAGICLINE_KEYS=cross:dev-cross,1001:dev-1001,1002:dev-1002 pnpm --filter @trainmore/mock-magicline start &
cd packages/evals && sh ../db/scripts/with-local-env.sh env NODE_ENV=development APP_ENV=local \
  AWS_REGION=eu-west-1 EVAL_CONFIRM_SPEND=yes MAGICLINE_USE_MOCK=true MAGICLINE_BASE_URL=http://localhost:4010 \
  MOCK_MAGICLINE_KEYS=cross:dev-cross,1001:dev-1001,1002:dev-1002 LOG_LEVEL=error \
  node --env-file=../../.env --import tsx src/main.ts   # ANTHROPIC_API_KEY comes from .env
```

## Chat widget (local)
`apps/widget` is the chat shown on the help portal: `loader.js` (added to the Freshdesk portal
layout) opens an iframe with the Preact app, which talks to the API.
```sh
pnpm --filter @trainmore/widget dev          # http://localhost:5173/?lang=nl (needs the API, see above)
pnpm --filter @trainmore/widget build        # dist/: index.html + assets, loader.js, loader.css
pnpm --filter @trainmore/widget e2e          # Playwright (API and Turnstile mocked)
```

**See it embedded like on the help portal:** build the widget, serve it, and open the demo portal page
(a separate origin that loads `loader.js` with the same snippet as the Freshdesk layout):
```sh
cd apps/widget
VITE_API_BASE_URL=http://localhost:8787 VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
  VITE_PRIVACY_URL=https://www.trainmore.nl/privacy pnpm build
pnpm exec vite preview --port 5173 --strictPort &       # widget host (production build, strict CSP)
python3 -m http.server 8090 --bind 127.0.0.1 --directory demo &
open http://127.0.0.1:8090/nl/support/home/            # or /en/support/home/
```
The API must run on port 8787 with `WIDGET_ALLOWED_ORIGINS=http://localhost:5173`.
Embed on the portal (after deploying `dist/` to the widget host):
```html
<script src="https://<widget host>/loader.js" data-widget-url="https://<widget host>/" async></script>
```
The API's `WIDGET_ALLOWED_ORIGINS` must contain the widget host's origin.
First time only: `pnpm --filter @trainmore/widget exec playwright install chromium`.

## Customer login (local)
Visitors log in with a one-time code sent to their email; the server then looks up their Magicline
account(s) with the cross-studio key and binds the chosen account to the conversation.
- Locally (`APP_ENV=local`) codes are printed by the API (`[local outbox] login code …`) instead of emailed.
- Run the mock Magicline server (`pnpm --filter @trainmore/mock-magicline dev`, port 4010) and set
  `MAGICLINE_BASE_URL=http://localhost:4010`, `MAGICLINE_USE_MOCK=true`, `MOCK_MAGICLINE_KEYS=…`,
  `OTP_HMAC_SECRET` (≥ 32 characters).
- Synthetic logins: `member.single@example.com`, `prospect@example.com`, `former@example.com`,
  `multi@example.com` (two clubs).

In AWS, codes go out through Amazon SES (`EMAIL_FROM`, optional `SES_CONFIGURATION_SET`) and the
Magicline keys come from one Secrets Manager secret per environment (`MAGICLINE_KEYS_SECRET_NAME`):
```json
{ "crossStudio": "<cross-studio key>", "studios": { "1001": "<key>", "1002": "<key>" } }
```

## Account answers (M2b)
Once a customer is logged in, Claude can call read-only account tools for the bound account only
(the server injects the customer and studio; tools take no input):

| Tool | Statuses | Data |
|---|---|---|
| `get_memberships` | member, former member | plan, dates, cancellation, notice period, price |
| `get_account_balance` | member, former member | balance, debt collection, reminder level |
| `get_upcoming_payments` | member | next payments |
| `get_recent_visits` | member | visits in the last 30 days |
| `get_class_bookings` | member, prospect | class bookings at their club for the next 7 days |

Switch a tool off: `insert into capability_flags (name, enabled) values ('get_recent_visits', false)`
(the agent portal will do this in M4). Account answers are only shown when a tool ran in that turn.
Local smoke test with the fake answerer: log in, then ask "Welk abonnement heb ik?".

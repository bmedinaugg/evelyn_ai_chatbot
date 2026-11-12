# TrainMore Support Chatbot: Architecture

Status: **agreed design, v1 (2026-11-11)**. Update this file when a design decision changes.
Requirements: `docs/PROJECT_BRIEF.md`. API references: `docs/api/`.

## 0. Decisions

| Topic | Decision | Made by |
|---|---|---|
| Scale | Medium: ~30–150 clubs, ~500–5,000 chats/day | Product owner |
| Compute | AWS ECS Fargate (ARM/Graviton) | Product owner |
| Environments | **Preprod only for now**; production built after preprod is tested and signed off | Product owner |
| Widget host | Freshdesk help portal `https://www.support.trainmore.com` (nl/en) | Product owner |
| Portal auth | Microsoft Entra ID SSO, roles from Entra groups | Product owner |
| Approved answers | Versioned **scenarios in Supabase** (not written back to Freshdesk) | Product owner |
| Daily report | Email | Product owner |
| Account questions | Everything Magicline can answer, as a **capability catalogue** with examples and an on/off switch per capability | Product owner |
| Magicline lookup | Cross-studio customer search; an org-wide key will be requested | Product owner |
| Magicline writes | **Read-only**; changes go through tickets | Product owner |
| Hand-off | **One general ticket form** (plus lead form for sales) | Product owner |
| FAQ sync | **Daily**, plus manual "sync now" | Product owner |
| Chat model | **Claude Sonnet 5.5** (`claude-sonnet-5-5`), configurable via `CLAUDE_CHAT_MODEL` | Product owner (2026-11-11) |
| Answer delivery | **Check, then show**: the full answer is validated before the customer sees it (no token streaming; plain JSON, typing indicator) | Product owner (2026-11-11) |
| Retrieval | **Full-text search first** (Postgres `dutch` + `english`); Voyage embeddings deferred behind a retrieval interface | Product owner (2026-11-11) |
| Hand-off | **Prefilled general ticket form for everyone**; no automatic ticket, no Magicline email lookup | Product owner (2026-11-12) |
| Ticket topics | Membership & contract, Payments & invoices, Club & facilities, App & account as built-in defaults; **synced daily from the Freshdesk ticket field** | Product owner (2026-11-12) |
| Transcript retention | 90 days, then anonymise (M3b) | Product owner (2026-11-12) |
| M1 delivery | Split into M1a (FAQ knowledge base), M1b (answering), M1c (widget); preprod deploy is a separate step once AWS access exists | Architect (2026-11-11) |
| Everything else below | Architect's proposal; open to change | Architect |

## 1. Proven patterns we adopt (Intercom Fin, Zendesk AI)
- **Grounded answers with citations.** The bot only answers from retrieved FAQ articles or
  approved scenarios and links the article in the user's language. If nothing is retrieved,
  it does not answer and offers help instead.
- **Clean hand-off.** When unsure, it offers a person instead of guessing. The ticket carries
  the transcript and minimal account context, so the customer never repeats themselves.
- **Custom answers / procedures.** Approved scenarios outrank generated answers and can be
  conditioned on customer status.
- **Data connectors as tools.** Each Magicline capability is a typed tool with a field allowlist
  and an on/off switch.
- **Simulate before publishing.** Replay a conversation in preprod against a draft answer
  before approving.
- **Content-gap reporting.** Unanswered or low-confidence topics are clustered into the daily report.
- **Metrics.** Resolution rate, escalation rate, thumbs-up/down CSAT, coverage per topic.

## 2. Components

```
support.trainmore.com (Freshdesk portal, nl/en)
  └─ <script> loader ──► iframe  chat.<domain>  (widget, Preact)
                              │ HTTPS + SSE, session token in Authorization header
                     CloudFront + WAF ─► ALB ─► ECS Fargate "api" (Fastify, Node)
                                                 ├─ Claude API (chat model + fast model)
                                                 ├─ Voyage embeddings
                                                 ├─ Supabase Postgres (+ pgvector)
                                                 ├─ AWS Secrets Manager (Magicline keys)
                                                 ├─ Magicline Open API  (mock server in local/preprod)
                                                 ├─ Freshdesk API (tickets, Solutions)
                                                 └─ AWS SES (OTP + daily report email)
  portal.<domain> (React SPA, Entra SSO) ─► same api, /portal routes
  EventBridge Scheduler ─► ECS RunTask "worker": faq-sync (daily), daily-report, retention-purge
```

- **api**: one stateless Fastify service with route groups `/widget`, `/auth`, `/chat`,
  `/forms`, `/portal`. Scales horizontally.
- **worker**: the same container image, different entrypoint, started on a schedule.
- **mock-magicline**: a Fastify server built from `docs/api/magicline-openapi.json`, serving
  synthetic profiles. Runs locally and in preprod.

### Environments (phased)
| Env | When | Magicline | Supabase | Freshdesk |
|---|---|---|---|---|
| local | now | mock server | Supabase CLI (docker) | sandbox or test group |
| **preprod** | **now: only deployed env** | mock server + synthetic profiles | own project | real FAQ sync (public content); tickets tagged `chatbot-preprod` to a test group |
| prod | M6, after preprod sign-off | real, per-club keys | own project | real |

Infrastructure code (CDK) takes an `env` parameter, so adding prod later is a new deploy, not a rewrite.
Prod preferably goes in a separate AWS account.

### Estimated AWS cost (eu-west-1, excluding Claude and Voyage usage; verify in the AWS calculator)
| Item | Preprod (now) | Prod (later) |
|---|---|---|
| Fargate ARM 0.5 vCPU / 1 GB | 1 task ≈ $14 | 2 tasks ≈ $29 |
| ALB | ≈ $19 | ≈ $19–25 |
| Logs, WAF, secrets | ≈ $13 | ≈ $15 |
| Outbound network | public subnet + public IP ≈ $4 (no NAT) | NAT gateway ≈ $35, or keep public subnet |
| **Total** | **≈ $50/month** | **≈ $65–105/month** |

## 3. Key flows

### 3.1 Chat turn (orchestrator in `packages/core`)
1. Validate input (zod), rate-limit per session and per IP.
2. Detect language (nl/en). The reply and UI labels follow the user.
3. Classify the message: on-topic FAQ, account question, sales lead, wants a human, off-topic.
   Off-topic questions are politely declined.
4. Retrieve: Postgres full-text search (`dutch` + `english`, any significant word may match, ranked)
   over whole FAQ articles (bodies capped at 3,000 characters in the prompt) and published
   scenarios. Scenarios rank first. Voyage embeddings can be added later behind the same interface.
5. Call Claude with:
   - system prompt and guardrails
   - retrieved content wrapped and labelled as **untrusted data**
   - capability tools, only for authenticated sessions, only enabled ones, filtered by customer status
6. Validate structured output with zod:
   `{ answer, citations[], confidence, needs_escalation, suggested_form? }`.
   A citation must reference a retrieved document; otherwise the answer is downgraded to escalation.
   Policies, prices and account facts may only come from retrieved content or tool results.
7. Return the validated reply as JSON (the widget shows a typing indicator meanwhile). Store the turn,
   set flags, and log without personal data.
8. Only one turn per conversation is in flight (claimed in the database, expires after 60 s); a second
   concurrent message gets "busy". A conversation allows at most 20 customer messages.
9. Assistant turns are stored verbatim (API content blocks, including thinking blocks) and the
   history sent to Claude is append-only, as Sonnet 5.5's preserved thinking requires.

### 3.2 Authentication (OTP)
1. User enters email. Turnstile check, then rate limit per email and per IP.
2. Server creates a 6-digit code and stores only an HMAC-SHA256 hash.
   - Expires after `OTP_EXPIRY_SECONDS` (300).
   - Single use.
   - Per email: at most 3 codes per 15 minutes, and at most 10 codes or 15 wrong attempts per 24
     hours (stops slow, long-running guessing). Checked under a per-email lock.
   - A new login in the same conversation replaces the earlier account binding (shared devices).
   - Lockout after `OTP_MAX_ATTEMPTS` (5) failures.
   - Sent via SES in the user's language.
3. On success, the server issues an opaque session token (only its hash is stored).
   It has a 30-minute sliding expiry and lives in iframe memory/sessionStorage.
4. Server calls `POST /v1/cross-studio/customers/search` with the email.
   The result is a list of `{ customerId, studioId, status }`.
   All other personal fields are dropped immediately.
5. If there are several matches, the widget shows an **account picker** with club name, status
   and masked customer number. The chosen account is bound to the session **server-side**.
   The LLM never chooses or supplies customer IDs.
6. Account calls use the club's key, fetched by `studioId` from Secrets Manager (5-minute
   in-memory cache). Every tool call is authorised against the session-bound customer.
7. If no customer is found, the user is treated as a verified prospect without account data.

### 3.3 Capability catalogue (Magicline)
Each capability is defined in code (`packages/capabilities`) with:
- id and Magicline endpoint(s) + scope (see `docs/api/magicline.md`)
- allowed customer statuses
- zod schema for the response
- **field allowlist** of what the LLM may see; money is rounded, payment instruments masked
- example questions in NL and EN
- a known-limitations note

The on/off state per environment lives in Supabase `capability_flags`. Admins toggle it in
the portal, and every change is audited.

Initial read-only set:

| Capability | Statuses | Example (EN / NL) |
|---|---|---|
| contract_details | MEMBER, FORMER_MEMBER | "When does my contract end?" / "Wanneer loopt mijn contract af?" |
| cancellation_status | MEMBER | "Is my cancellation processed?" / "Is mijn opzegging verwerkt?" |
| freeze_periods | MEMBER | "Is my membership paused?" / "Staat mijn abonnement op pauze?" |
| account_balance | MEMBER, FORMER_MEMBER | "Do I have an outstanding balance?" / "Heb ik nog een openstaand bedrag?" |
| transactions | MEMBER, FORMER_MEMBER | "When is my next payment?" / "Wanneer is mijn volgende betaling?" |
| dunning_status | MEMBER, FORMER_MEMBER | "Why did I get a payment reminder?" / "Waarom kreeg ik een betalingsherinnering?" |
| payment_method | MEMBER | "How do I pay?" / "Hoe betaal ik?" |
| checkins | MEMBER | "How often did I train last month?" / "Hoe vaak heb ik vorige maand getraind?" |
| class_bookings | MEMBER | "Which classes have I booked?" / "Welke lessen heb ik geboekt?" |
| appointment_bookings | MEMBER, PROSPECT | "When is my intake?" / "Wanneer is mijn intake?" |
| studio_info | all | "What are my club's opening hours?" / "Wat zijn de openingstijden?" |
| membership_offers | PROSPECT, FORMER_MEMBER | "What memberships do you offer?" / "Welke abonnementen hebben jullie?" |

The portal shows a **"What the bot can answer"** page (catalogue, examples, switches) and a
**"Known Magicline limitations"** page (no writes, no invoice endpoint, and so on).

Behaviour per status:
- **PROSPECT**: sales-oriented; lead form available.
- **MEMBER**: full catalogue.
- **FORMER_MEMBER**: balance and history, re-join offers.

### 3.4 FAQ sync (worker, daily at night + manual "sync now")
1. For each folder in `FRESHDESK_FAQ_FOLDER_IDS`, list articles in `nl` and `en`; keep published ones.
2. Compare `updated_at` + content hash. Upsert, chunk and re-embed only what changed.
   Articles no longer in Freshdesk are soft-deleted.
3. Store both language URLs (`/{nl|en}/support/solutions/articles/{id}`).
4. Respect rate-limit headers; back off on 429. The run is logged for the portal.

### 3.5 Forms and escalation (M3a)
- **Lead form** (anonymous, sales questions): email, phone, question, Turnstile → Freshdesk ticket.
- **General ticket form** (the hand-off), nl/en labels. Every hand-off reply carries the action
  `ticket_form`; the widget shows a button that opens the form, plus the contact link
  (`SUPPORT_CONTACT_URL`) as a fallback. The bot never writes links itself.
  - fields: topic (dropdown), email, name (optional), subject, description, consent, Turnstile
  - the email of a code-verified login is prefilled and read-only (widget memory only)
  - subject (first question) and description (all questions) are prefilled and editable
  - after sending: a thank-you message without a ticket number (privacy)
- **API:**
  - `GET /widget/ticket-topics?lang=` returns the active topics with labels (built-in nl/en labels
    for the four defaults, the Freshdesk value otherwise)
  - `POST /widget/conversations/:id/tickets` needs the conversation bearer token, Turnstile and a
    topic from the offered list. It creates the ticket (tags `chatbot`, `escalation`, language),
    then adds a **private note**, then records an `escalations` row. Once the ticket exists the
    request answers 201 even if the note or the record fails (logged), so retries never duplicate it.
  - `type` = the topic, **only for topics synced from Freshdesk**: `type` must be one of the
    ticket type choices (expected validation, **unverified** on our instance), so built-in defaults
    are never sent as `type`. The topic is always in the note.
- **Private note:** the transcript of display texts only (what the customer saw and typed; never
  tool data or API content), last 50 messages, one line each, HTML-escaped. Account context is
  only status and club name, and only when the form email matches the email verified with a code
  in this conversation (compared by HMAC); no customer id or number.
- **Stuck detection:** a second failed reply in a row (`no_match` or `invalid_citation`) in the
  same conversation gets the fixed text `bot.stuck`, the `ticket_form` action and the flag
  `needs_human`. The escalation reason is `stuck` when the last reply failed, otherwise
  `customer_request`.
- Later (optional): forms mirroring individual Freshdesk ticket forms.

### 3.5b Ticket topic sync (worker `sync-ticket-topics`, daily)
- Reads `GET /api/v2/ticket_fields`, takes the choices of `FRESHDESK_TOPIC_FIELD` (default
  `ticket_type`), trims and de-duplicates them, and replaces `ticket_topics` in one transaction.
- Same safety as the FAQ sync: Freshdesk down, the field missing or no choices → nothing changes and
  the job fails (non-zero exit) so the scheduler alerts.
- Until the first successful sync, the API offers the four built-in topics.
- Schedule (EventBridge Scheduler → ECS RunTask, daily at night, next to `sync-faq`): to be added
  with the worker task definition in the CDK app; neither job is scheduled in `infra/` yet.

### 3.6 Improvement loop
1. **Flag** conversations on no retrieval match, low confidence, thumbs-down, or escalation.
2. **Daily report** email (SES) to the agent group: counts and topic clusters of flagged
   questions, with links to the portal.
3. **Review** in the portal, personal data masked by default. An agent writes a **scenario**:
   - trigger examples (NL/EN)
   - answer (NL/EN)
   - optional status conditions, optional linked article
4. **Replay** in preprod: the conversation's user turns are re-run against the draft scenario
   with a **synthetic profile** of the same status and shape. Real customer data never enters preprod.
5. **Judge**: side-by-side view, rule assertions plus an LLM judge.
6. **Approve** (approver role) publishes. Versions are immutable. Rollback re-publishes an
   earlier version. Every action is written to `audit_log` (who, what, when).

Why Supabase scenarios rather than Freshdesk write-back:
- They give us versioning, rollback, status conditions, preprod replay and audit in one place.
- Freshdesk stays the source of public FAQs.
- An optional "publish as article" button can come later.

## 4. Data model (Supabase)
Tables:
- `faq_articles` (whole articles with nl/en tsvectors; FAQs are short, so chunking only if they grow)
- `scenarios`, `scenario_versions`, `capability_flags`
- `conversations`, `messages`, `feedback`, `flags`, `escalations` (conversation id, Freshdesk ticket
  id, topic, reason; no email, name or description), `ticket_topics` (synced Freshdesk choices)
- `otp_challenges`, `sessions`
- `portal_users`, `audit_log`, `sync_runs`

Access:
- **RLS enabled on every table.** Policies deny `anon` and `authenticated`. Only the server
  (service role) reads and writes. The widget never talks to Supabase.
- Enforced in the baseline migration: an event trigger enables RLS on every new `public` table, and
  `postgres` grants nothing to `anon`/`authenticated` by default. Supabase's `supabase_admin` role
  still has default grants that `postgres` cannot change, so pgTAP tests fail if any object in
  `public` is granted to `anon`/`authenticated`. Rule: only create objects through migrations; never
  install extensions into `public` from the dashboard.
- Emails are stored as an HMAC hash where lookup is enough (OTP, sessions, DSAR). Plain emails are
  not stored: ticket forms send them straight to Freshdesk.

Retention (proposal, to confirm with the DPO):
- transcripts 90 days, then anonymised
- OTP challenges purged after 24 hours
- audit log 2 years
- DSAR deletion by email hash

## 5. Security and GDPR
(In addition to the non-negotiable rules in `CLAUDE.md`.)
- **Widget isolation:**
  - the widget runs in an iframe on its own origin
  - CORS restricted to `WIDGET_ALLOWED_ORIGINS`: the widget iframe host's origin (the iframe, not
    the portal page, calls the API)
  - strict CSP; no external fonts or scripts except Cloudflare Turnstile, loaded only with the lead
    form (Google Fonts would send visitor IPs to Google)
  - WAF with managed rules + rate-based rules
- **Client IP behind proxies:** the API trusts `TRUST_PROXY_HOPS` (2 = CloudFront + ALB) only when
  the direct peer is a private VPC address. The ALB security group must accept only CloudFront's
  managed prefix list, otherwise a client could reach the ALB directly and spoof `X-Forwarded-For`.
- **Consent notice** before the first message, with a link to the privacy policy.
- **Logging**: pino with redaction; hashed IDs allowed; no email, phone or name.
- **LLM minimisation**: allowlisted fields only, no names, emails or phone numbers, pseudonymous references.
- **Prompt-injection defence**:
  - delimited untrusted content
  - tools authorised server-side
  - no write tools
  - schema-validated output
  - citation check
  - eval suite with injection attempts (NL/EN)
- **Portal**: Entra OIDC (authorization code + PKCE, `@azure/msal-node`), server-side session
  cookie, roles `agent` / `approver` / `admin` from Entra groups.
- **AWS**:
  - least-privilege task roles (each env reads only its own secrets)
  - encrypted logs
  - Secrets Manager holds per-club Magicline keys (one JSON secret per env to save cost,
    or one secret per club if rotation needs it) plus the cross-studio key
- **GitHub**: secret scanning with push protection, Dependabot, CodeQL, required CI checks.

## 6. Libraries
Versions were checked on the npm registry on 2026-11-11; exact versions are pinned in M0.
Each dependency is confirmed with the product owner when introduced.

| Area | Choice | Why | Alternatives / tradeoff |
|---|---|---|---|
| Runtime | Node 26 (Active LTS since 2026-10-28) | current LTS, Fargate | Node 24 (maintenance since 2026-10-20) |
| Language | TypeScript 6.0.3, strict | required; typescript-eslint supports `<6.1` and openapi-typescript declares `^5.x`, so 7.x waits for the ecosystem | TypeScript 7 (native, faster) once tooling supports it |
| Lint/format | Biome 2.6 | one fast tool, no TypeScript peer dependency | ESLint 10 + typescript-eslint (type-aware rules, needs TS ≤ 6.0) |
| Monorepo | pnpm 12 workspaces + Turborepo 2.11 | strict deps, cached tasks | Nx (heavier) |
| API | Fastify 5.12 + @fastify/rate-limit 11 | mature, fast, schema-first | Hono 4 (lighter, smaller ecosystem) |
| Validation | zod 4.6 | one schema language for API, LLM output, config | valibot (smaller) |
| LLM | @anthropic-ai/sdk 1.8; `claude-sonnet-5-5` for chat, `claude-haiku-5-5` for classify/judge (env-configurable) | tool use, streaming | — |
| Embeddings | **Deferred**: M1 uses Postgres full-text search. Later: Voyage `voyage-4` + pgvector HNSW | no new sub-processor yet | Voyage needs DPA approval and Dutch quality testing |
| Database | @supabase/supabase-js 2.119, Supabase CLI 3.1 (migrations, generated types) | fits fixed stack; RLS in SQL | Drizzle (pre-1.0) |
| HTTP | built-in fetch/undici 8 + openapi-typescript 7.13 types from the Magicline spec | typed, spec-driven, no extra client | ky |
| AWS | @aws-sdk/client-secrets-manager, @aws-sdk/client-sesv2 | official SDK v3 | Resend (another vendor) |
| IaC | AWS CDK 2.276 (TypeScript) | same language as the app | Terraform |
| Widget | Preact 11 + Vite 8, iframe + loader script | tiny bundle, works on the Freshdesk portal | React (~4× larger) |
| Portal | React 19 + Vite SPA | internal tool, no SSR needed | Next.js 16 (extra server) |
| Bot protection | Cloudflare Turnstile | free, usually invisible, privacy-friendly | hCaptcha |
| Logging | pino 10 (redact) | fast, structured | — |
| Testing | vitest 5, msw 3, Playwright 1.65, custom eval runner | fast unit tests, HTTP mocking, widget end-to-end | Jest |
| DB tests | pgTAP via Supabase CLI (`supabase test db`, local Docker) | tests RLS against the real Supabase roles | PGlite (approximation) |

## 7. Folder structure

A **pnpm monorepo**. Widget, portal, api, worker and mock server share one set of types,
schemas and i18n strings. CI runs once with cached tasks.

```
apps/
  api/             Fastify service: widget, auth, chat, forms, portal routes
  worker/          scheduled jobs: faq-sync, daily-report, retention
  widget/          Preact iframe app + loader.js
  portal/          React agent portal
  mock-magicline/  mock server + synthetic profiles (fixtures/*.json)
packages/
  core/            chat orchestrator, guardrails, prompts, retrieval
  capabilities/    Magicline capability catalogue (tools, allowlists, examples)
  magicline/       typed client generated from docs/api/magicline-openapi.json, key resolver
  freshdesk/       typed client: tickets, ticket fields, solutions
  db/              supabase/ migrations, RLS policies, generated types, repositories
  i18n/            nl/en strings for all user-facing text
  shared/          zod schemas, env config loader, logger
  evals/           bilingual question suites per synthetic profile + judge
infra/             CDK app (network, ecs, scheduler, secrets, waf, ses), parameterised by env
docs/              ARCHITECTURE.md, PROJECT_BRIEF.md, api/
.github/workflows/ ci (lint, typecheck, test, evals), deploy-preprod
```

## 8. Milestones
Each milestone ends with tests passing and a preprod deploy.

**M0: Foundations** ✅ done 2026-11-11 (branch `m0-foundations`, plan `docs/superpowers/plans/2026-11-11-m0-foundations.md`)
- monorepo, lint/typecheck, CI, CodeQL, Dependabot
- Supabase baseline migrations with RLS
- config loader, redacting logger, i18n package
- CDK skeleton for preprod
- generated Magicline types, mock server skeleton
- Deviations:
  - TypeScript 6.0.3 and Biome instead of TypeScript 7 (tooling compatibility)
  - Node 26 instead of 24
  - Types generated with `--default-non-nullable false`
  - Database denies `anon`/`authenticated` by both grants and RLS
  - pnpm's supply-chain release-age check stays on: new dependencies must be at least a day old

**M1: FAQ bot (anonymous)**: delivered as M1a/M1b/M1c
- M3a ✅ 2026-11-12: general ticket form (prefilled, synced topics, Turnstile), Freshdesk ticket + private transcript note, `escalations` record, stuck detection, daily `sync-ticket-topics` worker job.
- M2b ✅ 2026-11-12: account answers via read-only Claude tools for the bound account (memberships, balance, upcoming payments, recent visits, class bookings), status gating, `capability_flags`, tool steps stored append-only, logged-in eval cases. Paid eval run pending.
- M2a ✅ 2026-11-12: login with emailed one-time code (hashed, single use, 5 attempts, 3 codes per email per 15 min, no enumeration), cross-studio account lookup, server-side account binding with picker, SES and Secrets Manager adapters, widget login screens.
- M1c ✅ 2026-11-11: Preact widget in an iframe (consent, answers with sources, hand-off link, lead form with Turnstile), `loader.js` for the help portal, TrainMore branding without external fonts, Playwright e2e.
- M1b ✅ 2026-11-11: conversations (append-only, one turn in flight), Sonnet 5.5 answering with structured output and check-then-show guardrails, widget API, lead form (Turnstile → Freshdesk), bilingual evals (first paid run pending).
- M1a ✅ 2026-11-11: Freshdesk client, FAQ sync (safe deletes), `faq_articles` + nl/en full-text `search_faq`, synthetic fixtures. Live Freshdesk Solutions check still open (needs credentials).
- daily FAQ sync, hybrid retrieval
- orchestrator with guardrails, SSE
- widget with consent notice, language detection, citations with NL/EN URLs
- lead form → ticket, Turnstile
- bilingual evals

**M2: Authentication + account answers**
- OTP, cross-studio lookup, account picker, per-club key resolver
- read-only capability catalogue with flags, behaviour per status
- synthetic profiles: each status, multiple accounts, expired contract, debt/dunning, frozen,
  cancelled, no bookings

**M3: Escalation (MVP complete, in preprod)**
- general ticket form, auto-escalation with transcript
- thumbs feedback, flagging
- retention job, DSAR deletion
- WAF, load test

**M4: Agent portal**
- Entra SSO and roles
- review of flagged conversations
- scenarios with versioning, audit and rollback
- preprod replay
- capability toggles, limitations page

**M5: Daily report + analytics**
- SES digest with topic clustering
- metrics (resolution, escalation, CSAT)

**M6: Production go-live** (after preprod sign-off)
- prod environment from the same CDK
- real Magicline keys, prod Supabase
- script tag on support.trainmore.com
- pen test

**M7: Later / optional**
- per-Freshdesk-form widgets
- Magicline write capabilities (behind flags and explicit customer confirmation)
- Magicline webhooks for cache invalidation
- "publish scenario as Freshdesk article"

## 9. Testing strategy
- Unit tests per module (vitest). HTTP is mocked with msw against the spec-generated types.
- Mock Magicline server with synthetic profiles. **Never real customer data.**
- Eval suite (`packages/evals`): realistic NL and EN questions per profile, covering:
  - expected facts and citations
  - forbidden content (other customers' data, invented prices)
  - off-topic refusal
  - prompt-injection attempts
- Runs in CI (a subset) and nightly in preprod (full). The same harness powers portal replay.
- Playwright end-to-end tests for the widget: consent, OTP, account picker, forms.

## 10. Open items (★ = blocks a milestone)
- ★ (M2) Cross-studio / org-wide Magicline key: which tenant/key unlocks
  `/v1/cross-studio/customers/search`, its scopes, and whether email matching is exact.
- ★ (M1) Freshdesk FAQ folder IDs and plan (sets rate limits). Verify the Solutions endpoints and
  `nl`/`en` language codes on our instance (see `docs/api/freshdesk.md`).
- ★ (M1) Permission to add a script tag and CSP changes in the Freshdesk portal layout.
- (M1) Approve Voyage AI as a sub-processor, or start with full-text-only retrieval.
- (M3) Retention periods and consent text with the DPO.
- (M3) Confirm with support which Freshdesk field holds the topics (`FRESHDESK_TOPIC_FIELD`,
  default `ticket_type`) and its values; until the first sync, tickets carry no `type`.
- (M3) Add the EventBridge schedules for `sync-faq` and `sync-ticket-topics` to the CDK app.
- (M4) Entra app registration and group names.
- Exact club count and expected volume (brief still says [X]).

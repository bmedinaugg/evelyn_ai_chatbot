# M0 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working pnpm monorepo with these pieces in place:
- shared config, logging and i18n
- typed Magicline types and client
- a mock Magicline server
- a Supabase baseline with enforced RLS
- a CDK foundation for preprod
- CI

Everything is tested. There are no product features yet.

**Architecture:**
- **Packages:** internal packages export TypeScript source (no build step in M0). Apps run with `tsx`.
- **Tasks:** Turborepo runs `typecheck` and `test` per package. Biome lints and formats from the root.
- **Database:** tested with pgTAP through the Supabase CLI (local Docker stack).
- **Infra:** tested with `aws-cdk-lib/assertions`, without an AWS account.

**Tech Stack:**
- Node 26 (Active LTS), pnpm 12.18.0, TypeScript 6.0.3, Turborepo 2.11, Vitest 5.1, Biome 2.6
- zod 4.6, pino 10.4, Fastify 5.12, openapi-typescript 7.13, tsx 4.23
- AWS CDK 2.276 / aws-cdk CLI 2.1148, Supabase CLI 3.x

**Spec:** `docs/ARCHITECTURE.md` (§6 libraries, §7 folder structure, §8 M0, §5 security), `docs/api/magicline.md`, `CLAUDE.md`.

## Global Constraints
- **Language and modules:**
  - TypeScript `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `erasableSyntaxOnly`.
  - No `any` without a comment explaining why.
  - ESM only (`"type": "module"`, `module`/`moduleResolution: "nodenext"`).
- **Package names:** `@trainmore/<name>`. Workspace deps use `"workspace:*"`.
- **Dependencies:**
  - Exact pinned versions (no `^`).
  - Only the dependencies approved on 2026-11-11 may be added; anything else needs the user's OK.
- **Validation and config:**
  - Validate all external input (env, HTTP requests, API responses) with zod.
  - Configuration comes only from env vars, documented in `.env.example`.
- **Logs:** no email, phone or name in log output.
- **Text:** every user-facing string exists in `nl` and `en`.
- **Test data:** only synthetic profiles on `@example.com`. Never real customer data.
- **Git:**
  - Commits go on branch `m0-foundations`, one per task.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Done means:** `pnpm lint && pnpm typecheck && pnpm test` pass at the end of every task.

## Review Focus
1. **Env booleans written as strings.** `MAGICLINE_USE_MOCK="false"` must parse as `false`, because `z.coerce.boolean("false")` returns `true`. Values like `"yes"` must be rejected. (Task 3)
2. **PII in logs.** Personal data nested inside objects or arrays, written with different key casing (`Email`, `phonePrivateMobile`), or embedded in an error message must never reach log output. (Task 4)
3. **Email lookup variants.** `" Jan@Example.com "` must find the same customer as `jan@example.com`. (Tasks 6 and 7)
4. **Magicline response drift.** Extra PII fields in a response must never pass through the client. An unknown `status` value must fail loudly, not pass silently. (Task 6)
5. **Cross-club isolation in the mock.** A studio key used to read a customer from another studio must get 404, like the real per-studio isolation. (Task 7)

---

### Task 0: Prerequisites (user + agent)

- [ ] **Step 1 (user):** Install OrbStack (`brew install orbstack`) or Docker Desktop. Then run `brew install supabase/tap/supabase`.
- [ ] **Step 2 (agent):** Run `npm install -g pnpm@12.18.0`. Corepack no longer ships with Node 26.
- [ ] **Step 3:** Run `node -v && pnpm -v && docker info --format '{{.ServerVersion}}' && supabase --version`.
  Expected: `v26.x`, `12.18.0`, a version, `3.x`.

### Task 1: Baseline commit and branch

- [ ] **Step 1:** Commit the existing docs on `main`:
  - files: `CLAUDE.md`, `.env.example`, `docs/`
  - message: `docs: project brief, architecture and API references`
- [ ] **Step 2:** Run `git checkout -b m0-foundations`.

### Task 2: Monorepo scaffold and tooling

**Files:**
- Create:
  - root config: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`
  - repo housekeeping: `.nvmrc`, `.gitignore`, `.editorconfig`
  - `README.md` (dev setup)
- Modify: `docs/ARCHITECTURE.md` §6:
  - Node 24 → **Node 26 (Active LTS since 2026-10-28)**
  - TypeScript 7 → **6.0.3**: typescript-eslint supports `<6.1`, and openapi-typescript declares `^5.x`. Revisit when they support 7.
  - add Biome 2.6 for lint and format
  - add pgTAP via Supabase CLI for database tests

**Interfaces:**
- **Produces:**
  - root scripts `lint` (`biome check .`), `format` (`biome check --write .`), `typecheck` (`turbo run typecheck`), `test` (`turbo run test`)
  - each workspace package must define `typecheck: "tsc --noEmit"` and `test: "vitest run"`
  - `tsconfig.base.json`, which every package extends

- [ ] **Step 1:** Write the root `package.json`:
  - `"private": true`, `"type": "module"`
  - `"packageManager": "pnpm@12.18.0"`, `"engines": { "node": ">=26.0.0" }`
  - exact devDeps: `typescript@6.0.3`, `turbo@2.11.11`, `vitest@5.1.0`, `@biomejs/biome@2.6.7`, `tsx@4.23.15`, `@types/node@26.6.6`
- [ ] **Step 2:** Write `pnpm-workspace.yaml` with packages `apps/*`, `packages/*` and `infra`.
- [ ] **Step 3:** Write `tsconfig.base.json`:
  - the strict flags from Global Constraints
  - `target: "es2024"`, `verbatimModuleSyntax: true`, `skipLibCheck: true`, `noEmit: true`
- [ ] **Step 4:** Write `turbo.json` with tasks `typecheck` and `test`, both `dependsOn: ["^typecheck"]`, with no outputs.
- [ ] **Step 5:** Write `biome.json`:
  - recommended rules
  - formatter: 2-space indent, line width 100
  - ignore `**/generated/**`, `infra/cdk.out`, `node_modules`
- [ ] **Step 6:** Write `.nvmrc` (`26`) and `.gitignore` (`node_modules`, `.env`, `.env.*` with `!.env.example`, `cdk.out`, `.turbo`, `coverage`, `supabase/.temp`).
- [ ] **Step 7:** Run `pnpm install && pnpm lint && pnpm typecheck && pnpm test`.
  Expected: all exit 0 (turbo reports 0 tasks).
- [ ] **Step 8:** Commit with message `chore: monorepo scaffold (pnpm, turbo, typescript, biome, vitest)`.

### Task 3: Config loader (`packages/shared`)

**Files:**
- Create:
  - `packages/shared/package.json`, `tsconfig.json`, `vitest.config.ts`
  - `src/config.ts`, `src/index.ts`
- Test: `packages/shared/test/config.test.ts`

**Interfaces:**
- **Produces:**
  - `loadConfig(env?: Record<string, string | undefined>): Config` (defaults to `process.env`)
  - `class ConfigError extends Error { readonly issues: string[] }`
  - `type Config` as follows:
    ```ts
    type Config = {
      nodeEnv: 'development' | 'test' | 'production';
      appEnv: 'local' | 'preprod' | 'prod';
      awsRegion: string;
      logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
      magicline: { baseUrl: string; useMock: boolean };
    }
    ```
- Later milestones add sections to `Config` and their keys to `.env.example`.

- [ ] **Step 1: Write the failing tests**
```ts
const base = { NODE_ENV: 'test', APP_ENV: 'local', AWS_REGION: 'eu-west-1',
  MAGICLINE_BASE_URL: 'http://localhost:4010', MAGICLINE_USE_MOCK: 'true' };

it('parses a valid env', () => {
  expect(loadConfig(base)).toEqual({ nodeEnv: 'test', appEnv: 'local', awsRegion: 'eu-west-1',
    logLevel: 'info', magicline: { baseUrl: 'http://localhost:4010', useMock: true } });
});
it('parses "false" and "0" as false', () => {
  expect(loadConfig({ ...base, APP_ENV: 'prod', MAGICLINE_USE_MOCK: 'false' }).magicline.useMock).toBe(false);
  expect(loadConfig({ ...base, APP_ENV: 'prod', MAGICLINE_USE_MOCK: '0' }).magicline.useMock).toBe(false);
});
it('rejects a non-boolean string', () => {
  expect(() => loadConfig({ ...base, MAGICLINE_USE_MOCK: 'yes' })).toThrow(ConfigError);
});
it('requires the mock outside prod', () => {
  expect(() => loadConfig({ ...base, APP_ENV: 'preprod', MAGICLINE_USE_MOCK: 'false' }))
    .toThrow(/MAGICLINE_USE_MOCK must be true/);
});
it('forbids the mock in prod', () => {
  expect(() => loadConfig({ ...base, APP_ENV: 'prod' })).toThrow(/MAGICLINE_USE_MOCK must be false/);
});
it('names missing keys without echoing values', () => {
  const { MAGICLINE_BASE_URL, ...rest } = base;
  const err = (() => { try { loadConfig({ ...rest, AWS_REGION: 'secret-ish-value' }); } catch (e) { return e as ConfigError; } })();
  expect(err?.message).toContain('MAGICLINE_BASE_URL');
  expect(err?.message).not.toContain('secret-ish-value');
});
```
- [ ] **Step 2:** Run `pnpm --filter @trainmore/shared test`.
  Expected: FAIL (cannot resolve `../src/config`).
- [ ] **Step 3:** Implement `loadConfig`:
  - Boolean parser: `z.enum(['true','false','1','0']).transform(v => v === 'true' || v === '1')`.
  - Cross-field rule (mock required unless `appEnv === 'prod'`, forbidden in prod) goes in `superRefine`.
  - `ConfigError.issues` lists `KEY: reason` and never includes the received value.
  - Add the deps `zod@4.6.7` and `@types/node`.
- [ ] **Step 4:** Run the same command. Expected: 6 passed.
- [ ] **Step 5:** Add `LOG_LEVEL=info` and `APP_ENV` to `.env.example`, then commit with message `feat(shared): validated env config loader`.

### Task 4: Redacting logger (`packages/shared`)

**Files:**
- Create: `packages/shared/src/logger.ts`, `packages/shared/src/redact.ts`
- Test: `packages/shared/test/logger.test.ts`

**Interfaces:**
- **Produces:**
  - `createLogger(opts: { name: string; level: Config['logLevel']; destination?: pino.DestinationStream }): pino.Logger`
  - `redactDeep(value: unknown): unknown`
  - `scrubText(text: string): string` replaces email addresses and phone-like digit runs (≥ 9 digits, allowing spaces, dashes, `+`) with `[redacted]`
  - `PII_KEYS: ReadonlySet<string>` (lower-case) containing:
    `email`, `phone`, `name`, `firstname`, `lastname`, `secondfirstname`, `secondlastname`, `phoneprivate`, `phoneprivatemobile`, `phonebusiness`, `phonebusinessmobile`, `street`, `housenumber`, `zipcode`, `city`, `dateofbirth`, `bankaccount`, `iban`, `password`, `otp`, `code`, `token`, `authorization`, `x-api-key`, `apikey`

- [ ] **Step 1: Write the failing tests.** Each test logs into an in-memory stream and inspects the collected output string `out`.
```ts
it('redacts PII keys at any depth, in arrays, case-insensitively', () => {
  log.info({ customer: { Email: 'jan@example.com', contracts: [{ phonePrivateMobile: '+31 6 12345678' }] } }, 'lookup');
  expect(out).not.toContain('jan@example.com');
  expect(out).not.toContain('12345678');
  expect(out).toContain('[redacted]');
});
it('scrubs emails and phone numbers inside error messages', () => {
  log.error({ err: new Error('no customer for jan@example.com / 0612345678') }, 'failed');
  expect(out).not.toContain('jan@example.com');
  expect(out).not.toContain('0612345678');
});
it('keeps non-PII fields', () => {
  log.info({ studioId: 1001, status: 'MEMBER' }, 'ok');
  expect(JSON.parse(out)).toMatchObject({ studioId: 1001, status: 'MEMBER', msg: 'ok', name: 'test' });
});
it('scrubText leaves short numbers alone', () => {
  expect(scrubText('studio 1001 has 25 classes')).toBe('studio 1001 has 25 classes');
});
```
- [ ] **Step 2:** Run `pnpm --filter @trainmore/shared test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement:
  - pino `formatters.log` calls `redactDeep`, which replaces values under `PII_KEYS` and runs `scrubText` on all strings.
  - The `err` serializer is `pino.stdSerializers.err` followed by `redactDeep`.
  - Message strings also go through `scrubText` (`hooks.logMethod`).
  - Add the dep `pino@10.4.0`.
- [ ] **Step 4:** Run the tests. Expected: all pass.
- [ ] **Step 5:** Commit with message `feat(shared): pino logger with deep PII redaction`.

### Task 5: i18n package (`packages/i18n`)

**Files:**
- Create:
  - `packages/i18n/package.json`, `tsconfig.json`, `vitest.config.ts`
  - `src/en.ts`, `src/nl.ts`, `src/index.ts`
- Test: `packages/i18n/test/i18n.test.ts`

**Interfaces:**
- **Produces:**
  - `type Lang = 'nl' | 'en'`
  - `type MessageKey` (dot-path union of the keys in `en`)
  - `t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string`
  - `isLang(v: unknown): v is Lang`
- `nl.ts` is declared `satisfies Messages`, where `type Messages = typeof en`. That makes key parity a compile error.

- [ ] **Step 1:** Seed the copy in `en.ts` and `nl.ts`:
  - `common.error.generic`
    - en: "Something went wrong. Please try again."
    - nl: "Er ging iets mis. Probeer het opnieuw."
  - `common.greeting`
    - en: "Hi {name}!"
    - nl: "Hoi {name}!"
- [ ] **Step 2: Write the failing tests.**
```ts
it('has identical key sets in nl and en', () => expect(flatKeys(nl)).toEqual(flatKeys(en)));
it('has no empty strings', () => expect([...flatValues(nl), ...flatValues(en)].every(v => v.trim() !== '')).toBe(true));
it('translates', () => expect(t('nl', 'common.error.generic')).toBe('Er ging iets mis. Probeer het opnieuw.'));
it('interpolates', () => expect(t('en', 'common.greeting', { name: 'Sam' })).toBe('Hi Sam!'));
it('throws on a missing param', () => expect(() => t('en', 'common.greeting')).toThrow(/name/));
```
- [ ] **Step 3:** Run `pnpm --filter @trainmore/i18n test`. Expected: FAIL.
- [ ] **Step 4:** Implement `t`, `isLang`, and the test helpers `flatKeys`/`flatValues` (in `test/`).
- [ ] **Step 5:** Run the tests and typecheck. Expected: all pass.
- [ ] **Step 6:** Commit with message `feat(i18n): typed nl/en messages with parity check`.

### Task 6: Magicline types and client (`packages/magicline`)

**Files:**
- Create:
  - `packages/magicline/package.json`, `tsconfig.json`, `vitest.config.ts`
  - `src/generated/schema.d.ts` (generated)
  - `src/client.ts`, `src/errors.ts`, `src/schemas.ts`, `src/index.ts`
- Test: `packages/magicline/test/client.test.ts`

**Interfaces:**
- **Consumes:** `docs/api/magicline-openapi.json`.
- **Produces:**
  - `generate` script: `openapi-typescript ../../docs/api/magicline-openapi.json -o src/generated/schema.d.ts`
  - re-exported `paths` and `components` types
  - `type CustomerStatus = 'MEMBER' | 'PROSPECT' | 'FORMER_MEMBER'`
  - `type CustomerLookup = { customerId: number; studioId: number; status: CustomerStatus }`
  - `createMagiclineClient(opts: { baseUrl: string; apiKey: string; fetch?: typeof fetch }): MagiclineClient`
  - `interface MagiclineClient { searchCustomersCrossStudio(email: string): Promise<CustomerLookup[]> }`
  - error classes:
    - `MagiclineError` with `status: number`
    - `MagiclineRateLimitError extends MagiclineError` with `retryAfterSeconds: number | undefined`
    - `MagiclineResponseError extends MagiclineError` (schema mismatch; message has no payload)
- **Contract:** `POST {baseUrl}/v1/cross-studio/customers/search`
  - header `X-API-KEY`
  - body typed as `paths['/v1/cross-studio/customers/search']['post']['requestBody']['content']['application/json']`
  - The email is trimmed and lower-cased before sending.

- [ ] **Step 1:** Add `openapi-typescript@7.13.0` (dev), run `pnpm --filter @trainmore/magicline generate`, and confirm the file contains `"/v1/cross-studio/customers/search"`.
  - If it fails under TypeScript 6, stop and report (do not swap versions silently).
- [ ] **Step 2: Write the failing tests.** Use a fake `fetch` that records the request and returns a canned `Response`.
```ts
it('normalises the email and sends the API key', async () => {
  await client.searchCustomersCrossStudio('  Jan@Example.com ');
  expect(req.url).toBe('http://mock/v1/cross-studio/customers/search');
  expect(req.headers.get('X-API-KEY')).toBe('k');
  expect(await req.json()).toEqual({ email: 'jan@example.com' });
});
it('returns only id, studio and status, dropping other PII fields', async () => {
  respond(200, [{ id: 1, studioId: 1001, status: 'MEMBER', email: 'jan@example.com', firstName: 'Jan', street: 'x' }]);
  expect(await client.searchCustomersCrossStudio('jan@example.com'))
    .toEqual([{ customerId: 1, studioId: 1001, status: 'MEMBER' }]);
});
it('rejects an unknown status', async () => {
  respond(200, [{ id: 1, studioId: 1001, status: 'VIP' }]);
  await expect(client.searchCustomersCrossStudio('a@example.com')).rejects.toBeInstanceOf(MagiclineResponseError);
});
it('maps 429 to a rate-limit error with retry-after', async () => {
  respond(429, {}, { 'x-ratelimit-reset': '12' });
  await expect(client.searchCustomersCrossStudio('a@example.com')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 12 });
});
it('maps other non-2xx to MagiclineError without leaking the body', async () => {
  respond(500, { message: 'boom jan@example.com' });
  const e = await client.searchCustomersCrossStudio('a@example.com').catch(x => x);
  expect(e).toBeInstanceOf(MagiclineError);
  expect(String(e.message)).not.toContain('jan@example.com');
});
it('rejects an empty email before calling the API', async () => {
  await expect(client.searchCustomersCrossStudio('  ')).rejects.toThrow();
  expect(calls).toBe(0);
});
```
- [ ] **Step 3:** Run `pnpm --filter @trainmore/magicline test`. Expected: FAIL.
- [ ] **Step 4:** Implement:
  - zod `customerLookupSchema` validates `id`, `studioId`, `status`, ignores and strips everything else, and maps `id → customerId`.
  - Email input is validated with `z.string().trim().toLowerCase().email()`.
  - Errors carry `status` and the endpoint path only.
- [ ] **Step 5:** Run the tests and typecheck. Expected: all pass.
- [ ] **Step 6:** Commit with message `feat(magicline): generated API types and cross-studio customer search client`.

### Task 7: Mock Magicline server (`apps/mock-magicline`)

**Files:**
- Create:
  - `apps/mock-magicline/package.json`, `tsconfig.json`, `vitest.config.ts`
  - `src/server.ts`, `src/main.ts`, `fixtures/profiles.ts`
- Test:
  - `apps/mock-magicline/test/server.test.ts`
  - `apps/mock-magicline/test/client-integration.test.ts`

**Interfaces:**
- **Consumes:**
  - the `components['schemas']['Customer']` type and `createMagiclineClient` (Task 6)
  - `createLogger` (Task 4)
  - `main.ts` validates its own env (`PORT`, `MOCK_MAGICLINE_KEYS`, `LOG_LEVEL`) with a small zod schema, because the mock doesn't need the app's `Config`.
- **Produces:**
  - `buildMockServer(opts: { keys: MockKeys; profiles: components['schemas']['Customer'][] }): FastifyInstance`
  - `type MockKeys = { crossStudio: string; studios: Record<number, string> }`
  - `parseMockKeys(raw: string): MockKeys`
    - format: `cross:<key>,<studioId>:<key>,...`
    - read from env `MOCK_MAGICLINE_KEYS` (add to `.env.example` with mock-only placeholder values)
  - `main.ts` listens on `PORT` (default 4010).
- **Routes:**
  - `POST /v1/cross-studio/customers/search`: needs the cross-studio key. The body is validated with zod (`email` required). Email matching is case-insensitive and exact (an assumption; real behaviour unverified, see `docs/api/magicline.md`).
  - `GET /v1/customers/:customerId`: needs the key of the customer's own studio. Any other key returns 404.
  - A missing or unknown `X-API-KEY` returns 401 on every route.
- **Fixtures** (synthetic, `@example.com`):
  - `member.single@example.com`: MEMBER, studio 1001
  - `prospect@example.com`: PROSPECT, studio 1001
  - `former@example.com`: FORMER_MEMBER, studio 1002
  - `multi@example.com`: MEMBER at 1001 and MEMBER at 1002

- [ ] **Step 1:** Add the dep `fastify@5.12.8`.
- [ ] **Step 2: Write the failing tests** (using `server.inject`).
```ts
it('401 without a key', ...)                 // POST search, no header → 401
it('finds a customer case-insensitively', ...) // email 'MULTI@example.com' → 2 customers, studios [1001, 1002]
it('rejects a studio key on cross-studio search', ...) // key for 1001 → 401
it('400 on a body without email', ...)
it('studio key reads its own customer', ...)  // key 1001, member.single id → 200
it('studio key cannot read another studio’s customer', ...) // key 1001, former (1002) → 404
it('parseMockKeys parses and rejects malformed input', ...) // 'cross:a,1001:b' ok; '1001' throws
```
  Integration test: start the server with `listen({ port: 0 })`, then `createMagiclineClient({ baseUrl, apiKey: crossKey }).searchCustomersCrossStudio(' Multi@Example.com ')` must return 2 `CustomerLookup` items.
- [ ] **Step 3:** Run `pnpm --filter @trainmore/mock-magicline test`. Expected: FAIL.
- [ ] **Step 4:** Implement the server and fixtures. Add a `dev` script: `tsx watch src/main.ts`.
- [ ] **Step 5:** Run the tests. Expected: all pass. Then run `MOCK_MAGICLINE_KEYS='cross:dev-cross,1001:dev-1001' pnpm --filter @trainmore/mock-magicline dev` and check that `curl -s -XPOST localhost:4010/v1/cross-studio/customers/search -H 'X-API-KEY: dev-cross' -H 'content-type: application/json' -d '{"email":"prospect@example.com"}'` returns 1 item.
- [ ] **Step 6:** Commit with message `feat(mock-magicline): mock server with synthetic profiles and studio isolation`.

### Task 8: Supabase baseline with enforced RLS (`packages/db`)

**Files:**
- Create:
  - `packages/db/package.json` (scripts: `db:start`, `db:reset`, `test:db`)
  - `packages/db/supabase/config.toml` (from `supabase init`, run inside `packages/db`)
  - `packages/db/supabase/migrations/20261111000000_baseline.sql`
- Test: `packages/db/supabase/tests/baseline.test.sql` (pgTAP)

**Interfaces:**
- **Produces:**
  - The convention that every table lives in `public` and gets RLS automatically.
  - Schema `private` for helper functions.
  - Table `public.audit_log`:
    - `id bigint generated always as identity primary key`
    - `occurred_at timestamptz not null default now()`
    - `actor text not null`, `action text not null`
    - `entity_type text`, `entity_id text`
    - `details jsonb not null default '{}'`
  - Later milestones add tables in new migrations.

- [ ] **Step 1: Write the failing pgTAP tests**
```sql
begin; select plan(5);
select is((select count(*)::int from pg_extension where extname = 'vector'), 1, 'pgvector installed');
select is((select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0, 'every public table has RLS');
create table public.rls_probe (id int);
select ok((select rowsecurity from pg_tables where schemaname='public' and tablename='rls_probe'), 'new tables get RLS automatically');
set local role anon;
select is_empty('select * from public.audit_log', 'anon sees nothing in audit_log');
reset role; set local role authenticated;
select throws_ok('insert into public.audit_log(actor, action) values (''x'', ''y'')', '42501', null, 'authenticated cannot write audit_log');
select * from finish(); rollback;
```
- [ ] **Step 2:** Run `pnpm --filter @trainmore/db db:start && pnpm --filter @trainmore/db test:db` (`supabase test db`). Expected: FAIL.
- [ ] **Step 3:** Write the migration:
  - `create extension if not exists vector with schema extensions`
  - `create schema private`
  - Event trigger function `private.enable_rls_on_create()`, `security definer`, on `ddl_command_end` for `CREATE TABLE` in schema `public`. It runs `alter table … enable row level security`.
  - `revoke all on all tables in schema public from anon, authenticated`
  - `alter default privileges in schema public revoke all on tables from anon, authenticated`
  - the `audit_log` table
- [ ] **Step 4:** Run `pnpm --filter @trainmore/db db:reset && pnpm --filter @trainmore/db test:db`. Expected: `ok 1..5`, all pass.
- [ ] **Step 5:** Commit with message `feat(db): supabase baseline with pgvector, auto-RLS and audit_log`.

### Task 9: CDK foundation stack (`infra`)

**Files:**
- Create:
  - `infra/package.json`, `infra/tsconfig.json`, `infra/vitest.config.ts`
  - `infra/cdk.json` (`"app": "tsx bin/app.ts"`)
  - `infra/bin/app.ts`, `infra/lib/foundation-stack.ts`
- Test: `infra/test/foundation-stack.test.ts`

**Interfaces:**
- **Produces:**
  - `class FoundationStack extends Stack` with props `{ envName: 'preprod' | 'prod' }`
  - public readonly `vpc`, `cluster`, `repository`, `logGroup`, `magiclineStudioKeys`, `magiclineCrossStudioKey`
  - `bin/app.ts` instantiates **only** `TrainmoreChatbot-preprod`. Prod is not deployed until M6.
- **Resources:**
  - VPC: 2 AZs, public subnets only, `natGateways: 0`
  - ECS cluster
  - ECR repo `trainmore-chatbot-<env>` (immutable tags, scan on push)
  - KMS key with rotation enabled
  - log group `/trainmore-chatbot/<env>`: KMS-encrypted, 30-day retention
  - secrets `trainmore-chatbot/<env>/magicline-studio-keys` and `trainmore-chatbot/<env>/magicline-cross-studio-key`: created empty, values set manually
  - tags `project=trainmore-chatbot`, `env=<env>`

- [ ] **Step 1:** Add the deps `aws-cdk-lib@2.276.0`, `constructs@10.8.1`, and `aws-cdk@2.1148.1` (dev).
- [ ] **Step 2: Write the failing tests** (`Template.fromStack(new FoundationStack(app, 'T', { envName: 'preprod' }))`).
```ts
it('has no NAT gateway', () => template.resourceCountIs('AWS::EC2::NatGateway', 0));
it('encrypts logs with KMS, 30-day retention', () =>
  template.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: '/trainmore-chatbot/preprod', RetentionInDays: 30, KmsKeyId: Match.anyValue() }));
it('creates the Magicline secrets per env', () => {
  template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'trainmore-chatbot/preprod/magicline-studio-keys' });
  template.hasResourceProperties('AWS::SecretsManager::Secret', { Name: 'trainmore-chatbot/preprod/magicline-cross-studio-key' });
});
it('ECR repo has immutable tags and scan on push', () =>
  template.hasResourceProperties('AWS::ECR::Repository', { ImageTagMutability: 'IMMUTABLE', ImageScanningConfiguration: { ScanOnPush: true } }));
it('KMS key rotation is on', () => template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true }));
```
- [ ] **Step 3:** Run `pnpm --filter @trainmore/infra test`. Expected: FAIL.
- [ ] **Step 4:** Implement the stack. The KMS key policy must allow `logs.<region>.amazonaws.com` to use it.
- [ ] **Step 5:** Run the tests, then `pnpm --filter @trainmore/infra exec cdk synth --quiet`. Expected: pass, and synth exits 0 without AWS credentials.
- [ ] **Step 6:** Commit with message `feat(infra): CDK foundation stack for preprod`.

### Task 10: CI, CodeQL, Dependabot

**Files:**
- Create:
  - `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`
- Modify: `README.md` (CI section and the manual repo settings)

- [ ] **Step 1:** Look up the current major version of each action before writing:
  - `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `supabase/setup-cli`, `github/codeql-action`
  - command: `curl -s https://api.github.com/repos/<owner>/<repo>/releases/latest | jq -r .tag_name`
  - pin to those majors
- [ ] **Step 2:** Write `ci.yml`. It runs on PRs and on pushes to `main`, with `permissions: contents: read`.
  - **Job `check`:**
    - checkout, pnpm, and node from `.nvmrc` with pnpm cache
    - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
    - `pnpm --filter @trainmore/magicline generate && git diff --exit-code` (generated types are up to date)
    - `pnpm --filter @trainmore/infra exec cdk synth --quiet`
  - **Job `db`:** runs `supabase/setup-cli`, then `supabase db start` and `supabase test db` from `packages/db`.
- [ ] **Step 3:** Write `codeql.yml` (javascript-typescript, on PRs, pushes to main, and weekly) and `dependabot.yml` (npm and github-actions, weekly, minor/patch updates grouped).
- [ ] **Step 4:** Add to `README.md` the manual GitHub settings for the user to enable:
  - secret scanning with push protection
  - Dependabot alerts
  - branch protection on `main` requiring `check` and `db`
- [ ] **Step 5:** Run `pnpm lint && pnpm typecheck && pnpm test` locally. Expected: pass. CI is verified on the first push, which is up to the user.
- [ ] **Step 6:** Commit with message `ci: lint/typecheck/test, db tests, codeql, dependabot`.

### Task 11: Wrap-up
- [ ] Run everything: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @trainmore/db test:db && pnpm --filter @trainmore/infra exec cdk synth --quiet`.
- [ ] Update `docs/ARCHITECTURE.md` §8: mark M0 done and note any deviations.
- [ ] Report the results to the user. Pushing and opening a PR happens only if asked.

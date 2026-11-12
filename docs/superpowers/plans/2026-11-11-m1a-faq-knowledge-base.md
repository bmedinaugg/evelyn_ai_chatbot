# M1a FAQ Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approved Freshdesk FAQ articles (Dutch and English) are synced daily into Supabase and searchable with Postgres full-text search, ready for the M1b answering engine.

**Architecture:**
- `packages/freshdesk` is a typed, zod-validated Freshdesk v2 client: Solutions listing plus ticket creation (used in M1b).
- `packages/db` gets a migration (`faq_articles` plus a `search_faq` SQL function) and a `FaqRepository` built on supabase-js with the service-role key.
- `apps/worker` runs `sync-faq`, which merges NL/EN listings, keeps published articles only, upserts changed ones by content hash, and soft-deletes removed ones. It refuses to delete anything after a partial or suspicious fetch.
- Synthetic bilingual FAQ fixtures support local development and the M1b evals.

**Tech Stack:**
- Existing: Node 26, TypeScript 6.0.3, zod 4.6.7, pino 10.4.0, Vitest 5.1.0, Supabase CLI 3.1.0 (pgTAP)
- New: `@supabase/supabase-js@2.119.0` (approved 2026-11-11)

**Spec:**
- `docs/ARCHITECTURE.md`: §3.4 FAQ sync, §3.1 step 4 retrieval, §4 data model, §5 security
- `docs/api/freshdesk.md`
- `CLAUDE.md`

## Global Constraints
- **Inherited from M0:** strict TS (no `any` without a comment), ESM, exact pinned deps, zod at every external boundary, no personal data in logs, nl+en for user-facing text, tests before "done".
- **Plan scope:** the only new dependency is `@supabase/supabase-js@2.119.0`. Anything else needs the user's OK.
- **Unverified Freshdesk endpoints:** the Solutions endpoints in `docs/api/freshdesk.md` are marked unverified. Use exactly the paths written there and nothing else. Behaviour that isn't documented (primary-language listing, missing translations) is settled by Task 7 against the live instance. Until then, a non-2xx response is an error, never "empty".
- **Article URLs:** built as `${FRESHDESK_PORTAL_URL}/${lang}/support/solutions/articles/${id}`. This was verified on 2026-11-11: both `/en/` and `/nl/` without a slug return 200.
- **Published only:** only `status === 2` articles are served. Drafts are never stored as active.
- **Database:**
  - every new table lives in `public` (auto-RLS from M0)
  - no grants to `anon`/`authenticated`
  - functions are `security invoker` with `set search_path = ''`
  - only the server's service role reads or writes
- **Commits:** on branch `m1a-faq-knowledge-base`, one per task, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Partial or suspicious sync.** If any folder listing fails, or Freshdesk returns zero articles while the database has some, the sync must delete nothing and exit non-zero. (Task 5)
2. **Article in only one language.** It is stored and searchable. Answers in the other language fall back to the available title, body and URL, so a link is never missing or broken. (Tasks 2 and 5)
3. **Hostile or odd search input.** Empty strings, punctuation, tsquery syntax (`& | ! :* ( )`), quotes, 5,000-character strings and SQL-looking text must return 0..max rows without an error. (Task 2)
4. **HTML.** Article HTML (scripts, entities, `<br>`, lists) is stored as clean text. User-entered ticket text is HTML-escaped before it goes into Freshdesk's HTML `description`. (Tasks 4 and 5)
5. **Unpublish, then republish.** An unpublished or removed article disappears from search. Republishing restores it (`deleted_at` cleared). (Tasks 2 and 5)

---

### Task 1: Branch, decisions, Dependabot

**Files:**
- Modify:
  - `docs/ARCHITECTURE.md`
  - `docs/api/freshdesk.md`
  - `.github/dependabot.yml`

- [ ] **Step 1:** Run `git checkout -b m1a-faq-knowledge-base` from an up-to-date `main`.
- [ ] **Step 2:** Update `docs/ARCHITECTURE.md` with the decisions made on 2026-11-11:
  - **§0 decisions table**, new rows:
    - chat model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), env-configurable
    - answers are **checked, then shown**: no token streaming, plain JSON
    - **full-text search first**; Voyage is deferred behind a retrieval interface
    - M1 is delivered as **M1a/M1b/M1c**, with the preprod deploy as a separate step once AWS access exists
  - **§3.1:** replace "Stream the reply over SSE" with "Return the validated reply as JSON; the widget shows a typing indicator". Replace hybrid retrieval with "Postgres full-text search (`dutch` + `english`) over whole FAQ articles; Voyage embeddings later".
  - **§3.1:** add "Assistant turns are stored verbatim (API content blocks) and history is append-only, as required by preserved thinking on Sonnet 5.5".
  - **§4:** replace `faq_chunks` with "whole articles (FAQs are short); chunking only if articles grow".
  - **§6 Libraries:** Embeddings row becomes "Deferred (M1 uses full-text)". The API row drops "SSE-friendly".
- [ ] **Step 3:** Update `docs/api/freshdesk.md` under "Our help portal": "Verified 2026-11-11: `/{en|nl}/support/solutions/articles/{id}` without a slug returns 200."
- [ ] **Step 4:** In `.github/dependabot.yml` npm entry, add `ignore: [{ dependency-name: "typescript", update-types: ["version-update:semver-major"] }]`. The reason (TS 7 tooling) goes in a YAML comment.
- [ ] **Step 5:** Commit with message `docs: M1 decisions (Sonnet 5.5, check-then-show, full-text search); hold TypeScript major`.

### Task 2: FAQ table and search function (pgTAP)

**Files:**
- Create:
  - `packages/db/supabase/migrations/20261111120000_faq_articles.sql`
  - `packages/db/src/database.types.ts` (generated)
- Test: `packages/db/supabase/tests/faq.test.sql`
- Modify: `packages/db/package.json` (script `db:types`: `supabase gen types typescript --local --schema public > src/database.types.ts`)

**Interfaces:**
- **Produces table `public.faq_articles`:**
  - `id bigint primary key` (the Freshdesk article id)
  - `folder_id bigint not null`
  - `title_nl text`, `body_nl text`, `url_nl text`
  - `title_en text`, `body_en text`, `url_en text`
  - `content_hash text not null`
  - `freshdesk_updated_at timestamptz not null`
  - `synced_at timestamptz not null default now()`
  - `deleted_at timestamptz`
  - check constraint: at least one complete language triple (title, body and url all non-null for nl or for en)
  - `search_nl tsvector` generated and stored: `setweight(to_tsvector('dutch', coalesce(title_nl,'')),'A') || setweight(to_tsvector('dutch', coalesce(body_nl,'')),'B')`
  - `search_en`, the same with `'english'`
  - GIN index on each tsvector
- **Produces function `public.search_faq(query text, preferred_lang text, max_results int default 5)`:**
  - returns `table(article_id bigint, lang text, title text, body text, url text, rank real)`
  - `language sql stable security invoker set search_path = ''`
  - `revoke execute … from public, anon, authenticated`; `grant execute … to service_role`
- **Search behaviour:**
  - `query` is truncated to 500 chars.
  - Matching uses `websearch_to_tsquery` in both `dutch` and `english`.
  - Deleted rows are excluded.
  - rank = greatest of the two `ts_rank_cd`.
  - Returned `lang`/`title`/`body`/`url` are in `preferred_lang` when that language triple exists, otherwise in the other language.
  - `max_results` is clamped to 1..10.
  - `preferred_lang` not in (`nl`,`en`) raises an exception.
  - Results are ordered by rank desc, then `article_id`.

- [ ] **Step 1: Write the failing pgTAP tests.** Insert fixture rows inside the test transaction:
  - `1` nl+en "opzeggen"/"cancel membership"
  - `2` nl-only "openingstijden"
  - `3` en-only "guest pass"
  - `4` like 1 but `deleted_at = now()`
```sql
select plan(12);
-- Dutch stemming: 'opzegging' finds article 1 ('Lidmaatschap opzeggen')
select results_eq($$select article_id from public.search_faq('opzegging', 'nl')$$, $$values (1::bigint)$$, 'dutch stemming');
-- English stemming: 'cancelling' finds article 1, served in English
select results_eq($$select article_id, lang from public.search_faq('cancelling my membership', 'en')$$, $$values (1::bigint, 'en')$$, 'english stemming + preferred language');
-- nl-only article requested in English falls back to Dutch with its Dutch URL
select results_eq($$select lang, url from public.search_faq('openingstijden', 'en')$$, $$values ('nl', 'https://portal.test/nl/support/solutions/articles/2')$$, 'fallback to available language');
-- en-only article requested in Dutch falls back to English
select results_eq($$select lang from public.search_faq('guest pass', 'nl')$$, $$values ('en')$$, 'fallback en');
select is_empty($$select 1 from public.search_faq('opzeggen', 'nl') where article_id = 4$$, 'soft-deleted excluded');
select lives_ok($$select * from public.search_faq('', 'nl')$$, 'empty query ok');
select lives_ok($$select * from public.search_faq('!!! & | :* ( ) " '' ; drop table x; --', 'nl')$$, 'tsquery syntax/punctuation ok');
select lives_ok($$select * from public.search_faq(repeat('opzeggen ', 1000), 'nl')$$, 'very long query ok');
select ok((select count(*) from public.search_faq('membership', 'en', 50)) <= 10, 'max_results clamped to 10');
select throws_ok($$select * from public.search_faq('x', 'de')$$, null, null, 'unsupported language rejected');
select ok(not has_function_privilege('anon', 'public.search_faq(text,text,int)', 'execute'), 'anon cannot execute search_faq');
select ok(not has_function_privilege('authenticated', 'public.search_faq(text,text,int)', 'execute'), 'authenticated cannot execute search_faq');
```
- [ ] **Step 2:** Run `pnpm --filter @trainmore/db test:db` with Supabase started. Expected: `faq.test.sql` FAIL (function does not exist). `baseline.test.sql` still passes.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run `pnpm --filter @trainmore/db db:reset && pnpm --filter @trainmore/db test:db`. Expected: all tests pass, including the baseline's "every public table has RLS" and "no grants" checks.
- [ ] **Step 5:** Run `pnpm --filter @trainmore/db db:types`. Confirm `faq_articles` and `search_faq` appear in `src/database.types.ts`. Commit with message `feat(db): faq_articles with nl/en full-text search`.

### Task 3: Config loaders for Supabase and Freshdesk (`packages/shared`)

**Files:**
- Create: `packages/shared/src/config-sections.ts`
- Modify: `packages/shared/src/index.ts`, `.env.example`
- Test: `packages/shared/test/config-sections.test.ts`

**Interfaces:**
- **Produces:**
  - `loadRuntimeConfig(env?): RuntimeConfig`, where `RuntimeConfig = Pick<Config, 'nodeEnv' | 'appEnv' | 'awsRegion' | 'logLevel'>`
  - `loadSupabaseConfig(env?): { url: string; serviceRoleKey: string }`
  - `loadFreshdeskConfig(env?): { domain: string; apiKey: string; faqFolderIds: number[]; portalUrl: string }`
  - All three throw `ConfigError` (M0), naming keys and never values.
  - Refactor `loadConfig` to reuse `loadRuntimeConfig` without changing its output (its existing 6 tests must stay green).
- **Env keys:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRESHDESK_DOMAIN`, `FRESHDESK_API_KEY`, `FRESHDESK_FAQ_FOLDER_IDS`, `FRESHDESK_PORTAL_URL`.

- [ ] **Step 1: Write the failing tests.**
```ts
it('parses folder ids with spaces', () => expect(loadFreshdeskConfig({ ...fd, FRESHDESK_FAQ_FOLDER_IDS: ' 101, 202 ' }).faqFolderIds).toEqual([101, 202]));
it('rejects non-numeric or empty folder ids', () => {
  expect(() => loadFreshdeskConfig({ ...fd, FRESHDESK_FAQ_FOLDER_IDS: '101,abc' })).toThrow(/FRESHDESK_FAQ_FOLDER_IDS/);
  expect(() => loadFreshdeskConfig({ ...fd, FRESHDESK_FAQ_FOLDER_IDS: '' })).toThrow(/FRESHDESK_FAQ_FOLDER_IDS/);
});
it('rejects a domain with scheme or path', () => expect(() => loadFreshdeskConfig({ ...fd, FRESHDESK_DOMAIN: 'https://x.freshdesk.com/' })).toThrow(/FRESHDESK_DOMAIN/));
it('strips a trailing slash from the portal URL', () => expect(loadFreshdeskConfig({ ...fd, FRESHDESK_PORTAL_URL: 'https://portal.test/' }).portalUrl).toBe('https://portal.test'));
it('never echoes secrets', () => { /* invalid SUPABASE_URL + key 'sb-secret-xyz' → message lacks 'sb-secret-xyz' */ });
it('loadRuntimeConfig ignores Magicline keys', () => expect(loadRuntimeConfig({ NODE_ENV: 'test', APP_ENV: 'local', AWS_REGION: 'eu-west-1' })).toEqual({ nodeEnv: 'test', appEnv: 'local', awsRegion: 'eu-west-1', logLevel: 'info' }));
```
- [ ] **Step 2:** Run `pnpm --filter @trainmore/shared test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. The domain pattern is `^[a-z0-9-]+(\.[a-z0-9-]+)+$` (lower-cased first). Add `FRESHDESK_PORTAL_URL` to `.env.example`. The other keys already exist.
- [ ] **Step 4:** Run the same command. Expected: all pass, including the existing `loadConfig` tests. Commit with message `feat(shared): runtime, Supabase and Freshdesk config loaders`.

### Task 4: Freshdesk client (`packages/freshdesk`)

**Files:**
- Create:
  - `packages/freshdesk/package.json`, `tsconfig.json`, `vitest.config.ts` (same pattern as `packages/magicline`)
  - `packages/freshdesk/src/client.ts`, `errors.ts`, `schemas.ts`, `html.ts`, `index.ts`
- Test: `packages/freshdesk/test/client.test.ts`, `packages/freshdesk/test/html.test.ts`

**Interfaces:**
- **Consumes:** the `Lang` type from `@trainmore/i18n`.
- **Produces:**
  - `createFreshdeskClient(opts: { domain: string; apiKey: string; fetch?: typeof fetch }): FreshdeskClient`
  - `interface FreshdeskClient { listFolderArticles(folderId: number, lang: Lang): Promise<FreshdeskArticle[]>; createTicket(input: CreateTicketInput): Promise<{ id: number }> }`
  - `type FreshdeskArticle = { id: number; folderId: number; title: string; descriptionHtml: string; status: number; updatedAt: string }`. The zod schema maps `folder_id`, `description` and `updated_at` and strips all other fields.
  - `type CreateTicketInput = { email: string; subject: string; descriptionText: string; tags: string[]; phone?: string }`
  - error classes `FreshdeskError` (with `status`, `endpoint`), `FreshdeskRateLimitError` (with `retryAfterSeconds`) and `FreshdeskResponseError`, mirroring the Magicline errors
  - `htmlToText(html: string): string`
  - `escapeHtml(text: string): string`
- **Wire contract** (`docs/api/freshdesk.md`; Solutions paths unverified):
  - base URL `https://${domain}/api/v2`
  - header `Authorization: Basic base64(apiKey + ':X')`
  - **listing:** `GET /solutions/folders/{folderId}/articles/{lang}?per_page=100&page=N`, continuing while the `link` header contains `rel="next"`
  - **ticket:** `POST /tickets` with JSON `{ email, subject, description: escapeHtml(descriptionText).replace(/\n/g, '<br>'), tags, phone?, status: 2, priority: 1, source: 7 }`
  - 429 maps to `FreshdeskRateLimitError` using `Retry-After`

- [ ] **Step 1: Write the failing tests.** Use a fake `fetch`, as in the Magicline tests.
```ts
it('sends basic auth and lists the folder in the requested language', ...)  // url .../solutions/folders/101/articles/nl?per_page=100&page=1; Authorization 'Basic ' + btoa('key:X')
it('follows rel="next" pagination', ...)                                   // page 1 link next → page 2 without link → 2 pages merged
it('strips unknown fields and maps names', ...)                             // { id, folder_id, title, description, status, updated_at, seo_data:{} } → FreshdeskArticle
it('rejects an article without a title', ...)                               // → FreshdeskResponseError
it('maps 429 with Retry-After', ...)                                        // → FreshdeskRateLimitError { retryAfterSeconds: 30 }
it('does not leak response bodies in errors', ...)                          // 500 body contains 'jan@example.com' → message lacks it
it('creates a ticket with escaped HTML description', ...)                   // descriptionText '<script>x</script>\nhi' → description '&lt;script&gt;x&lt;/script&gt;<br>hi'; status 2, priority 1, source 7
it('returns the created ticket id', ...)                                    // 201 { id: 55, ... } → { id: 55 }
```
`html.test.ts`:
```ts
it('converts block tags and br to newlines, strips tags', () => expect(htmlToText('<p>Hoi</p><ul><li>a</li><li>b</li></ul>Line<br>2')).toBe('Hoi\n\n- a\n- b\n\nLine\n2'));
it('drops script and style contents', () => expect(htmlToText('<p>x</p><script>alert(1)</script><style>p{}</style>')).toBe('x'));
it('decodes entities', () => expect(htmlToText('&amp; &lt;b&gt; &quot;q&quot; &#39;s&#39; &nbsp;€ &#8364; &#x20AC;')).toBe('& <b> "q" \'s\' € € €'));
it('collapses whitespace and trims', () => expect(htmlToText('  <p> a \n\n\n b </p>  ')).toBe('a\n\nb'));
it('escapeHtml escapes & < > " \'', () => expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));
```
- [ ] **Step 2:** Run `pnpm --filter @trainmore/freshdesk test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. `htmlToText` works without dependencies: remove `script`/`style` elements, turn `li` into `- `, turn `br` and block closers (`p`, `div`, `h1-6`, `ul`, `ol`, `li`) into newlines, strip remaining tags, decode named (`amp lt gt quot apos #39 nbsp euro`) and numeric entities, then collapse runs of 3+ newlines to 2 and spaces within lines.
- [ ] **Step 4:** Run the tests and typecheck. Expected: all pass. Commit with message `feat(freshdesk): typed client for solutions listing and ticket creation`.

### Task 5: FAQ sync (`packages/db` repository + `apps/worker`)

**Files:**
- Create:
  - `packages/db/src/faq-repository.ts`, `packages/db/src/client.ts`, `packages/db/src/index.ts`, `packages/db/tsconfig.json`
  - `packages/db/vitest.integration.config.ts`
  - `apps/worker/package.json`, `tsconfig.json`, `vitest.config.ts`
  - `apps/worker/src/faq-sync.ts`, `apps/worker/src/main.ts`
- Test:
  - `packages/db/test/faq-repository.integration.test.ts`
  - `apps/worker/test/faq-sync.test.ts`, plus `apps/worker/test/in-memory-faq-repository.ts` (test helper)
- Modify: `packages/db/package.json`, which gains deps `@supabase/supabase-js@2.119.0` and `@trainmore/i18n`, and scripts `typecheck`, `test` (`vitest run --passWithNoTests`, unit only) and `test:integration`.

**Interfaces:**
- **Consumes:** `FreshdeskClient`, `htmlToText` (Task 4); `loadRuntimeConfig`, `loadSupabaseConfig`, `loadFreshdeskConfig`, `createLogger` (Task 3 / M0); the `Lang` type.
- **Produces (`@trainmore/db`):**
  - `createServiceClient(cfg: { url: string; serviceRoleKey: string }): SupabaseClient<Database>`, with `auth: { persistSession: false, autoRefreshToken: false }`
  - `type FaqArticleRecord = { id: number; folderId: number; nl: FaqTranslation | null; en: FaqTranslation | null; contentHash: string; freshdeskUpdatedAt: string }`
  - `type FaqTranslation = { title: string; body: string; url: string }`
  - `type FaqSearchHit = { articleId: number; lang: Lang; title: string; body: string; url: string; rank: number }`
  - `interface FaqRepository`:
    - `getActiveContentHashes(): Promise<Map<number, string>>`
    - `countActive(): Promise<number>`
    - `upsert(articles: FaqArticleRecord[]): Promise<void>`: sets `deleted_at = null` and `synced_at = now()`
    - `softDeleteAllExcept(keepIds: number[]): Promise<number>`
    - `search(query: string, preferredLang: Lang, limit?: number): Promise<FaqSearchHit[]>`: calls the `search_faq` RPC and validates rows with zod
  - `createSupabaseFaqRepository(client: SupabaseClient<Database>): FaqRepository`
- **Produces (`apps/worker`):**
  - `runFaqSync(deps: { freshdesk: Pick<FreshdeskClient, 'listFolderArticles'>; repo: FaqRepository; folderIds: number[]; portalUrl: string; logger: Logger }): Promise<FaqSyncResult>`
  - `type FaqSyncResult = { upserted: number; unchanged: number; deleted: number; skippedUnpublished: number }`
  - `class FaqSyncAbortedError extends Error { reason: 'fetch_failed' | 'empty_listing' }`
  - `main.ts` takes the command `sync-faq`: it loads config, runs the sync, logs the result (counts only), and exits 1 on any error.
- **Merge rules:**
  - For each folder and each language, list the articles and keep those with `status === 2`.
  - Merge by `id` into `{ nl, en }`, using `title`, `htmlToText(descriptionHtml)` as body, and the built URL.
  - An article with no published language counts toward `skippedUnpublished`.
  - `contentHash` = sha256 hex of `JSON.stringify([folderId, nl, en])`.
  - `freshdeskUpdatedAt` = max of the languages' `updatedAt`.
  - Upsert only new or changed hashes, and also any id that is currently missing from the active set (republish).
- **Safety:**
  - Any listing error aborts before writes, with `FaqSyncAbortedError('fetch_failed')` carrying the cause.
  - If the merged set is empty and `countActive() > 0`, throw `FaqSyncAbortedError('empty_listing')`.
  - Deletion runs only after every listing succeeded.

- [ ] **Step 1: Write the failing unit tests** for `apps/worker`, with a fake `FreshdeskClient` and the in-memory repository.
```ts
it('stores a bilingual published article with both URLs', ...)        // nl+en status 2 → upserted 1; urls https://portal.test/{nl,en}/support/solutions/articles/7
it('stores an article published in one language only', ...)           // nl status 2, en status 1 → record.en === null
it('skips articles not published in any language', ...)               // both status 1 → skippedUnpublished 1, not stored
it('only upserts changed articles', ...)                              // second run with same data → upserted 0, unchanged 1
it('soft-deletes articles that disappeared', ...)                     // run 2 without id 7 → deleted 1
it('restores a republished article', ...)                             // removed then present again → upserted 1, active again
it('aborts without writing when a listing fails', ...)                // folder 2 'en' throws → FaqSyncAbortedError('fetch_failed'); repo untouched (no upsert, no delete)
it('aborts when Freshdesk returns nothing but the DB has articles', ...) // → FaqSyncAbortedError('empty_listing'); nothing deleted
it('converts article HTML to text', ...)                              // '<p>Hoi&nbsp;<b>daar</b></p>' → 'Hoi daar'
it('logs counts only, never article content', ...)                    // captured log output lacks article body text
```
- [ ] **Step 2:** Run `pnpm --filter @trainmore/worker test`. Expected: FAIL.
- [ ] **Step 3:** Implement `runFaqSync` and `main.ts`.
- [ ] **Step 4:** Run the same command. Expected: 10 passed.
- [ ] **Step 5: Write the failing integration tests** for `createSupabaseFaqRepository`. They need a running local Supabase plus `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env`. A missing env fails fast with a clear message naming the command.
```ts
it('upsert then search finds the article in the preferred language', ...)
it('search falls back to the other language', ...)
it('softDeleteAllExcept hides articles from search and countActive', ...)
it('upsert clears deleted_at', ...)
it('getActiveContentHashes returns active ids only', ...)
it('the anon key cannot read faq_articles or call search_faq', ...)    // createClient(url, anonKey) → error/empty, never rows
```
  Each test cleans up the ids it inserted.
- [ ] **Step 6:** Run `pnpm --filter @trainmore/db test:integration` (Supabase running). Expected: FAIL, then implement the repository, then 6 passed.
- [ ] **Step 7:** Run lint, typecheck and `pnpm test`. Expected: all pass. Commit with message `feat: FAQ sync from Freshdesk with safe deletes and Supabase repository`.

### Task 6: Synthetic FAQ fixtures and local seeding

**Files:**
- Create:
  - `apps/worker/fixtures/faq-articles.json`
  - `apps/worker/src/fixture-source.ts`
- Modify: `apps/worker/src/main.ts`, which gains the command `seed-faq-fixtures`, refused unless `APP_ENV=local`
- Test: `apps/worker/test/fixtures.test.ts`

**Interfaces:**
- **Produces:**
  - `fixtureFreshdeskClient(): Pick<FreshdeskClient, 'listFolderArticles'>`, which serves the fixtures as if they came from folder `900001`. Seeding reuses `runFaqSync`, so the fixtures go through the same merge and HTML path.
  - **Fixture shape:** `[{ id, folderId: 900001, nl: { title, descriptionHtml, status } | null, en: {...} | null, updatedAt }]`
  - **Coverage: 8 synthetic articles** across these topics:
    - cancel membership (nl+en)
    - opening hours (nl+en)
    - freeze membership (nl+en)
    - payments/direct debit (nl+en)
    - bring a friend/guest (nl+en)
    - app login problems (nl+en)
    - lockers (nl only)
    - personal training (en only)
  - Every body starts with `[SYNTHETIC TEST CONTENT — not TrainMore policy]`.
  - M1b evals use these ids.

- [ ] **Step 1: Write the failing tests.**
```ts
it('every fixture validates and has at least one published language', ...)
it('has nl-only and en-only articles for fallback tests', ...)
it('every body is marked synthetic', ...)
it('seeding twice is idempotent', ...)  // runFaqSync with fixtureFreshdeskClient + in-memory repo → second run upserted 0
it('seed refuses outside APP_ENV=local', ...)
```
- [ ] **Step 2:** Run the tests. Expected: FAIL. Implement. Run again. Expected: pass.
- [ ] **Step 3:** Run the end-to-end check `APP_ENV=local … pnpm --filter @trainmore/worker exec tsx src/main.ts seed-faq-fixtures` (Supabase running), then query `select count(*) from faq_articles`. Expected: 8. Commit with message `feat(worker): synthetic bilingual FAQ fixtures and local seeding`.

### Task 7: Verify Freshdesk Solutions against the live instance (needs user input)

**Blocked until** the user provides `FRESHDESK_DOMAIN`, a read-capable `FRESHDESK_API_KEY` in local `.env`, and the FAQ folder IDs. If these aren't available when Tasks 1–6 and 8 are done, skip this task, record it in the ledger, and report it as open.

- [ ] **Step 1:** Run a read-only script `apps/worker/scripts/verify-freshdesk.ts` (not committed with any output). It calls `listFolderArticles(folderId, 'nl'|'en')` for each folder and prints only counts, status values, field names and HTTP codes: no titles or bodies.
- [ ] **Step 2:** Record the findings in `docs/api/freshdesk.md`, removing "unverified" where confirmed:
  - whether the `{lang}` path works for the primary language
  - what a missing translation returns
  - the field names
- [ ] **Step 3:** If behaviour differs from Task 4's assumptions (for example, a missing translation returns 404), add a failing test for the real behaviour, fix the client, and commit with message `fix(freshdesk): match verified Solutions behaviour`.

### Task 8: CI and wrap-up

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/ARCHITECTURE.md` (§8: M1a done)

- [ ] **Step 1:** Extend the `db` job:
  - pnpm/node setup and `pnpm install --frozen-lockfile`
  - `supabase start -x studio,imgproxy,inbucket,mailpit,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor`
  - `supabase test db`
  - generated-types drift check: `supabase gen types typescript --local --schema public | diff - src/database.types.ts`
  - export `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` from `supabase status -o env`, then run `pnpm --filter @trainmore/db test:integration`
- [ ] **Step 2:** Add to the README: local FAQ workflow (`db:start`, `seed-faq-fixtures`, `sync-faq`) and the env keys.
- [ ] **Step 3:** Full run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @trainmore/db test:db && pnpm --filter @trainmore/db test:integration`. Expected: all pass. Commit with message `ci: run Supabase integration tests and type drift check`.

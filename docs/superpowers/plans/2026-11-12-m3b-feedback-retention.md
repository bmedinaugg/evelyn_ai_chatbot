# M3b Feedback, Retention and Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close M3 (MVP). Customers can rate answers (thumbs up/down; down flags the
conversation). Personal data is removed on a schedule: transcripts are anonymised after 90 days,
login codes are purged after 24 hours, and account bindings are cleared after 24 hours. Support
can delete a customer's chatbot data on request (DSAR). A one-command local stack lets anyone
click through every flow without real Freshdesk, Magicline or Claude spend.

**Decisions (product owner, 2026-11-12):**
- Transcripts are kept 90 days, then anonymised.
- Kept after anonymising: outcome, flags, citations, feedback, escalations, leads, studio id, status, timestamps.
- Account bindings are cleared 24 hours after login.
- DSAR runs as an operator command until the portal (M4).
- No permanent "log in" button: login is offered only for account questions.

**Architecture:**
- **Feedback:**
  - The message reply returns the assistant `messageId`.
  - `POST /widget/conversations/:id/feedback {messageId, rating: 'up'|'down'}` (bearer). Only
    assistant messages of that conversation are accepted, and a new rating replaces the old one.
  - `down` adds the flag `thumbs_down`.
  - Table `message_feedback(message_id pk → messages on delete cascade, rating, created_at)`.
- **Retention (worker `retention`, daily):**
  - **Anonymise** conversations whose last activity (`coalesce(last_message_at, created_at)`) is
    more than 90 days ago:
    - `messages.display_text = ''` and `api_content = '{}'`
    - verified email hash, account candidates and customer id cleared
    - `token_hash` replaced, so the old token is useless
    - `anonymised_at` set
  - **Kept for metrics:** outcome, flags, citations, feedback, escalations, lead records, studio id,
    customer status and timestamps.
  - **Purge** `otp_challenges` older than 24 hours.
  - **Clear account bindings** (customer id, candidates) 24 hours after `verified_at`. The
    customer simply logs in again.
  - Everything runs in SQL functions with a batch limit, and the job loops until done. Logs carry
    counts only.
- **DSAR (worker `dsar-delete --email <address>`):**
  - The email is HMAC-hashed with `OTP_HMAC_SECRET`, then the job deletes the conversations
    verified with that hash (messages, flags, feedback cascade; escalations and leads keep a null
    link) and that email's OTP challenges.
  - It prints counts only.
  - Run by an operator via ECS RunTask until the portal (M4) gets a button.
  - Limitations:
    - Conversations that were never logged in cannot be linked to an email (they are anonymised
      at 90 days).
    - Freshdesk tickets are handled in Freshdesk.
- **Local stack:**
  - `pnpm dev:local` starts Supabase, seeds FAQ fixtures, and starts the mock Magicline, the API
    (fake answerer by default; `CLAUDE=1` uses the real model) and the widget.
  - With `APP_ENV=local` and `FRESHDESK_FAKE=1`, tickets, notes and leads go to a local outbox
    log instead of Freshdesk, the same as the email outbox. Fake topics are available too.

**Spec:**
- `docs/ARCHITECTURE.md` §3.6 (flagging), §4 (retention), §5
- `CLAUDE.md`

## Global Constraints
- **RLS** on the new table.
- **SQL functions** are `security invoker` with `search_path=''` and execute for service_role only.
- **pgTAP** asserts that RLS and grants are as expected for every new object.
- **No personal data in logs:** DSAR and retention log counts only, never the email or its hash.
- **Retention is idempotent and batched**, and safe to run twice in parallel (row locks / `skip locked`).
- **Fakes are local only:** the Freshdesk stand-in and fake answerer only work with `APP_ENV=local`.
  Startup fails when they are requested elsewhere.
- **Text:** all new texts in nl and en.
- **Commits:** branch `m3b-feedback-retention`, stacked on `m3a-escalation`.

## Review Focus
1. **Feedback forgery:** a message id from another conversation, or a user message, is rejected
   (404/400), and nothing is flagged.
2. **Anonymisation completeness:** after the job, no display text, API content (including tool data),
   email hash, customer id or candidates remain for old conversations, and the old token gives 404.
3. **No data loss for live chats:** conversations active within 90 days are untouched, and the
   binding clear at 24h does not break an in-flight turn.
4. **DSAR scope:** only conversations verified with that exact email are deleted, and other customers'
   data survives (test with two emails).
5. **Fakes can't reach preprod/prod:** `FRESHDESK_FAKE=1` with `APP_ENV=preprod` refuses to start.

## Tasks
1. **Local stack:**
   - local Freshdesk stand-in (tickets, notes, leads, ticket fields) behind `APP_ENV=local` + `FRESHDESK_FAKE=1`
   - `scripts/dev-local.sh` and `pnpm dev:local`
   - `docs/TESTING.md` click-through checklist (nl/en)
2. **DB:**
   - `message_feedback`, flag reason `thumbs_down`
   - `append_chat_turn` returns the assistant message id
   - `record_feedback`, `anonymise_conversations(p_before, p_limit)`, `purge_otp_challenges(p_before)`,
     `clear_account_bindings(p_before)`, `dsar_delete(p_email_hash)`
   - repositories, pgTAP and integration tests (incl. the M3a review's RLS assertions for `ticket_topics`/`escalations`)
3. **Core + API:**
   - `messageId` in replies
   - feedback endpoint (rate limited)
   - M3a leftovers: escalation reason `stuck` only after two failed replies in a row; a DB error in
     the stuck check falls back to the normal reply
4. **Worker:** `retention` and `dsar-delete` commands, plus the M3a leftover of keeping untrimmed
   topic values.
5. **Widget:**
   - thumbs up/down under bot answers (aria labels, "thanks" state, one rating per message, changeable)
   - M3a a11y leftovers: topics loading text, errors linked to fields, focus to the success message
   - e2e tests
6. **Docs:** ARCHITECTURE §4/§5 retention + DSAR runbook, plus the final review.

Not in M3b (they need AWS access): WAF rules, load test, and the EventBridge schedules (FAQ,
topics, retention). These come with the first preprod deploy.

# M3a Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the bot can't help, the visitor gets a **general ticket form**. The form is prefilled from the chat, offers topics synced daily from Freshdesk, and is protected by Turnstile. It creates a Freshdesk ticket with the transcript and minimal account context as a private note. A conversation that keeps failing proactively offers the form.

**Decisions (product owner, 2026-11-12):**
- Hand-off is via the prefilled form for everyone; no automatic ticket and no Magicline email lookup.
- Topics are Membership & contract, Payments & invoices, Club & facilities, and App & account. They are **synced daily from the Freshdesk ticket form field**; the four above are the built-in nl/en defaults.
- Retention: 90 days, then anonymise (M3b).

**Architecture:**
- **Freshdesk client:** `listTicketFields()` (`GET /api/v2/ticket_fields`, verified in docs) and `addPrivateNote(ticketId, html)` (`POST /api/v2/tickets/{id}/notes`, verified). `createTicket` gains `type`.
- **Worker `sync-ticket-topics`** (daily):
  - reads the choices of the configured field (`FRESHDESK_TOPIC_FIELD`, default `ticket_type`) into a `ticket_topics` table
  - same safety as the FAQ sync: nothing changes on a failure or an empty result
- **API:**
  - `GET /widget/ticket-topics?lang=` returns active topics with labels (built-in nl/en labels for known values, otherwise the Freshdesk value)
  - `POST /widget/conversations/:id/tickets` (bearer, Turnstile) checks the topic against the table, creates the ticket (`type` = topic, tags), adds a private note (transcript of display texts plus status and club name when logged in), and records an `escalations` row
- **Core:**
  - Hand-offs use the action `ticket_form` instead of `contact`; the widget still shows the contact link as a fallback.
  - **Stuck:** a second consecutive `no_match`/`invalid_citation` reply gives the fixed text `bot.stuck`, `ticket_form` and the flag `needs_human`.
- **Widget:** `TicketForm` with topic dropdown, email (in memory only), optional name, prefilled subject and description, consent and Turnstile. It shows a success message with no ticket number (privacy).

**Spec:**
- `docs/ARCHITECTURE.md` §3.5, §3.6 (flagging), §4, §5
- `docs/api/freshdesk.md` (tickets, notes and ticket fields verified)
- `docs/api/turnstile.md`
- `CLAUDE.md`

## Global Constraints
- **The transcript in the note** contains only display texts (what the customer saw and typed), never API content, tool data or hashes. It's HTML-escaped and capped at 50 messages.
- **Account context in the note** is only status and club name, and only when logged in. No customer id or number.
- **Our database** stores no email, name or description. `escalations` holds the conversation id, ticket id, topic and reason.
- **The topic** must be an active synced topic, or a built-in default when the table is empty.
- **Text:** all new texts nl+en. Turnstile tokens are single use (reset on failure).
- **Commits:** branch `m3a-escalation`, stacked on `m2b-account-answers`.

## Review Focus
1. **Transcript leakage:** the ticket must only contain the requesting conversation (bearer token), never tool data. A wrong token gives 404.
2. **Topic tampering:** an arbitrary `type` value is rejected.
3. **Topic sync safety:** Freshdesk down or the field missing leaves the topics unchanged.
4. **Stuck detection** only triggers on consecutive failures, not across new chats.
5. **Partial failure:** if the private note fails after the ticket was created, the request still returns 201 and the failure is logged (no duplicate tickets).

## Tasks
1. Freshdesk client: ticket fields, private note, ticket `type`.
2. DB: `ticket_topics`, `escalations`, last assistant outcome query; repositories.
3. Worker `sync-ticket-topics` (plus a CDK schedule note).
4. Core: `ticket_form` action, stuck detection, `bot.stuck` text, transcript builder.
5. API: topics endpoint, ticket endpoint.
6. Widget: TicketForm and e2e.
7. Docs and review.

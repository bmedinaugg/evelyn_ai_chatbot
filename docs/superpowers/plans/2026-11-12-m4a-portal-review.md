# M4a Agent Portal: Login, Review and Switches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support agents sign in with Microsoft Entra ID and see the conversations the bot
flagged. Personal data is masked; revealing it is audited. They also see feedback and
escalations. Admins switch account capabilities on/off, and every change is audited. Everyone
sees the "what the bot can answer" and "known limitations" pages.

**Decisions (product owner, 2026-11-12):**
- The portal is built with Preact, the same as the widget, so it needs no new UI library.
- Entra login comes first, using `@azure/msal-node` 7.2.1 (approved).
- Review comes first (M4a). Scenarios (approved answers), versions and replay follow in M4b.

**Architecture:**
- **Login:** authorization code flow with PKCE, server-side (`ConfidentialClientApplication`).
  - `GET /portal/auth/login` stores `state`, `nonce` and the PKCE verifier in a short-lived,
    signed, httpOnly cookie, then redirects to Entra.
  - `GET /portal/auth/callback` exchanges the code, then checks the tenant (`tid`), the audience,
    the nonce and the **app roles** (`roles` claim: `agent`, `approver`, `admin`). No role means
    no access.
  - On success it creates a `portal_sessions` row (only the SHA-256 of a random session id is
    stored) and sets the cookie `tm_portal`: httpOnly, Secure, SameSite=Strict, Path=/portal,
    8 hours, no sliding.
  - Entra tokens are never stored or sent to the browser.
- **Roles:** Entra *app roles* are assigned to Entra groups (no group-id config, and no groups
  overage).
  - `agent`: review
  - `approver`: review now; approves scenarios in M4b
  - `admin`: everything, plus capability switches
- **CSRF:** SameSite=Strict, plus an `Origin` check on every portal POST/PUT/DELETE.
- **Masking:** transcripts are shown with emails, phone numbers, IBANs and long number runs
  masked. "Show original" (agent and above) is a separate request that writes `audit_log`
  (who, conversation, when).
- **Audit:** an append-only `audit_log` with actor oid, display name, action, target, details
  and time. RLS is on and the table is service-role only. It holds no customer personal data.
- **Portal app:** `apps/portal` (Preact and Vite, nl/en, TrainMore brand).
  - Pages: Flagged conversations (filter by reason and date), Conversation (masked transcript,
    flags, feedback, escalation), Capabilities (catalogue with nl/en examples and switches),
    Limitations.
- **Hosting:** the same CloudFront distribution as the widget.
  - The portal's static files live under `/portal/` in the same bucket.
  - `/portal/api/*` and `/portal/auth/*` go to the API, never cached.
  - The portal gets its own response headers (`frame-ancestors 'none'`).

**Spec:** `docs/ARCHITECTURE.md` §3.3 (catalogue, toggles audited), §3.6 (review), §4, §5
(portal auth); `CLAUDE.md`.

## Global Constraints
- **Entra settings:** `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` (Secrets Manager
  in AWS), `PORTAL_BASE_URL`, `PORTAL_SESSION_SECRET` (≥ 32 characters). The old
  `ENTRA_GROUP_*` variables are replaced by app roles.
- **Logs:** no customer personal data. Agent names may appear in audit rows but are never logged.
- **Portal texts:** in nl and en.
- **Login security:** there is no stand-in login. Tests mock the MSAL client; the real login is
  tested once the app registration exists.
- **Commits:** branch `m4a-portal-review`.

## Review Focus
1. **Auth bypass:** no cookie, an expired or forged cookie, a token from another tenant, or a
   user without a role all lead to 401/403 on every `/portal/api` route.
2. **CSRF:** a cross-site POST or PUT (wrong or missing Origin) is refused.
3. **Masking:** what the list and conversation endpoints return is masked by default. The
   original text comes only from the audited endpoint.
4. **Authorization:** only `admin` can switch capabilities, and every switch is audited with
   the actor.
5. **Login replay:** `state`, `nonce` and the PKCE verifier are single use and expire after
   10 minutes.

## Tasks
1. **DB:** `portal_sessions`, `audit_log`, review queries (flagged list, conversation detail
   with feedback and escalations), `set_capability` with audit; repositories, pgTAP and
   integration tests.
2. **Shared:** `maskText` (emails, phones, IBAN, long number runs), plus Entra/portal config
   loaders.
3. **API auth:** MSAL wrapper (interface plus tests with a fake), login/callback/logout, session
   middleware, role checks and the Origin check.
4. **Portal API:** flagged list, conversation (masked), reveal (audited), capabilities
   (list, toggle), limitations; tests.
5. **Portal app:** Preact pages (nl/en), Playwright e2e with the API mocked.
6. **Infra and docs:** portal paths on the distribution, headers, Entra secret; Entra app
   registration steps in `docs/DEPLOY.md`; ARCHITECTURE; final review.

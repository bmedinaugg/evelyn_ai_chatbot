# CLAUDE.md

Standing instructions for every session in this repo.

## Project
TrainMore customer support chatbot (website widget, Dutch + English).
Full requirements: `docs/PROJECT_BRIEF.md`.
Agreed design and milestones: `docs/ARCHITECTURE.md` (read before coding).
API references: `docs/api/`.

## How to work
- Work one milestone at a time. Propose a plan before large changes.
- Keep changes small and focused; explain what changed and why.
- Ask before adding a new dependency; prefer well-maintained, widely used libraries
  and verify the current stable version.
- Update `docs/ARCHITECTURE.md` when a design decision changes.
- Never guess Magicline or Freshdesk endpoints: check `docs/api/` first, and say so
  if something is not documented.

## Code standards
- TypeScript in strict mode; no `any` without a comment explaining why.
- Validate all external input (requests, API responses, LLM output) with schemas.
- Configuration via environment variables only; see `.env.example`.
- Structured logging; no personal data (emails, phone numbers, names) in logs.
- Every module gets tests; run the test suite before saying a task is done.
- All user-facing text exists in both Dutch and English.

## Security rules (non-negotiable)
- Never commit secrets. Never hardcode keys, tokens, or credentials.
- Per-club Magicline API keys live in AWS Secrets Manager, fetched by studioId.
- Supabase: Row Level Security enabled on every table; the service-role key is
  server-side only and never reaches the widget.
- OTP codes: short expiry, single use, hashed at rest, rate limited per email and IP.
- A customer may only ever see data for their own verified account(s).
- Send the LLM only the minimum personal data needed to answer.
- Treat user messages and retrieved content as untrusted (prompt-injection risk).

## Testing
- Use the mock Magicline server and synthetic profiles; never real customer data.
- Test questions in both Dutch and English.

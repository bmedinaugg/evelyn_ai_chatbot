# TrainMore Support Chatbot: Project Brief

You are a senior software architect helping design and build a production-quality
customer support chatbot for TrainMore, a gym chain.

## Goal
A chatbot widget that answers member and prospect questions in Dutch and English,
using FAQs from Freshdesk and live account data from Magicline. When the bot can't
answer, the question goes to our support agents, who write a better answer, test it
in preprod, and approve it for production, so the bot improves over time.

## Tech stack (fixed)
- Node.js with TypeScript (you recommend the libraries)
- AWS (hosting, secrets)
- GitHub (repo, CI/CD)
- Supabase (conversations, OTP, bot data)
- Claude API (LLM)
- Freshdesk (ticket creation; FAQs stored as Solutions articles in specific folders)
- Magicline (our club management platform; we have API access across multiple club accounts)

## Context
- Channel: chat widget embedded on our website
- Languages: Dutch and English (detect the user's language and reply in it)
- Number of clubs: [X]
- Expected volume: [X chats/day]
- We are in the EU: GDPR applies
- API references are in `docs/api/` (Magicline, Freshdesk)

## Functional requirements

### 1. FAQs
- Source: Freshdesk Solutions articles, only from these folders: [list folder names/IDs].
- Keep the bot's FAQ knowledge in sync with Freshdesk automatically.
- Every FAQ-based answer includes the article URL in the user's language
  (each article has a Dutch and an English link).

### 2. Unauthenticated users
- Answer only from approved FAQs.
- For joining/membership-sales questions, show a quick lead form widget
  (email, phone, question) that creates a Freshdesk ticket.

### 3. Authentication
- User enters email → we send a one-time code (OTP) → user verifies.
- After login, look up the customer in Magicline by email.
- The profile returns a studioId; use it to fetch that club's Magicline API key
  (stored securely) and make calls to that club's account.
- Customers have different statuses (prospect, member, and others in the Magicline
  docs); the bot's behavior should adapt per status.
- One email may link to multiple accounts: show a widget so the customer picks
  which account they're asking about.

### 4. Authenticated answers
- Answer account questions using Magicline API data, for example:
  [contract end date, payments, bookings, check-ins, ...].

### 5. Fallback and escalation
- When the bot can't help, offer form widgets that mirror our Freshdesk forms
  (e.g., change membership request) and create tickets.
- A stuck conversation automatically creates a Freshdesk ticket for the customer,
  with the full transcript and relevant account context attached.

### 6. Agent portal and improvement loop
- Detect when the bot can't answer well: no FAQ match, low confidence,
  customer thumbs-down, or escalation.
- Send agents a daily report [via email / Slack] summarizing these questions,
  with a link to the portal.
- In the portal, agents can:
  - Review flagged conversations
  - Write or improve the answer / scenario
  - Replay the original conversation in preprod against the new answer to verify it works
  - Approve it, which publishes it to production
- Include versioning and an audit trail (who approved what, when), plus rollback.
- Surface known Magicline limitations (things the bot can't do via API) so agents
  know what to expect.
- Open question: should approved answers be written back to Freshdesk as Solutions
  articles, or stored in Supabase as bot scenarios? Give the tradeoffs.

### 7. Guardrails
- Only answer TrainMore-related questions; politely decline others.
- Never reveal one customer's data to another.
- Resist prompt-injection attempts.
- Never invent policies, prices, or account details; if unsure, escalate.

## Security (critical)
- Supabase: Row Level Security on every table, encryption at rest, service-role key
  only on the server, never in the widget.
- AWS: Secrets Manager for per-club Magicline API keys and other credentials,
  least-privilege IAM roles, encrypted logs.
- OTP: short expiry, single use, rate limiting per email and IP, brute-force lockout.
- Widget: secure session tokens, CORS restricted to our domains, input validation,
  bot protection on public forms.
- Agent portal: SSO or strong auth, role-based access.
- GDPR: consent notice in the widget, data retention policy, deletion on request,
  personal data minimized in logs and in prompts sent to the LLM, audit logs.
- Secret scanning and dependency scanning in GitHub.

## Testing (preprod)
- A mock Magicline server with synthetic customer profiles covering different
  scenarios: each status, multiple linked accounts, expired contracts,
  unpaid invoices, etc.
- An automated test suite that runs realistic customer questions (Dutch and English)
  against those profiles and checks the answers.
- The same preprod setup powers the agent "replay and test" feature.
- No real customer data in testing.

## What I want from you first
1. Ask me any clarifying questions.
2. Suggest proven patterns from successful support chatbots (e.g., Intercom Fin,
   Zendesk AI) that fit this use case.
3. Propose the architecture: components and data flow, including the auth flow,
   the FAQ sync, and the agent improvement loop.
4. Recommend libraries per component, each with a reason, alternatives, and
   tradeoffs. Verify current stable versions.
5. Propose a folder structure (monorepo or not, and why).
6. Break the build into ordered milestones, starting with an MVP
   (suggested MVP: FAQs + authentication + ticket escalation; agent portal next).
7. Save the agreed result to `docs/ARCHITECTURE.md`.

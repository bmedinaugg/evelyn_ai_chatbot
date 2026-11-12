# M2b Account Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A logged-in customer (account bound in M2a) can ask about their own account. Claude answers by calling read-only **account tools** that the server runs for the bound account only, returning allowlisted fields. Each tool can be switched off and is limited by membership status.

**Architecture:**
- **Tool loop:** a manual tool-use loop in `packages/core`, using `beta.messages.create` with `tools` (strict schemas, `tool_choice` auto) and the existing structured final answer.
- **Tool context:** tools never take customer or studio ids as input; the server injects them from the conversation binding.
- **Tool results:** returned as zod-validated, allowlisted JSON. The prompt labels them untrusted data.
- **History:** stays append-only. One turn can now store several API messages (assistant `tool_use`, user `tool_result`, …, final assistant) via `append_chat_turn(p_steps)`.
- **Capability flags:** `capability_flags` table (default on) plus a repository. The portal toggles them in M4.

**Spec:**
- `docs/ARCHITECTURE.md` §3.1 step 5, §3.3 (capability catalogue), §5
- `docs/api/magicline.md` and `docs/api/magicline-openapi.json` (endpoints and schemas below)
- `CLAUDE.md`: a customer only ever sees their own data; send the LLM the minimum personal data
- Claude API (skill): manual loop; forced `tool_choice` is a 400 on Sonnet 5.5; `strict: true` tools need `additionalProperties: false`; check `stop_reason` (`tool_use`, `end_turn`, `refusal`, `pause_turn`)

## Capabilities (read-only)

| Tool | Magicline endpoint (key) | Statuses | Fields returned to Claude |
|---|---|---|---|
| `get_memberships` | `GET /v1/customers/{id}/contracts` (studio) | MEMBER, FORMER_MEMBER | rateName, startDate, endDate, contractStatus, cancelled, cancellationDate, lastPossibleCancellationDate, cancellationPeriod, term, price |
| `get_account_balance` | `GET /v1/customers/{id}/account/balances` (studio) | MEMBER, FORMER_MEMBER | accountBalance, inDebtCollection, dunningLevel |
| `get_upcoming_payments` | `GET /v1/customers/{id}/account/transactions/upcoming?sliceSize=6` (studio) | MEMBER | dueDate, description, amount, openAmount |
| `get_recent_visits` | `GET /v1/customers/{id}/activities/checkins?fromDate&toDate` (last 30 days) (studio) | MEMBER | count, last 5 `{checkInDateTime, studioName}` |
| `get_class_bookings` | `GET /v1/cross-studio/customers/{id}/class-bookings?daysAhead=14` (cross) | MEMBER, PROSPECT | title, startDateTime, endDateTime, studio name, bookingStatus |

## Global Constraints
- **Tool inputs:** no tool input contains a customer or studio id. Schemas are `{type:'object', properties:{}, additionalProperties:false}`, `strict: true`.
- **Loop limits:** at most 4 tool rounds per turn. Each tool's result is capped (≤ 20 items) and serialised as JSON inside `<account_data tool="…">`, with text escaped.
- **No PII to Claude:** no names, emails, phones, addresses or IBANs. Payment instruments aren't exposed.
- **Final answer rules:** for `account_question` the model's text is shown only if at least one account tool ran successfully this turn. Otherwise the fixed hand-off text is shown. Citations for account answers are empty.
- **Tool errors:** a Magicline error, a disabled tool or a status not allowed returns `{"error": "unavailable"}` as the tool result. It's logged with the tool name only.
- **Commits:** branch `m2b-account-answers`, stacked on `m2a-login`.

## Review Focus
1. **Cross-customer access:** a tool always uses the bound account. With no bound account, no tools are offered.
2. **Status gating and disabled tools** are respected, and checked again server-side even if Claude asks.
3. **Append-only history with tool turns:** the stored sequence replays exactly; a crash mid-loop stores nothing partial.
4. **Prompt injection via Magicline data:** a class title or description containing instructions is treated as data.
5. **Loop termination:** a model that keeps calling tools stops after 4 rounds with the hand-off.

## Tasks
1. **Magicline client methods** (zod allowlists) for the 5 endpoints, plus mock server routes with synthetic data per profile (expired contract, debt in collection, no bookings, etc.).
2. **Capability catalogue** (`packages/core/src/capabilities`): definitions, status gating, flags, and the executor (`runCapability(name, ctx)`), with the `capability_flags` migration and repository.
3. **History steps:** `append_chat_turn` with `p_steps` (replacing the M1b function), repository, and pgTAP/integration tests.
4. **Answerer tool loop and guardrails:** the loop in `createClaudeAnswerer`, `finalizeReply` account rules, orchestrator passing the account context and tools.
5. **API wiring and local smoke test** with mock Magicline and the fake answerer, extended to call a tool.
6. **Evals:** logged-in cases per synthetic profile (run still pending spend approval).
7. **Docs and review.**

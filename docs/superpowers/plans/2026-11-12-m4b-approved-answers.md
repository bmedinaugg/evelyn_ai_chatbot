# M4b Approved Answers (Scenarios) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support staff write **approved answers** (scenarios) in Dutch and English. An approver
publishes them after a side-by-side replay, every version is kept and can be put back, and the
bot shows the approved text word for word whenever one fits the customer's question.

**Decisions (product owner, 2026-11-12):**
- **Exact approved text:** Claude only decides *that* an approved answer fits. The server shows
  the approved nl/en text verbatim, the same way the fixed texts work today.
- **Four eyes:** anyone with a portal role writes drafts. Only an approver or admin publishes,
  and never a version they wrote themselves. Rollback (re-publishing an earlier version) follows
  the same rule.
- **Side-by-side replay:** the reviewer picks a flagged conversation and the portal re-asks its
  customer questions with the draft included. This uses the real Claude (about $0.002–0.01 per
  replay) and the mock Magicline for account questions. The reviewer sees the old answers next
  to the new ones and judges them. An automatic LLM judge comes later (M5).

**Architecture:**
- **Data:**
  - **`scenarios`**: id, created, archived.
  - **`scenario_versions`**: **immutable content**. Fields: trigger examples nl/en (1–10 each),
    answer nl/en (both required, ≤ 1,200 characters, plain text), optional member statuses
    (empty = everyone, including people who aren't logged in), optional linked FAQ article,
    author, created, and status (`draft` | `published` | `superseded` | `withdrawn`).
  - **At most one published version per scenario** (partial unique index). Status changes happen
    only through SQL functions:
    - `publish_scenario_version(version, actor)` refuses the version's own author, refuses
      archived scenarios, supersedes the previous published version and writes the audit row in
      one transaction.
    - `archive_scenario`.
- **Retrieval:** `search_scenarios(query, lang, limit 3)` over the **published** versions'
  trigger examples, ranked by rare words (IDF) like `search_faq`.
- **Prompt:** an `<approved_answers>` block carries the id, trigger examples and answer text,
  escaped and marked as data. The system prompt says to set `approvedAnswerId` only when one
  answers the question fully.
- **Answer schema:** gains `approvedAnswerId: string | null`.
- **Guardrails** (`finalizeReply`). The approved text is used only when the id is among *this
  turn's* retrieved scenarios. Then the status condition is checked:
  - no condition: show it;
  - not logged in: the `login` action, the same as account questions;
  - logged in with the wrong status: the normal `noMatch` hand-off.

  When the approved text is used: text = the approved answer in the reply language, citation =
  the linked article when it exists, outcome `answered`. The stored message gets
  `scenario_version_id` for metrics (M5).
- **Replay** (core): `replayConversation(deps, {questions, lang, status, draftVersionId})`.
  - **No storage:** it answers the conversation's customer questions in order with an in-memory
    history and stores nothing.
  - **Account data:** account tools run against the **mock Magicline** with the synthetic
    profile matching the original status. Replay is available only where
    `MAGICLINE_USE_MOCK=true` (local, preprod) and is refused elsewhere.
  - **Limits:** at most 10 questions; replay outputs are masked like transcripts.
- **Portal API:**
  - `GET /portal/api/scenarios`
  - `GET /portal/api/scenarios/:id` (versions)
  - `POST /portal/api/scenarios` (new scenario + first draft)
  - `POST /portal/api/scenarios/:id/versions` (new draft)
  - `POST /portal/api/scenario-versions/:id/publish` (approver/admin, not own)
  - `POST /portal/api/scenarios/:id/archive` (approver/admin)
  - `POST /portal/api/conversations/:id/replay {versionId}` (rate-limited per agent, audited)
  - Every change is audited (`scenario.create`, `scenario.publish`, `scenario.archive`,
    `scenario.replay`).
- **Portal app:**
  - an "Approved answers" page (list, editor with nl/en side by side, version history,
    publish/rollback/archive with the four-eyes rule visible);
  - a "Test with a draft" panel on the conversation page (old and new answers side by side).

**Spec:** `docs/ARCHITECTURE.md` §1 (custom answers, simulate before publishing), §3.6
(improvement loop), §4, §5; `CLAUDE.md`.

## Global Constraints
- **Text:** approved answers are plain text (never HTML or links); citations come only from the
  linked active FAQ article.
- **Safety:**
  - scenario content is staff-written but still escaped in the prompt;
  - a scenario never bypasses the account rules: status conditions are checked server-side,
    never by Claude;
  - replay never uses real Magicline keys and never writes to conversations.
- **Retention and logging:** scenario text holds no customer personal data (an editor hint);
  logs carry ids and counts only.
- **Text:** all new user-facing texts in nl and en.
- **Evals:** add synthetic scenarios to the fixtures plus 4 eval cases (nl/en, status-gated). The
  paid run needs approval.
- **Commits:** branch `m4b-approved-answers`.

## Review Focus
1. **Unapproved text:** a model-written answer can never be shown as "approved". Only the
   retrieved, published version's own text appears, and a forged or unretrieved
   `approvedAnswerId` falls back to the normal path.
2. **Four eyes:** the author cannot publish or roll back their own version, including through a
   direct API call.
3. **Status gating:** a members-only answer never reaches a prospect or someone who isn't logged
   in.
4. **Immutability:** a published version's text cannot change; edits always create a new version.
5. **Replay:** it stores nothing, uses only the mock Magicline, respects the question limit and
   rate limit, and its output is masked.

## Tasks
1. **DB:** scenarios, versions, publish/archive functions (four eyes), `search_scenarios`,
   `messages.scenario_version_id`, audit actions; repository, pgTAP and integration tests.
2. **Core answering:** retrieval, prompt block, `approvedAnswerId`, guardrail (verbatim plus
   status gating), store the version id; eval fixtures and cases.
3. **Core replay:** `replayConversation` (no storage, mock-only, limits).
4. **Portal API:** scenario routes, publish (four eyes), archive, replay; tests.
5. **Portal app:** Approved answers pages and the replay panel (nl/en); e2e.
6. **Docs, ARCHITECTURE, final review.**

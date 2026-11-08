# Handoff: observer v2, planner, actor-v2 integration, practice UI, agent lab

## Where things are

- **Repo / worktree:** `/Users/parthmodi/Desktop/Programming/Claude/scamper-engine`
- **Branch:** `scamper/planner`, built on top of `scamper/observer`. HEAD is `8b75693`.
- **Remote:** nothing is pushed.
- **Codex's actor work:** merged from `codex/actor-v2` @ `f5a5e36` (merge commit `df8585c`).
- **Detailed reports:**
  - `docs/agents/observer_agent/status.md`
  - `docs/agents/planner_agent/status.md`
  - `src/server/actor/README.md` (Codex's actor handoff)

## What was built

### 1. Observer v2 (from the planner handoff addendum)

- **New assessment fields:**
  - `openIssues`: questions or ambiguities the user raised, each with exact quotes.
  - `issueAcknowledgments`: the user saying an addressed question was answered.
  - `condition.kind`: what the user's condition is about.
  - `verificationObservations[].claimedResult`: what the user *claims* a check showed. This is a claim, never a server fact.
- **Conversation scope:** before any request exists, the observer still runs. `requestId` is null and the decision is forced to `unclear`.
- **Versions:** the rubric and schema are now v2. Old v1 records are converted only when read from the database.
- **Server-owned question tracking:** the server creates question records and their ids. A question is marked *addressed* only when a reply is actually saved. It is marked *resolved* only by a validated user acknowledgment, or when verification completes and that verification was explicitly linked to the question.

### 2. Session lifecycle

| Area | Behaviour |
| --- | --- |
| Stages | `active`, `verifying`, `awaiting_final_decision`, `ended` |
| Outcomes | `defense_demonstrated`, `safely_disengaged`, `simulated_exposure`, `inconclusive`, `technical_interruption` |
| Endings | The first terminal event wins. Anything submitted after the end is rejected with 422 and logged as `event_rejected_after_end`. |
| Verification | `official_verification_started` → `official_verification_cancelled` or `official_verification_completed`. Completing needs the challenge id issued at start. The result text is decided by the server. |
| Final decision | Reject and report, or Proceed (which creates the request if needed) → confirmed share. |
| Practice code | Generated per session on the server. The client must submit that exact code to share it. |
| Stop request | A clear "stop the exercise" message ends the session. A bare "stop" asks for confirmation and generates nothing. |
| Limits and retries | 12 user turns. One retry after a failed reply; a second failure ends the session as `technical_interruption`. |

### 3. Planner (`src/server/planner/*`)

- **Scenario:** `mobile-code-01`, with facts F01–F05. F06, the official result, is never given to the planner or actor. The two reserved additions are the case reference and the team label.
- **Pure rules:** `derivePlanningContext` and `getEligibleCandidates` apply priorities P0–P11 plus repetition exclusions. Candidates are created by the server and bind the action, move, tool and constraints.
- **Plan checks:** `validatePlan` checks schema, revision, that the candidate was offered, references, facts and additions, style, and content-focus guards.
- **Model calls:** `runPlanningTurn` is planner-only: at most 2 calls (one repair), and a transport failure is never retried.
- **Retries:** `reusePlan` lets a retry reuse the earlier plan if the same candidate is still allowed.

### 4. Actor v2 integration (`src/server/actor/controller.ts`; Codex owns the rest of `src/server/actor/`)

- **Flow:** planner → `assembleActor` → `runActor` (at most 2 calls) → `commitActorResponse(StoreActorCommitPort)`.
- **Saving:** the port uses the existing all-or-nothing `ObserverStore.commitPlan`. It writes the message, any request card plus its `request_presented` event, new additions, and the target question marked addressed. Actor audit data is saved on the plan record as `actorAudit`.
- **Cancellation:** an in-process abort per session.
- **Old path:** the old actor code was removed, so it can never run alongside v2.
- **Production model:** `actorModelFromEnv()` (native `json_schema`).

### 5. Persistence

- **Store:** Postgres via Prisma is the only store of record.
- **Migration:** `20261107200636_planner_lifecycle`, applied to the dev and test branches only. It adds the issue, addition and planner-record tables, session stage/outcome/secret columns, an event detail column, event ordering (`seq`), and makes the assessment's `requestId` nullable.
- **Concurrency and duplicates:**
  - one leased processing claim per session;
  - a revision check before every save;
  - each input saves at most one reply (enforced by the unique `committedKey`);
  - stale drafts are kept for audit and never rerun automatically.

### 6. UIs

- **`/practice`:** a minimal product page. It has the request card with a cancelable share confirmation, verification, the final decision, End practice, the stop confirmation, and the retry notice. It resumes after a page refresh.
- **`/agent-lab`:** a developer page. The left half is chat. The right half is a trace of each step for every input: observer input, raw model calls (prompt and raw output), observer output, eligibility, planner input and plan, actor input and result, and whether the reply was saved.
  - The trace is kept in memory only.
  - It is enabled only under `pnpm dev` or with `AGENT_DEBUG=1`.
  - It is served at `GET /api/observer/sessions/[id]/trace` and checks the session owner.

### 7. HTTP routes

All routes are under `/api/observer/sessions/[id]`:
- `messages`
- `events`
- `process`
- `assessments`
- `planner` (the handoff plus eligibility)
- `plans`
- `retry`
- `trace`

## Verified (real commands, real results)

| Command | Result |
| --- | --- |
| `pnpm check` | lint clean, typecheck passes, **681/681** tests (includes Codex's 138 actor tests) |
| `pnpm test:integration` | **29/29**: production build plus API and browser tests on the Neon test branch |
| `bash scripts/observer-demo.sh` on `next start` | full flow works; ends in `defense_demonstrated` |

- **Mutation checks:** six deliberate breakages of key guarantees were each caught by the tests.
- **Bugs found and fixed:**
  - A NUL character in the question dedupe key silently rolled back assessments on Postgres only.
  - The eval release gate could pass when every reply was rejected.
  - A failing trace sink could break model calls.

## Not verified / blocked

- **Live models:** no `MODEL_*` credentials. `pnpm observer:eval` and `pnpm planner:eval` exit 2 (blocked). Real-model behaviour is unmeasured.
- **Fixture models:** all HTTP and browser tests use labeled fixture models (`E2E_TEST=1 OBSERVER_MODEL_MODE=fixture`), so they prove the wiring, not model quality.
- **Eval sets need human review:** the gold labels and acceptable moves were written by Claude. That covers 46 observer cases, 23 planner contexts, and Codex's 21 actor cases.

## Known decisions and limits

- **No phrase screening in actor v2:** Codex's actor checks destinations, formatting, secrets, limits and reserved details only. A draft containing a threat or fee can be delivered. The planner eval still flags it. Decide whether to add a hard check (it would trigger the single repair).
- **No LangGraph:** it isn't installed and the brief says to use it only where present. Orchestration is an explicit bounded state machine.
- **Cancellation is per process:** across server instances, stale drafts are still discarded at the revision/claim gate when saving.
- **Verification refresh:** reloading the page during verification loses the browser's challenge id, so the user must cancel and restart.
- **Double acknowledgment:** a typed refusal followed by declining the card gets two acknowledgments, one per piece of evidence, as the spec allows.

## How to run

- **Dev without credentials:** `E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev`, then open `/agent-lab` or `/practice`.
- **Live:** set `MODEL_BASE_URL`, `MODEL_API_KEY` and `MODEL_ID` in `.env.local`. Optionally set `PLANNER_MODEL_ID` and `ACTOR_MODEL_ID`. Then run `pnpm planner:eval` and `pnpm observer:eval`.
- **Repo rules** (`CLAUDE.md`):
  - never run `migrate reset` or `db push`;
  - don't read env files;
  - never edit `visual-design/**`, `src/generated/**`, applied migrations, or `tests/helpers/owned-resource.ts`.

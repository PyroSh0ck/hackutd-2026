# Planner agent + observer addendum: implementation status

Branch `scamper/planner` (from `scamper/observer` @ `9b8128d`). Briefs (copied unchanged from the main checkout):
`planner-agent-claude-implementation-brief.md`, `observer-planner-handoff-addendum.md`.

Commits: `8f8387a` (addendum, lifecycle, planner core, migration) · `7c3394a` (API spec rewrite) · `cc9c604`
(Postgres NUL fix) · `303cd7b` (planner S1–S5 tests) · `28c0dd9` (practice UI + E2E) · `efae8a9` (eval + runner + demo).

## Stage 0: inspection

- **Stack:** Next.js 16.4, Zod 4.6, Prisma 7.10 + Neon, Vitest 5, Playwright 1.64.
- **Structured output:** reuses the observer's OpenAI-compatible forced-tool-call adapter. It is plain `fetch`, so there are no SDK retries.
- **Models:** no model endpoint is configured here.
- **No LangGraph**, for the same reason as the observer: it isn't installed, and the brief allows it only "where present". Orchestration is an explicit bounded state machine. Postgres is the only store of record.
- **Baseline at `9b8128d`:** `pnpm check` 394/394, `pnpm test:integration` 27/27.

## Stage results (each gate run; failures fixed and rerun)

| Stage | Evidence | Failures found and fixed |
| --- | --- | --- |
| Addendum schemas/rubric/validation | `tests/unit/planner/schemas.test.ts` 14/14; all observer unit tests still pass, with fixture stubs updated to the strict v2 shape | — |
| 1 Contracts | the same file: strict Plan, ActorOutput, Candidate and event schemas | — |
| 2 Context + eligibility | `eligibility.test.ts` 35/35 (every priority row P0–P11 plus the brief's overlaps) | — |
| 3 Planner adapter/validation/loop | `planner-run.test.ts` 30/30 (exact 0/1/2 call counts per path) | Test setup error in the injection case (fixture phrase), fixed in the test |
| 4 Actor boundary | `actor.test.ts` 20/20 | — |
| 5 Persistence/lifecycle | `session.test.ts` 27/27; `tests/api/observer.spec.ts` 7/7 on Neon | **Postgres-only bug:** the issue dedupe key contained `\u0000`, which Postgres text rejects, so assessments carrying issues rolled back. Key is now JSON-encoded |
| 6 E2E flows | `session.test.ts` flows; `tests/e2e/practice.spec.ts` 2/2 | Lint (`set-state-in-effect`) in the page, fixed |
| 7 Eval | `eval.test.ts` 29/29 (data and wiring); `pnpm planner:eval` → **BLOCKED (exit 2)** | The gate passed when every message was rejected; added a minimum prepared rate |

**Mutation checks.** These were removed one at a time; each was caught by at least one test:
- the open-issue gate;
- the commit revision check;
- the pause during verification;
- the unauthorized-request check;
- the no-automatic-rerun-of-stale-plans rule;
- the fallback gate.

**Final runs.**

| Command | Result |
| --- | --- |
| `pnpm check` | lint clean, typecheck pass, 552/552 (22 files) |
| `pnpm test:integration` | 28/28: 10 game API, 7 practice API, 4 auth, 4 UI, 1 game E2E, 2 practice E2E |
| `bash scripts/observer-demo.sh` on `next start` | exit 0 |

Migration `20261107200636_planner_lifecycle` is applied to the dev and test branches only.

## Completion report (brief §13)

### 1. Files

**Contracts**
- `src/contracts/planner.ts`: new.
- `src/contracts/observer.ts`: v2 assessment and input; session stage, outcome, request status and issue records; v2 handoff; session view; retry.

**Planner** (`src/server/planner/`)
- `scenario.ts`, `stop-intent.ts`, `context.ts`, `eligibility.ts`, `validate.ts`, `prompts.ts`, `actor.ts`, `run.ts`, `input.ts`, `testing/fixture-models.ts`.

**Observer** (`src/server/observer/`)
- `state.ts`: lifecycle, events, conversation scope, issue lifecycle.
- `service.ts`: observer → turn limit → planner pipeline; stop gate; retry; audit.
- `evidence.ts`, `rubric.ts`, `prompts.ts`, `review.ts`, `planner-input.ts`, `model.ts`, `run.ts`.
- `history.ts`: v1 records normalized on read.
- `store/*`: issues, additions, plans, `commitPlan`.
- `runtime.ts`, `testing/fixture-model.ts`.

**Routes and schema**
- Routes: `…/[id]/planner` (handoff + eligibility), `…/[id]/plans`, `…/[id]/retry`.
- `prisma/models/observer.prisma` + the migration.

**UI**
- `src/app/practice/page.tsx`, `src/features/practice/practice-experience.tsx`.

**Scripts and config**
- `scripts/planner-eval.ts`, `scripts/observer-demo.sh`, `package.json` (`planner:eval`), `.env.example`.

**Tests**
- `tests/unit/planner/*`, `tests/planner/eval/*`, `tests/unit/observer/*` (ported), `tests/api/observer.spec.ts`, `tests/e2e/practice.spec.ts`.

### 2. Model config (no secrets)

- **Shared provider:** the same env as the observer (`MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_ID`).
- **Optional overrides:** `PLANNER_MODEL_ID`, `ACTOR_MODEL_ID`, `PLANNER_TIMEOUT_MS` (default 20000).
- **Mode:** forced tool call, or `json_schema`.
- **Test-only fixtures:** fixture planner/actor are used only when `E2E_TEST=1` and `OBSERVER_MODEL_MODE=fixture`.
- **Not verified against a real endpoint.**

### 3. Call budgets

| Path | Calls |
| --- | --- |
| Per successful processing attempt | observer ≤3, planner ≤2, actor ≤2 |
| Normal | observer 1–2 + planner 1 + actor 1 |
| Wait, final-decision, verification, stop and terminal paths | 0 planner/actor calls |

- **Guards:** hard-coded limits in `runPlanningTurn` and `runObserver`.
- **Failures:** timeout, refusal or unavailable means no repair. A failed turn records a neutral `planning_failed` notice and mutates nothing else. One user retry is allowed; a second failure ends the session with `technical_interruption`.

### 4. Persisted-state strategy

**Storage**
- Postgres is the only store of record.
- Append-only: messages, events, assessments, plan records.
- Current views: session `stage` and `outcome`, issue status, addition introduction.

**Revision and claim**
- One leased processing claim per session, valid across instances.
- `revision` changes on every append, applied assessment and committed plan.
- Models run with no transaction open.

**Commit**
- `commitPlan` is one transaction. It requires the claim, `revision === basedOnRevision`, and stage `active`.
- It writes the assistant message, the request + `request_presented` event (when authorized), the target issue marked addressed, and introduced additions.
- The unique `committedKey` allows one committed response per input.
- Otherwise the draft is stored `stale`. Stale drafts are not rerun automatically.

**Crash recovery**
- A `prepared` record left by a crash is committed on resume without new model calls if nothing changed; otherwise it is audited as stale.

### 5. Exact outcomes

| Event | Outcome |
| --- | --- |
| End practice, or a clear textual stop | `safely_disengaged` |
| Report/block, or reject/report after completed verification | `defense_demonstrated` |
| Confirmed submission of the server's practice code | `simulated_exposure` |
| 12th user message assessed | `inconclusive` |
| Second planning failure for the same input | `technical_interruption` |

- **First terminal event wins.** Later inputs are rejected and audited (`event_rejected_after_end`).
- **Non-terminal:** a rejection alone, verification intent, and acceptance without action. Cancelling verification returns to `active` without generating a message.

### 6. Addendum integration

- **Conversation scope:** before the request exists, assessments run with `requestId` null and the decision forced to unclear.
- **Issues:**
  - created only from applied accepted/corrected assessments;
  - ids assigned by the server;
  - deduplicated exactly (no semantic matching);
  - marked addressed only by a committed opponent message;
  - resolved only by a validated acknowledgment, or when verification completes and the issue was explicitly linked to its launch (procedure issues only).
- **Claimed results** are textual claims and never server facts.
- **v2 output** has no defaults. **v1 history** is normalized only on read.

### 7. Blocked or unverified

- **Live planner/actor evaluation:** blocked (`pnpm planner:eval` exit 2). Against a local stand-in provider wrapping the fixture models, the runner completed 23 cases and 3 exercise paths. That validates plumbing, not model quality.
- **Live observer evaluation:** still blocked.
- **Human review needed:** the eval cases and acceptable-move sets were written by Claude.

### 8. Limitations

- Regex screens catch obvious forbidden forms; semantic drift can pass them.
- `usedFactIds` reported by the model are not proof of anything.
- The objection and fact-topic gates are English keyword lists. They only add candidates or select the acknowledge-unknown form.
- A refusal followed by a card rejection gives two acknowledgments, one per piece of refusal evidence as specified.
- **Verification refresh:** reloading during verification loses the browser's challenge id; the user must cancel and restart verification.
- **Observer retry:** the optional observer retry button after a fallback is not built (P2 waits).
- **Small set:** a 23-case set is not proof of reliability. No susceptibility or fraud-efficacy claims are made.

### 9. Demo

**Browser (fixture models):**
```
pnpm build
E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm exec next start --port 3005
```
Then open `/practice`.

**Over HTTP:**
```
bash scripts/observer-demo.sh http://localhost:3005
```
Verified output: identity answered (`P3 answer_identity`) → request card (`P10`) → refusal acknowledged (`P5`) → card declined, acknowledged → verification shows the official result → `awaiting_final_decision` → reject and report → `defense_demonstrated`.

**Live:** set `MODEL_*` in `.env.local`, then `pnpm planner:eval` and `pnpm dev`.

## Actor v2 integration (Codex `codex/actor-v2` @ `f5a5e36`, merged)

**Wired.**
- **Planner step:** `runPlanningTurn` is now planner-only (≤2 calls). It returns an accepted plan and the server-bound `ActorInstruction`.
- **Actor step:** the controller runs Codex's `runActor` (≤2 calls), then `commitActorResponse` through `StoreActorCommitPort` (`src/server/actor/controller.ts`).
- **Old path removed:** the old actor prompt, validator and context helper (`src/server/planner/{actor,prompts,input}.ts`) are gone, so the two paths can never both run.
- **Production model:** `actorModelFromEnv()` (native `json_schema`, optional `ACTOR_MODEL_ID`).

**Commit port.**
- **Transaction:** `commitValidated` maps onto the existing atomic `ObserverStore.commitPlan` (Postgres and memory). It checks the claim and its expiry, revision equality (so the plan still applies), active stage, and the unique committed response per input. It writes the message, the authorized request with its `request_presented` event, newly introduced additions, and the selected issue as *addressed*. It saves the committed plan with `actorAudit` (versions, processing-attempt id, privacy-safe `ActorAttemptRecord`s, style metrics).
- **Replay lookup:** `findCommitted` is an owner-scoped lookup that ignores claim expiry and revision.
- **Ownership:** rechecked in `commitValidated`.
- **Never persisted:** the model-bound `ActorInput` and rejected drafts.

**Execution state.** `readState` reloads the session and reports:
- the claim, including its expiry;
- revision and stage;
- whether the plan applies: the stored plan is still `prepared` at the same revision, and its candidate is still eligible.

**Cancellation.**
- **In-process:** an `AbortController` per session is aborted by any new message or event (stop, verification, rejection).
- **Cross-instance:** relies on Codex's post-call gates and the commit transaction.

**Durable explicit retry.**
- **Retry id:** a retry is the existing `planning_retry_requested` event plus an idempotency receipt. It runs a new processing attempt (`processingAttempt: 2`, new `processingAttemptId`, new claim).
- **Plan reuse:** the earlier accepted plan is reused with no planner call only if the same server candidate (move, target, focus, tool, constraints) is still eligible. It is re-validated against the current input; otherwise the planner runs afresh.
- **Replays:** replaying the same retry key starts no new attempt.
- **Second failure:** ends the session as `technical_interruption`.
- **Notice:** shown with the exact `ACTOR_FAILURE_NOTICE` text in `/practice` and `/agent-lab`.

**Crash handling.**
- **Database error during commit:** rolled back; becomes a technical notice and one retry.
- **Process crash after the draft was stored:** resumes and commits without new model calls if nothing changed, otherwise audited stale. A plan whose actor never finished is not rerun.

**Tests.**

| Check | Result |
| --- | --- |
| `pnpm check` | 681/681, including Codex's 138 actor tests unchanged |
| `pnpm test:integration` (Neon test branch, production build) | 29/29 |
| `bash scripts/observer-demo.sh` on `next start` | exit 0 |

- **New or updated:** controller assembly and privacy, execution state, plan reuse, durable retry with idempotent replay, actor failure leading to interruption, crash resume, and the agent-lab trace (`actor.input` / `actor.result`).
- **Production build:** Codex's environment was blocked (Turbopack port permission, missing `.env.test.local`). Here the build succeeded as part of `pnpm test:integration`.

**Behavior change to note.** Actor v2 has no runtime threat/fee/new-request word screening. That is deliberate in Codex's design: it validates destinations, format, known secrets, limits and reserved literals only. A draft like "suspended within 10 minutes unless you pay the $50 fee" is now deliverable at runtime. The planner eval's screens still flag it, and its gate fails on it. Live semantic fidelity remains unmeasured (no credentials).

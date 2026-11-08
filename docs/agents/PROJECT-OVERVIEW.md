# SCAMPER: project overview for planning

This describes the code on branch `scamper/spacetime` of the `scamper-engine` repo (HEAD `d564fd6`, as of 2026-11-07). It covers what the product is, what it can do today, how it works, how it is tested, and what is not done. Everything below reflects code that exists. Unverified items are marked as such.

---

## 1. What SCAMPER is

SCAMPER is a **consent-based scam-awareness practice app**. The user chats with a simulated "customer support" sender inside a clearly labeled simulation. The sender is driven by AI agents, and the user practices deciding how to respond.

The skills it trains:
- asking questions;
- verifying independently through an official channel the user finds themselves;
- refusing or reporting;
- not handing over a one-time code.

It is not a chatbot demo. The core is a **rule-governed training engine**:
- Deterministic server rules decide what the opponent may do, when the conversation pauses, and what the outcome is.
- AI models only interpret the user (observer), choose among server-permitted moves (planner), and write the opponent's text (actor).
- A model can never invent an outcome, complete verification, or overwrite a user decision.

**Current scenario (only one): `mobile-code-01`.**
- **Sender:** "Avery from Cedar Account Support". Cedar Mobile is a fictional carrier. The sender claims a security check on the "practice line ending 0142".
- **Goal of the sender:** get the user to share a fictional 6-digit **practice code** through an in-app request card.
- **Ground truth:** the official result ("F06") says Cedar Mobile did **not** initiate this conversation, so the code should not be shared. That fact is hidden from the planner and actor. The user sees it only through the app's "official support check".
- **Fact catalog:** F01–F05 are the facts the opponent may use. There are two reserved "additions": a case reference `CD-######` and the team label "Account Review".
- **Turn limit:** 12 user turns.

Because only a suspicious scenario exists, the UI does **not** claim that some messages are legitimate.

---

## 2. Where the code is

| Item | Value |
| --- | --- |
| Main repo / worktree | `/Users/parthmodi/Desktop/Programming/Claude/scamper-engine` |
| Current branch | `scamper/spacetime`, which builds on `scamper/magenta-ui`, which builds on `scamper/planner`, which builds on `scamper/observer` |
| Public GitHub repo | `PyroSh0ck/hackutd-2026` (`main`, 4 commits) contains everything **up to and including the Magenta UI** (`scamper/magenta-ui`). The SpacetimeDB/Nemotron work (`scamper/spacetime`, 4 commits) is **local only, not pushed**. |
| Excluded from GitHub | `trials/` (starter-harness experiment results/transcripts) |
| Stack | Next.js 16 (App Router, Cache Components), React 19, TypeScript, Zod 4, Prisma 7 + Neon Postgres, Better Auth, Vitest 5, Playwright, SpacetimeDB 2.14.1 (TypeScript module), OpenAI-compatible model API (intended: NVIDIA Nemotron) |

Repo rules (`CLAUDE.md`):
- Never run `prisma migrate reset` / `db push`.
- Don't read env files.
- Never edit `visual-design/**`, `src/generated/**`, `generator/manifest.json`, applied migrations, or `tests/helpers/owned-resource.ts`.
- Route handlers use the shared route helpers.
- Contracts in `src/contracts/*` are the single source of request/response truth.

---

## 3. What a user can do today

### `/scamper`: the main product UI ("Magenta Modern" design)

**Layout**
- Three columns on desktop: navigation with a temporary mascot badge, the conversation, and a "Practice details" panel.
- Tablet: the details panel becomes a drawer.
- Mobile: a top bar with a menu, and the details panel becomes a sheet.

**Navigation:** Home, Practice, Case history, Resources.

**Practice flow**
1. **Ready screen**, then "Begin practice". This creates a session; the opponent's opening message appears.
2. **Chat.**
   - Enter sends; Shift+Enter adds a new line.
   - Typing dots show only while a real request is running.
   - Messages are plain text (no HTML, no clickable links).
   - The draft is kept on failure, and double-send is prevented.
3. **Request card.** When the planner decides to "present the request", a **simulated request card** appears inline. Share practice code needs a confirmation dialog; Decline is the other option. Typing "I accept" in chat does **not** submit anything.
4. **Official support check** (dialog, separate from the chat):
   1. Open it.
   2. **Run check.** This pauses the conversation, and the server releases the official result plus a challenge id.
   3. "I have read this result" (needs the challenge id).
   4. **Final decision:** Report/block and end, or Proceed (simulated). Proceeding then allows sharing via the request card.
5. **End practice**: available at any time, including while a reply is generating.
   - A clear typed stop ("stop the exercise") ends the session.
   - An ambiguous "stop" asks for confirmation.
6. **Technical failure:** a neutral notice with one retry. A second failure ends the session as `technical_interruption`.
7. **Review page.**
   - Shows the server-decided outcome, evidence cards (exact quotes plus recorded actions), the official result, the full transcript, and Try again / Back to Home.
   - A **"How this session worked"** panel shows what actually ran: backend, models, observer decisions, planner protocol, tool calls with call ids, committed ids, revision and outcome. It never shows reasoning. It is available only after the session ends.

**Other pages**
- **Case history / Home summary:** built from session ids this browser started, because there is no "list my sessions" API. Each session is re-read from the server, which enforces ownership.
- **Resources:** the FTC "What To Do if You Were Scammed" link and general guidance.

### Other routes
| Route | What it is |
| --- | --- |
| `/practice` | Earlier minimal practice UI (same backend; kit components). |
| `/agent-lab` | **Developer tool.** Left: a chat. Right: a per-input trace of every agent step (observer input, raw model calls, observer output, eligibility, planner input/plan, actor input/result, commit). Enabled only in `pnpm dev` or with `AGENT_DEBUG=1`; in-memory. |
| `/play`, `/` | An older, separate "Scamper game" prototype (bank-alert scenario, event-sourced game engine, fixture storyboard). Not part of the current practice pipeline. |
| `/sign-in`, `/sign-up`, `/playground` | Starter auth pages and the component gallery. |

Practice sessions are owned by an anonymous **signed player cookie** (`playerRoute`), not a Better Auth login.

---

## 4. Architecture

```
Browser (/scamper, /practice, /agent-lab)
   │  fetch, JSON; owner = signed player cookie
   ▼
Next.js route handlers  /api/observer/sessions/...
   │
   ▼
ObserverService (src/server/observer/service.ts)        ← orchestration only
   │  sends COMMANDS (create, message, event, retry, claim, applyAssessment,
   │  savePlan, commitPrepared, turnLimit, technicalFailure)
   ▼
TrainingBackend (src/server/engine/backend.ts)
   ├─ StoreBackend   → Postgres (Prisma) or in-memory store; rules run in Node
   └─ SpacetimeBackend → HTTP → SpacetimeDB module (spacetime/), where the rules run
                          inside one transaction
Shared rules (pure, no Node imports): src/server/engine/{decide,ops,commands}.ts,
 plus src/server/observer/state.ts and src/server/planner/{context,eligibility,validate,stop-intent,scenario}.ts
```

**One authority per deployment.**
- `TRAINING_BACKEND=spacetime` makes the SpacetimeDB module the **only** place state transitions are decided and stored. If it is unreachable, nothing changes; there is no Postgres fallback.
- Unset means Postgres.
- The **same rule code** runs in both. The module bundles `src/` files directly through `@/` path aliases.

### Per-user-message pipeline (ObserverService)
1. **Commit the input** (backend command). This step:
   - checks ownership;
   - checks the idempotency receipt (same key plus a different payload gives a 409);
   - applies the gate (ended, paused for verification/decision, pending stop confirmation, turn limit);
   - detects stop intent: a clear stop ends the session with `safely_disengaged` in the same commit.
2. **Claim** the session: a leased processing claim, one processor at a time.
3. **Observer** (models run with no transaction open). It classifies the user's latest message against the rubric and produces an assessment, which is applied atomically **only if** the claim is still held and the conversation revision is unchanged; otherwise it is recorded as stale.
4. **Turn limit:** if reached, the session ends as `inconclusive`.
5. **Planning.**
   - Deterministic **eligibility** computes the allowed candidate moves. With none, the result is "wait" or a controller action and there is no model call.
   - The **planner** picks one candidate and a plan.
   - The **actor** writes the opponent message.
   - An **atomic commit** writes the message, an optional request plus its `request_presented` event, the addressed issue, and newly introduced additions.
6. **Release** the claim; re-check for work that arrived meanwhile.

Any later user input or UI event bumps the revision and aborts in-flight generation (an in-process AbortController). A late actor result is then rejected at commit time (stale), and never retried with a fresh revision.

---

## 5. Domain model and rules

**Session fields:**
- identity: `id`, `ownerKey`, `threadId`, `scenarioId/Version`;
- versioning: `revision` (bumps on every change), `conversationRevision` (bumps when messages/requests change);
- progress: `turn`;
- lifecycle: `stage`, `ended`, `outcome`;
- server secrets: `practiceCode`, `caseReference`;
- processing: `claim {id, expiresAt}`.

**Stages:** `active`, `verifying`, `awaiting_final_decision`, `ended`.

**Outcomes:**

| Outcome | Set when |
| --- | --- |
| `defense_demonstrated` | The user rejects or reports. |
| `safely_disengaged` | The user ends the practice or stops. |
| `simulated_exposure` | The user shares the code via the card. |
| `inconclusive` | The turn limit is reached. |
| `technical_interruption` | The second planning failure occurs. |

The first terminal event wins. Later inputs are rejected with 422 and audited as `event_rejected_after_end`.

**Client events (UI actions):**
- request: `practice_code_submitted`, `request_rejected`;
- verification: `official_verification_started`, `official_verification_cancelled`, `official_verification_completed` (requires the challenge id issued at start);
- final decision and stop: `final_decision_proceed`, `stop_confirmation_dismissed`;
- endings: `conversation_reported`, `conversation_ended`;
- legacy/other action types: `simulated_link_opened`, `practice_account_details_submitted`, `simulated_payment_started`, `simulated_payment_approved`.

**Server-only events:** `request_presented`, `stop_confirmation_requested`, `turn_limit_reached`, `planning_failed`, `planning_retry_requested`, `technical_interruption`, `event_rejected_after_end`, and the legacy `official_directory_opened`.

**Request status (derived):** `not_presented`, `pending`, `rejected`, `completed`. Only the explicit, confirmed card action can complete it.

**Issues** are user questions or ambiguities the observer finds, with exact quotes. Their ids are created on the server.

| Status | How an issue gets there |
| --- | --- |
| open | Created when the observer finds it. |
| addressed | Only when an opponent message that targets it is **committed**. |
| resolved | Only by a validated user acknowledgment, or by a completed verification explicitly linked to a procedure issue. |

**Additions:** the reserved case reference and team label. Each is introduced at most once, then reused verbatim.

**Plan records** are the audit trail per planning attempt.
- Statuses: `prepared`, `committed`, `rejected`, `stale`, `failed`.
- Contents: the candidate snapshot, proposed/accepted plan, validation attempts, actor instruction/output, actor audit (attempt records, style metrics), planner protocol, and tool-call audit.
- One input can commit at most one reply (unique committed key).
- A durable retry may **reuse** the earlier plan if its candidate is still eligible.

**Idempotency:** every input has a client `idempotencyKey`, stored as a receipt with a payload hash. The practice code is checked but never hashed or stored in the receipt.

---

## 6. The agents

All model calls go through an OpenAI-compatible `/chat/completions` adapter (`src/server/observer/model.ts`). It has:
- forced function calling or `json_schema` for structured output;
- Nemotron handling: `/no_think` unless `MODEL_THINKING=on`, `<think>` stripping, and inline `<TOOLCALL>` parsing.

There are no SDK retries. Timeouts are bounded.

### Observer (`src/server/observer/*`)
- **Rubric `observer-rubric-v2`, schema `observer-schema-v2`.**
- **Output:**
  - the decision label (`refused`, `considering`, `conditional_acceptance`, `explicit_acceptance`, `unclear`) with **exact-quote evidence**;
  - verification behaviors with the user's *claimed* result (a claim, never a fact);
  - conditions (`condition.kind`);
  - open issues;
  - issue acknowledgments.
- **Scope:** "conversation" before a request exists (decision forced to `unclear`); "request" after.
- **Validation:** evidence quotes must match the transcript, plus scope invariants and duplicate checks.
- **Review:** deterministic **review flags** trigger a selective **reviewer** model call (policy `consequential_and_flagged`).
- **Failure:** the assessment falls back to `unclear`. An assessment can never create an action event.

### Planner (`src/server/planner/*`)
- **Context and eligibility** (`context.ts`, `eligibility.ts`): pure priority rules P0–P11 plus repetition exclusions.
  - They produce **server-built candidates**, each binding an action, `moveId`, target issue/request, tool intent and constraints (allowed facts, additions and styles).
  - Moves include, among others: `answer_identity`, `answer_procedure`, `present_code_request`, `continue_premise`.
  - Candidate ids are a stable 64-bit hash of (revision, move, request, issue, focus).
  - Results are `candidates`, `wait` or `controller`; only `candidates` calls the planner.
- **Plan validation** (`validate.ts`): schema, revision, candidate actually offered, references, facts/additions, style, content-focus guards.
- **Two protocols:**
  - **structured** (default): at most 2 calls (one repair); the model returns a plan.
  - **tools** (`PLANNER_PROTOCOL=tools`, `tool-run.ts`): the planner is a **function-calling agent** with two app-defined tools.
    - `get_training_context` re-reads the authoritative backend and returns the planner input: observer handoff, candidates, permitted facts. No hidden truth.
    - `execute_training_move` validates the plan, runs the actor, and calls the backend's atomic commit. The real result goes back under the provider's `tool_call_id`: committed message/request/event ids plus revision, or stale/failed.
    - Bounds: one context read, one move, one repair for invalid arguments, at most 3 model calls. It stops after the move; no extra "acknowledgement" message.
  - Both protocols share one execution step (`executePrepared` in the service).

### Actor v2 (`src/server/actor/*`, originally written by Codex)
- Writes the opponent message from a server-assembled `ActorInput` (instruction, permitted facts, UI control labels, evidence) and an envelope (session, plan, revision, processing attempt, claim, model).
- At most 2 calls (one repair).
- **Validation:** destinations, formatting, secrets (practice code, official result), word/question limits, reserved additions, style metrics.
- **Known gap:** there is no semantic phrase screening (threats, fees, new requests). The planner eval flags such drafts, but the runtime can deliver them.
- **Commit:** `commitActorResponse` goes through the `StoreActorCommitPort`, which delegates to `backend.commitPrepared`.

### Commit guard: the same code in Postgres and SpacetimeDB (`decideCommit`)
A commit happens only if **all** of these hold:
- the claim is held;
- `basedOnRevision` equals the current revision;
- the record is for the current input;
- the stage is active and the session is not ended;
- the **candidate is re-derived from the authoritative snapshot** (never taken from the caller's record);
- the output does not contain the practice code or the official result.

Otherwise the attempt is stale and nothing is written.

---

## 7. Persistence

### Postgres (Prisma, `prisma/models/observer.prisma`)
- **Tables:** observer sessions, messages, requests, events (with `seq`, `detail`, `challengeId`), assessments, issues, additions, plan records, receipts.
- **Migrations:** `add_observer`, `observer_request_order`, `planner_lifecycle`, plus the earlier auth and game migrations.
- **Branches:** applied to the dev and test Neon branches only.
- The store implements `ObserverStore` (`append` with CAS, `claim`/`release`, `applyAssessment`, `savePlan`, `commitPlan`).

### SpacetimeDB module (`spacetime/src/index.ts`, database `scamper-training`)
- **Private tables** (all private; no public views):

  | Group | Tables |
  | --- | --- |
  | Access | `worker` (admin/worker identities) |
  | Session state | `training_session` (all authoritative fields as columns), `message`, `training_request`, `training_event` |
  | Agent records (zod-validated JSON plus key columns) | `agent_assessment`, `agent_turn` (plan records/claims audit) |
  | Session records | `training_issue`, `training_addition`, `input_receipt` |
  | Results | `training_outcome` (once per session), `practice_progress` (per owner: completed and per-outcome counts, updated once when the outcome is first decided) |

- **Admin and worker access:**
  - `init` makes the publisher the admin.
  - The reducers `authorize_worker` / `revoke_worker` are admin-only.
- **Procedures (worker-only).** Each loads the session aggregate, runs the shared command, writes back the diff in **one transaction**, and returns a JSON envelope. Rule rejections are values, not throws.
  - session: `start_session`, `load_session`;
  - inputs: `submit_user_message`, `submit_training_event`, `request_retry`;
  - agent turns: `claim_agent_turn`, `release_agent_turn`, `record_assessment`, `save_plan`, `commit_agent_turn`;
  - lifecycle: `conclude_turn_limit`, `record_agent_failure`;
  - progress: `get_progress`.
- **Values from the module:** ids, timestamps and the practice code/case reference come from `ctx.random` / `ctx.timestamp` inside the module.
- **Node side:** `SpacetimeBackend` calls procedures over HTTP (`/v1/database/<db>/call/<proc>`, snake_case args, SATS-JSON options). It uses a restricted worker token from env or `.spacetime/worker.json` (gitignored, written by `pnpm spacetime:setup`). Browsers never see the token.
- **Version notes:**
  - The module tsconfig uses lib ES2023 so `.at()` type-checks.
  - The module code avoids `node:crypto`: a pure hash for candidate ids, and an injectable random source for scenario reservations.

---

## 8. HTTP API (all under `/api/observer/sessions`, owner = player cookie; not-owned ids give 404)

| Method / path | Purpose |
| --- | --- |
| `POST /` | Create a session (opening message). |
| `GET /[id]` | Session view: stage, outcome, messages, requests, events, request status, practice code (once presented), verification and official result (only after the check starts), stop confirmation, technical notice, issues. |
| `POST /[id]/messages` | Submit a user message (runs the pipeline synchronously). |
| `POST /[id]/events` | Submit a UI event (`challengeId` returned when verification starts). |
| `POST /[id]/process` | Resume pending work. |
| `POST /[id]/retry` | The one allowed retry after a technical failure. |
| `GET /[id]/assessments`, `/plans`, `/planner` | Audit records; planner handoff plus current eligibility. |
| `GET /[id]/trace` | Agent-lab trace (dev / `AGENT_DEBUG=1` only). |
| `GET /[id]/explain` | "How this session worked" (ended sessions only). |

---

## 9. Configuration

| Variable | Meaning |
| --- | --- |
| `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_ID` | The OpenAI-compatible provider (intended: `https://integrate.api.nvidia.com/v1` plus a tool-capable Nemotron model). **Currently not set.** |
| `OBSERVER_MODEL_ID`, `OBSERVER_REVIEWER_MODEL_ID`, `PLANNER_MODEL_ID`, `ACTOR_MODEL_ID` | Optional per-agent model overrides. |
| `OBSERVER_STRUCTURED_MODE` | Structured-output mechanism: `tool` or `json_schema`. |
| `OBSERVER_TIMEOUT_MS`, `PLANNER_TIMEOUT_MS` | Timeouts. |
| `MODEL_THINKING=on` | Allow Nemotron reasoning. |
| `TRAINING_BACKEND=spacetime` | SpacetimeDB is the authority; otherwise Postgres. |
| `SPACETIME_URL`, `SPACETIME_DATABASE`, `SPACETIME_TOKEN` | Or `.spacetime/worker.json`. |
| `PLANNER_PROTOCOL=tools` | Function-calling planner. |
| `E2E_TEST=1` + `OBSERVER_MODEL_MODE=fixture` | **Labeled deterministic test models** for observer, planner, tool planner and actor. Test-only; never a production fallback. |
| `AGENT_DEBUG=1` | Enables the agent-lab trace. |

`.env.local` holds dev values and `.env.test.local` holds the Playwright test DB. Agents are not allowed to read them.

---

## 10. How to run

```bash
pnpm dev                                                    # Postgres backend, live models if configured
E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev             # no credentials needed (fixture models)

# SpacetimeDB authority (local)
curl -sSf https://install.spacetimedb.com | sh              # CLI 2.14.1 → ~/.local/bin/spacetime
pnpm spacetime:start                                        # server on 127.0.0.1:3300
spacetime server add stdb-local --url http://127.0.0.1:3300
pnpm spacetime:publish && pnpm spacetime:setup
TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev
```

Other scripts:
- `bash scripts/observer-demo.sh`: a scripted full flow.
- `pnpm observer:eval` / `pnpm planner:eval`: live evals; exit 2 = blocked without credentials.
- `pnpm game:smoke`: the live provider smoke test.

---

## 11. Tests and verified results (last runs)

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm check` | lint clean, typecheck passes, **687/687** | Unit and component tests, including tool-planner protocol tests |
| `pnpm spacetime:typecheck` | passes | Module |
| `pnpm test:spacetime` | **8 passed** (1 skipped placeholder) | Against a **live local SpacetimeDB server** with fixture models: full flow with outcome and progress counted once; explicit card action as the only exposure path; idempotency; commit guards (wrong claim, stale revision, forged candidate); a stop race; unauthorized identities; the tool planner committing through the module; Spacetime unreachable means no transition |
| `TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools pnpm exec playwright test tests/e2e/scamper.spec.ts` | **4/4** | Browser flow with SpacetimeDB as the authority |
| `pnpm test:integration` | **33/33** | Production build plus all API and E2E specs on Postgres (test Neon branch) |

Test data sets:
- **Observer eval:** 46 labeled cases.
- **Planner eval:** 23 contexts, 6 held out.
- **Actor eval (Codex):** 21 cases.

All labels were written by AI and **need human review**.

---

## 12. Not done, not verified, known limits

1. **No live model has ever been run.** No `MODEL_*` credentials are configured:
   - `game:smoke`, `observer:eval` and `planner:eval` all exit 2;
   - real Nemotron behavior, structured-output reliability and tool-call protocol compatibility are **unmeasured**;
   - all passing tests use labeled fixtures.
2. **Only the planner uses tools.** The observer and actor use structured output.
3. **No direct SpacetimeDB subscriptions.** The browser reads through authenticated Next.js routes (request/response). There are no SpacetimeDB views for clients and no app-account-to-Spacetime-identity mapping.
4. **No session migration.** Old Postgres sessions are not migrated to SpacetimeDB.
5. **No phrase screening in the actor:** threats, fees and new requests can pass runtime validation.
6. **One scenario only.** No legitimate scenarios, no scenario selection, no next-scenario recommendation (`practice_progress` exists, but there is no "next eligible scenario" logic).
7. **No sessions list API.** History is per browser (localStorage ids).
8. **Verification across reload:** reloading during verification loses the browser's challenge id; the user must cancel and restart the check.
9. **Cancellation is per process.** Across server instances, correctness relies on the revision/claim guard at commit.
10. **Mascot:** a placeholder icon badge. Asset slot: `public/images/scamper-detective.png` plus `MASCOT_SRC` in `src/features/scamper/mascot.tsx`.
11. **Feature-scoped colors.** The `/scamper` styles define feature-scoped color tokens (`scamper.module.css`), deviating from the repo rule of using only kit tokens, because `visual-design/` is designer-owned.
12. **Hackathon track eligibility** ("Enter up to two" vs. T-Mobile + SpacetimeDB + NVIDIA) is unconfirmed with the organizers.
13. **Deployment:** none. No public SpacetimeDB (Maincloud) deployment yet; local only.

---

## 13. File map (most important)

| Area | Path |
| --- | --- |
| Contracts | `src/contracts/observer.ts`, `planner.ts`, `trace.ts`, `explain.ts` |
| Training rules (shared, module-safe) | `src/server/engine/decide.ts`, `ops.ts`, `commands.ts` |
| Backend boundary | `src/server/engine/backend.ts` (`TrainingBackend`, `StoreBackend`), `spacetime-backend.ts` |
| Orchestration | `src/server/observer/service.ts`, `runtime.ts` |
| Observer | `src/server/observer/{run,prompts,rubric,evidence,flags,review,state,history,planner-input,model,trace}.ts` |
| Planner | `src/server/planner/{scenario,context,eligibility,validate,input,prompts,run,actor,stop-intent,hash,tool-model,tool-run}.ts` |
| Actor | `src/server/actor/*` (`controller.ts` = integration) |
| Stores | `src/server/observer/store/{types,memory-store,prisma-store}.ts`, `prisma/models/observer.prisma` |
| SpacetimeDB module | `spacetime/src/index.ts`, `spacetime/tsconfig.json`, `scripts/spacetime-setup.ts` |
| UI | `src/features/scamper/*`, `src/app/scamper/*`; `src/features/practice/*`; `src/features/agent-lab/*` |
| Tests | `tests/unit/{observer,planner,actor}/*`, `tests/spacetime/engine.test.ts`, `tests/api/observer.spec.ts`, `tests/e2e/{scamper,practice,agent-lab}.spec.ts`, `tests/{observer,planner}/eval/*` |
| Docs | `README.md` (track section), `docs/agents/*/status.md`, `docs/agents/HANDOFF.md`, `src/server/actor/README.md` |

---

## 14. Candidate next steps (for planning; not decided)

- **Live model work** (needs credentials):
  - run the Nemotron smoke test and one recorded tool-call round trip;
  - run the live evals;
  - tune prompts and timeouts.
- **Actor safety:** a hard check for threats, fees and new requests (it would trigger the single repair).
- **Public deployment:** deploy the module to SpacetimeDB Maincloud and the app to a host.
- **Client data path:** owner-scoped SpacetimeDB views and direct subscriptions (after an identity mapping is designed and cross-user access is tested), or keep server-mediated polling.
- **More scenarios:** at least one legitimate scenario, plus scenario selection and next-scenario progression from `practice_progress`.
- **Sessions API:** server-side session listing to replace browser-local history.
- **Mascot:** final mascot artwork.
- **Human review:** review the eval gold labels.
- **Publishing:** push `scamper/spacetime` to the GitHub repo once approved; prepare the demo script.

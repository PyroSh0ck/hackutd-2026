# SCAMPER demo-readiness handoff (live Nemotron + SpacetimeDB Maincloud)

**For:** Codex (planning the next steps).
**Date:** 2026-11-08.
**Branch:** `scamper/spacetime`, local only. Nothing on this branch is pushed.
**Commit:** `09201d3`.

| Commit | What it contains |
| --- | --- |
| `612d005` | Stop-while-generating browser test; a turn overtaken by a stop is recorded `stale`, not `failed` |
| `aff30e5` | Maincloud scripts, `SPACETIME_WORKER_FILE`, per-call timeout and one retry for safe SpacetimeDB calls |
| `09201d3` | Fixes found with live Nemotron (observer issue support, conversation-scope normalization, planner pacing) and Playwright env isolation |

Related docs:
- `docs/agents/PROJECT-OVERVIEW.md`: what the project is and how it works.
- `docs/agents/backend-completion-status.md`: backend brief status. Its counts are as of `984e386`; the counts below supersede it.

---

## 1. Verdict

The app is **demo-ready locally** with live Nemotron (`nvidia/nemotron-3.5-bolt-e4b`) and the intended SpacetimeDB backend: the deployed Maincloud database `cybersleuth-db`.

- The final live browser run passed **6 of 6 sessions**: the full flow ×2, simulated exposure ×2, and stopping mid-generation ×2.
- That run only passed after fixing three live-model blockers (§4). Before those fixes, the opponent never made its request.
- **No public URL yet.** The app runs on a developer machine; only the database is hosted.

---

## 2. Environment (names only, never values)

### `.env.local` (developer machine)
- **Set:**
  - `TRAINING_BACKEND=spacetime`, `PLANNER_PROTOCOL=tools`
  - `SPACETIME_URL` (Maincloud), `SPACETIME_DATABASE=cybersleuth-db`, `SPACETIME_TOKEN`
  - `MODEL_BASE_URL` (`integrate.api.nvidia.com`), `MODEL_API_KEY` (`nvapi-…`), `MODEL_ID=nvidia/nemotron-3.5-bolt-e4b`
  - `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- **Not set:**
  - `GAME_COOKIE_SECRET`: falls back to `BETTER_AUTH_SECRET`.
  - `PRACTICE_SCENARIOS`: default is both scenarios. For a scripted demo, start with `PRACTICE_SCENARIOS=mobile-code-01`.
- **Must stay unset for live runs:** `E2E_TEST`, `OBSERVER_MODEL_MODE`, `AGENT_DEBUG`, `PRACTICE_ALLOW_SCENARIO_SELECTION`.

### SpacetimeDB
- **CLI:** `spacetime` 2.14.1, matching the `spacetimedb` 2.14.1 SDK. Logged in to Maincloud.
- **Maincloud:**
  - Database `cybersleuth-db`, identity `c200213270a7…`.
  - Dashboard: https://spacetimedb.com/cybersleuth-db.
  - The current `./spacetime` module is published.
- **Restricted worker on Maincloud:** identity `c2002d711094…`, authorized via `authorize_worker`.
  - Credentials are in `.spacetime/maincloud.json` (gitignored, mode 600).
  - The same token is in `.env.local` as `SPACETIME_TOKEN`.
- **Local server (unchanged):** `127.0.0.1:3300`, database `scamper-training`, credentials in `.spacetime/worker.json`.
- **Scripts in `package.json`:**
  - `spacetime:publish` and `spacetime:setup`: local only (`stdb-local`).
  - `spacetime:publish:maincloud`: deliberately has no `--yes`, so a human confirms each publish.
  - `spacetime:setup:maincloud`: writes `.spacetime/maincloud.json`.
- **Config precedence (`spacetimeConfigFromEnv`):**
  1. all three `SPACETIME_URL` / `SPACETIME_DATABASE` / `SPACETIME_TOKEN`;
  2. otherwise the file named by `SPACETIME_WORKER_FILE`;
  3. otherwise `.spacetime/worker.json`.
  - An empty `SPACETIME_WORKER_FILE` counts as unset.

### Model access (NVIDIA)
- **Key types:**
  - build.nvidia.com keys (`nvapi-…`) work with `integrate.api.nvidia.com`.
  - A Brev key (`bak-…`) does **not**. It is for Brev GPU instances, not the hosted API. The earlier 401 "Invalid JWT serialization" came from putting a `bak-` key in `MODEL_API_KEY`.
- **Models probed with this account (tool-calling probe):**

| Model | Access | Tool calls | Notes |
| --- | --- | --- | --- |
| `nemotron-3.5-bolt-e4b` | ✅ | ✅ | **In use.** Fast (≈0.5–4 s per call); valid structured output |
| `nemotron-3.5-lightning-30b-a3b` | ✅ | ✅ | Planner OK. **As actor:** failed the strict schema every time, even after repair. **As observer:** one 60 s timeout |
| `nemotron-3-ultra-550b-a55b` | ✅ | ✅ | **As observer:** 4 s, 11 s, then a 98 s timeout. Too slow |
| `nemotron-3-super-120b-a12b`, `nemotron-nano-3-30b-a3b`, `llama-3.1-nemotron-{51b,70b,ultra-253b}` | ❌ 404 | — | Listed but not enabled for this account |

- **Per-agent overrides exist:** `OBSERVER_MODEL_ID`, `REVIEWER_MODEL_ID`, `PLANNER_MODEL_ID`, `ACTOR_MODEL_ID`.
- **Brev option (not done; needs operator decision and credits):**
  - Run a Nemotron NIM on a Brev GPU instance. Brev recommends an L40S 48GB or A100 80GB; it needs an NGC key.
  - Set `MODEL_BASE_URL=http://localhost:8000/v1` (via `brev port-forward`), any non-empty `MODEL_API_KEY`, and the NIM's model id. No code change.
  - Avoids the hosted API's shared rate limits. It does **not** guarantee consistent latency (GPU size, cold starts and the model itself still vary).
  - Port-forward works only from the developer's machine; a hosted app needs a public, authenticated endpoint.

---

## 3. What was verified (results from these runs, not historical counts)

### Live: real Nemotron + Maincloud, dev server on :3000

**Runner:** `tmp/live/live.spec.ts` with `tmp/live/playwright.live.config.ts`.
- It's a one-off script in gitignored `tmp/`, not part of the suite.
- It drives real Chromium against the running dev server and logs per-step timings.
- Live replies vary, so it keeps chatting until the request card appears (up to 9 turns), and presses **Retry reply** if a technical notice appears.

**Final run (`--repeat-each 2`): 6/6 passed.**

| Path | Result |
| --- | --- |
| Start → chat → request card → official check → **reload mid-check** (resumes with the same result, no restart) → "I have read this result" → Report / block and end → review → "How this session worked" | ✅ ×2 |
| "How this session worked" | ✅ Shows "SpacetimeDB module (authoritative)" and `get_training_context` with call ids |
| Simulated exposure: reload with the card pending, then "I accept" typed in chat | ✅ ×2. The chat message submits nothing; sharing via the card → `simulated_exposure` |
| End practice ~4 s into generation | ✅ ×2. Ended `safely_disengaged`; no late reply in the transcript; storage confirms no committed plan |

- **Timing:** per-turn round trip ≈ 6–12 s, mostly the observer. The request card appeared on turn 4 in most sessions.
- **`pnpm practice:smoke`:** 4/4 live.
  - Observer structured response with validated evidence.
  - Committed reply via tools.
  - Planner tool calls with provider call ids (`get_training_context`, `execute_training_move`).
  - A terminal stop leaves no late message.

### Deterministic suites (labeled test-fixture models)

| Command | Result |
| --- | --- |
| `pnpm check` | lint + typecheck clean, **746/746** |
| `pnpm test:integration` (Postgres, prod build :3100) | **40/40**, exit 0 |
| `TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools SPACETIME_WORKER_FILE=.spacetime/maincloud.json pnpm exec playwright test tests/e2e/scamper.spec.ts tests/e2e/scamper-notice.spec.ts --repeat-each 2` | **22/22** on Maincloud |
| `SPACETIME_WORKER_FILE=.spacetime/maincloud.json pnpm test:spacetime` | **11 passed**, 1 skipped placeholder (Maincloud) |
| Maincloud authorization probe | Worker calls succeed; an unauthenticated call is rejected |

---

## 4. Blockers found and fixed

### 4.1 Opponent never presented the request (live observer invented issues)
- **Symptom:** after "Sure, go on." etc., the opponent kept answering non-questions, and the request card never appeared. The opponent also broke character ("use the simulator's request card…").
- **Cause:**
  - `bolt` filed open issues that weren't there, e.g. `procedure_question` with summary *"No procedure questions were raised in the current message"* quoting "Sure, go on.".
  - Planner rule **P3** (open issues restrict the turn to answering them) blocks P4–P10, including the request (P10).
- **Fix:** `src/server/observer/issue-support.ts` → `pruneUnsupportedIssues`, applied to the **final** assessment in `src/server/observer/run.ts`. The raw proposal is kept in the audit. It drops:
  - any draft whose summary asserts absence (`No…`, `None…`, `There are no…`);
  - question-kind drafts (identity / procedure / scenario-fact) whose **every** quote is a bare go-ahead ("Sure, go on.", "Alright, go ahead.", "Okay.") with no `?`.
- **Deliberately not dropped:** statements that are real identity issues ("This is a scam, you're not from Cedar."). An earlier, stricter version (only "question-like" quotes) broke the planner eval cases `identity-objection`, `pending-objection` and `objection-after-answer`, so it was narrowed.
- **Tests:** `tests/unit/observer/issue-support.test.ts`.

### 4.2 Silent turns (observer fallback in conversation scope)
- **Symptom:** a turn with no opponent reply and no technical notice.
- **Cause:**
  - The model attached `decision.evidence` to an `unclear` decision in conversation scope (no request yet), which the validator rejects (`invalid_scope`).
  - The repair repeated the mistake, so the assessment fell back to `unclear_fallback`.
  - P2 then says wait, and the opponent says nothing.
- **Fix:** `clearConversationDecisionEvidence` (same file) runs before validation **only** in conversation scope and **only** when the label is `unclear`. That evidence carries no interpretation. Any other invalid shape (another label, a `requestId`, a condition) is still rejected as before.

### 4.3 Planner stalled on `continue_premise` at P10
- **Symptom:** with the request eligible, `bolt` chose "continue premise" repeatedly.
- **Fix:** one pacing sentence in `PLANNER_SYSTEM_PROMPT` rule 5 (`src/server/planner/prompts.ts`): when `present_code_request` is a candidate and `recentPlans` already contains `continue_premise`, choose `present_code_request`.
  - Guidance only. The candidate set and server rules are unchanged; the model still chooses.
- **Why not a rule change:** P10's candidates are recomputed by the **SpacetimeDB module** at commit (`src/server/engine/decide.ts` → `getEligibleCandidates`). Changing eligibility requires republishing the Maincloud module, which needs explicit operator authorization.

### 4.4 Test suites inherited live settings from `.env.local`
- **Symptom:** after the live keys were added, `pnpm test:integration` failed 10/40 (game API expected `provider_unconfigured`; the scamper flow ran against live models / Maincloud).
- **Cause:** `next start` loads `.env.local`.
- **Fix:** `playwright.config.ts` webServer env sets empty values for `MODEL_*`, the per-agent `*_MODEL_ID`, and `SPACETIME_URL` / `DATABASE` / `TOKEN`.
  - Empty strings take precedence over env files (verified with `@next/env`).
  - `TRAINING_BACKEND`, `PLANNER_PROTOCOL` and `SPACETIME_WORKER_FILE` come only from the shell.

### 4.5 Maincloud transport resilience (`aff30e5`)
- **Symptom:** one browser run on Maincloud lost the Home "Completed sessions" summary. A single progress call failed, and Home ignores progress errors.
- **Fix:** `SpacetimeBackend.call` has a 15 s per-attempt timeout and **one** retry after a transport error, timeout or 5xx.
  - Retried procedures (`RETRY_SAFE`): `loadSession`, `listSessions`, `getProgress`, and `submitUserMessage` / `submitTrainingEvent` / `requestRetry`. The module dedupes those writes by idempotency-key receipts.
  - Never retried: `startSession` and the agent-turn operations (claim / commit / save / failure).
- **Tests:** `tests/unit/engine/spacetime-backend-retry.test.ts`.

### Tried and reverted
- **Automatic retry of model HTTP calls (429/5xx).**
  - It violates the explicit contract tested in `tests/unit/observer/model-prompts.test.ts` and `tests/unit/actor/model.test.ts` ("no hidden retries", exactly one request; the observer call budget depends on it).
  - The designed recovery for a failed turn is the user-facing **Retry reply** (`requestRetry`).
  - Observed once live: `planner_http_error` after 43 ms on a turn (likely provider throttling).

---

## 5. Still weak, mocked or untested (honest list)

1. **Live reliability is measured on a small sample.**
   - Final run: 6/6. Earlier runs: about 2 of 12 sessions didn't reach the request within 6 turns, one from a provider HTTP error and one from an issue backlog.
   - Expect the request around turns 4–6. No live eval set has been run: `pnpm observer:eval` and `pnpm planner:eval` haven't been run against the live models.
2. **Issue backlog:** one real question can produce 3–5 issues of different kinds with the same quote, each answered on its own turn (seen: five issues → three P3 turns).
   - Candidate fix: dedupe question-kind drafts that cite the same quote. It needs care, because "Who are you and what do you want?" is legitimately two issues.
3. **Immersion:** the opponent sometimes describes the app's controls ("the simulator's request card", "the Verify independently control").
   - This is by design today: scenario facts F04/F05 (`src/server/planner/scenario.ts`) and the `answer_procedure` move instruction (`src/server/planner/actor.ts`) are worded that way.
   - Content rules don't block it. Rewording is a product decision.
4. **Odd but harmless replies:** e.g. "I don't have that detail." when answering a vague scenario-fact issue.
5. **Latency:** ≈10 s per turn, dominated by the observer.
6. **Home ignores progress errors:** the summary silently disappears (cosmetic; less likely now with the backend retry).
7. **Untested live:**
   - the legitimate `mobile-notice-01` scenario with live models;
   - the legacy `/practice` UI with live models (it also has no account portal);
   - any hosted app deployment (only the database is hosted).
8. **No human review** of the observer/planner/actor eval labels yet.
9. **Maincloud contains test data:** sessions from `pnpm test:spacetime` and the e2e runs, under random anonymous owners. They aren't visible to real players.

---

## 6. Shortest reliable demo path (current code)

1. **Start the server** with live settings from `.env.local`, fraud scenario only and no test flags:
   `PRACTICE_SCENARIOS=mobile-code-01 pnpm dev`
2. **Check** that `/api/ready` returns:
   `{"backend":"spacetime","backendReachable":true,"modelConfigured":true,"plannerProtocol":"tools","fixtureModels":false,…}`
3. **In `/scamper`:** Begin practice, then send, one at a time:
   1. "Who is this?"
   2. "Sure, go on."
   3. "Okay, what do you need from me?"
   4. "Alright, go ahead."
   - The request card usually appears by now. If not, send "Fine, what's next?" or "Okay.".
4. **Run the check:** Check official support → Run check → **reload the page** (the check resumes with its result) → I have read this result → Report / block and end.
5. **Review:** See your review → open **How this session worked** (SpacetimeDB + tool calls with call ids).
6. **Alternate ending:** Share practice code → Share in simulation → simulated exposure.
7. **If a turn fails:** press **Retry reply**. Allow ~10 s per reply.

**Labeled test-model mode (deterministic, for rehearsal only; don't present as live AI):**
`E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev`

---

## 7. Operator actions still open (need human decision or authorization)

1. **Hosting the app.** Set these server-side on the host, then verify `/api/ready` and one full browser flow on the hosted URL:
   - `TRAINING_BACKEND=spacetime`, `PLANNER_PROTOCOL=tools`
   - `SPACETIME_URL=https://maincloud.spacetimedb.com`, `SPACETIME_DATABASE=cybersleuth-db`, `SPACETIME_TOKEN` (worker token)
   - `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_ID`
   - `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the host's public URL), optionally `GAME_COOKIE_SECRET`
   - Optionally `PRACTICE_SCENARIOS=mobile-code-01`
   - Keep `E2E_TEST`, `OBSERVER_MODEL_MODE`, `AGENT_DEBUG` and `PRACTICE_ALLOW_SCENARIO_SELECTION` unset.
2. **Republishing the Maincloud module.** Required for any change to shared engine / eligibility / scenario code that the module bundles (`src/server/engine/*`, `src/server/planner/{eligibility,scenario,…}`, `src/contracts/*`).
   - Command: `pnpm spacetime:publish:maincloud` (asks for confirmation).
   - Never pass `--delete-data` without explicit approval.
3. **Brev self-hosted NIM (optional).** Uses credits while running; needs an NGC key and `brev login` by the operator.
4. **Pushing `scamper/spacetime`.** Nothing is pushed. Commits must not carry Claude attribution trailers.
5. **Human review of the eval labels.**

---

## 8. Suggested next work (for planning)

1. **Live eval:** run `pnpm observer:eval` / `pnpm planner:eval` against `bolt` to get real numbers on issue precision and request pacing, instead of the 6-session sample.
2. **Issue dedupe** (§5.2), with eval coverage for multi-question messages.
3. **Product decision on immersion** (§5.3). If the opponent should never name UI controls, reword F04/F05 and the `answer_procedure` instruction, and add a content rule.
   - Note: changing scenario facts affects the module, so it needs a republish.
4. **Deterministic pacing (optional):** make P10 offer only `present_code_request` after one `continue_premise`. Shared rules → module republish → eval updates.
5. **Live run of the legitimate scenario** (`mobile-notice-01`).
6. **Home progress-error UI** (show or retry instead of hiding).
7. **Hosting the app,** then a full browser verification on the public URL.

---

## 9. Files touched in this phase

| File | Change |
| --- | --- |
| `src/server/observer/issue-support.ts` (new) | `pruneUnsupportedIssues`, `clearConversationDecisionEvidence` |
| `src/server/observer/run.ts` | Applies both (final assessment / pre-validation in conversation scope) |
| `src/server/planner/prompts.ts` | Pacing guidance in rule 5 |
| `src/server/engine/spacetime-backend.ts` | Timeout, one safe retry, `SPACETIME_WORKER_FILE` |
| `scripts/spacetime-setup.ts` | `SPACETIME_WORKER_FILE` output path |
| `package.json` | `spacetime:publish:maincloud`, `spacetime:setup:maincloud` |
| `playwright.config.ts` | Isolates test servers from `.env.local` live settings |
| `tests/unit/observer/issue-support.test.ts` (new) | Pruning and normalization cases taken from live output |
| `tests/unit/engine/spacetime-backend-retry.test.ts` (new) | Retry and no-retry rules |
| `tmp/live/*` (gitignored) | One-off live browser runner |

---

## 10. Addendum: final stabilization (after `09201d3`)

- **Recording baseline:** `09201d3`, tagged locally as `demo-baseline-09201d3`.
  - The recording server runs on `:3000` with `PRACTICE_SCENARIOS=mobile-code-01 pnpm dev`. It was restored after the legitimate-scenario run used `:3001`.
  - No model, database, worker, eligibility, scenario or agent-contract changes in this phase.

### 10.1 Per-session evidence, final run of section 3 (`09201d3`, `bolt`, Maincloud, fixtures off)

Rebuilt from the stored sessions on Maincloud (authoritative), not inferred from pass/fail:
- **Retries** count `planning_retry_requested` events (Retry reply).
- **Turn failures** count `planning_failed` events.
- **Observer fallbacks** count assessments resolved `unclear_fallback`. The player sees no notice for these; the opponent simply waits that turn.

| # | Path | Outcome | User turns before request | Retries | Turn failures | Observer fallbacks | Duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | verification | defense_demonstrated | 4 | 0 | 0 | 0 | 42 s |
| 2 | simulated exposure | simulated_exposure | 5 | 0 | 0 | 0 | 55 s |
| 3 | stop while generating | safely_disengaged | n/a | 0 | 0 | 0 | 4 s |
| 4 | verification | defense_demonstrated | 4 | 0 | 0 | **1** | 43 s |
| 5 | simulated exposure | simulated_exposure | 4 | 0 | 0 | 0 | 39 s |
| 6 | stop while generating | safely_disengaged | n/a | 0 | 0 | 0 | 4 s |

- **Not recorded for that run:** per-turn timings, and provider HTTP error categories for the planner/actor beyond what is stored (none stored).
- **Earlier runs** before the fixes had failures: no request within 6 turns, one `planner_http_error`, one silent turn. See section 4.

### 10.2 Opt-in live harness

The one-off runner was promoted to `tests/live/scamper.live.spec.ts` with `playwright.live.config.ts`, run by `pnpm test:live`.
- **Opt-in only:** never part of `check`, `e2e` or `integration`.
- **Guards:** requires `LIVE_BASE_URL`, and refuses unless `/api/ready` reports `fixtureModels=false` and `modelConfigured=true`.
- **Behaviour:** at most 9 cooperative turns. Retry reply is pressed only when the notice is visible, and every press is counted.
- **Isolation:** a fresh anonymous player per test; nothing is deleted.
- **Logging:** timings, counts and outcomes only; results go to `tmp/live-results/`.

Results (same commit + harness, same models and backend):

| Scenario | Path | Outcome | User turns before request | Retries | Send errors | Turn times (s) | Duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fraud | verification (+ reload mid-check, review shows tool calls) | defense_demonstrated | 2 | 0 | 0 | 7.2, 13.2 | 23 s |
| fraud | simulated exposure (+ reload with card pending, "I accept" ignored) | simulated_exposure | 4 | 0 | 0 | 10.6, 6.6, 7.8, 8.1, 9.5 | 45 s |
| fraud | stop while generating | safely_disengaged | n/a | 0 | 0 | — | 10 s |
| notice | chat → official check → reload mid-check → Proceed → portal review | legitimate_task_completed | n/a | 0 | 0 | 9.4, 9.2, 7.6 | 33 s |
| notice | report | legitimate_request_declined | n/a | 0 | 0 | 10.7 | 11 s |

### 10.3 Legitimate scenario (`mobile-notice-01`): live-tested once per path

- **Works:**
  - Usable replies on every turn; no request card, and no code or payment request in the transcript.
  - The official check resumes after reload.
  - The portal review reaches `legitimate_task_completed`, and the review shows it.
  - Reporting the notice gives `legitimate_request_declined`.
- **Weak:** reply quality.
  - "Who is this?" → "The practice line ends in 0142."
  - "What is this about?" → "I don't have that detail."
  - One actor output failed the schema and was repaired.
- **Recommendation:** keep `PRACTICE_SCENARIOS=mobile-code-01` for recording and judging, and describe the legitimate scenario as live-tested but rough.

### 10.4 Deployment prep

- **`vercel.json`:** `maxDuration: 300` for `src/app/api/observer/**/route.ts`. The bounded worst case per message is far above a typical 6–12 s turn: observer ≤ 3 × 15 s, planner ≤ 3 × 20 s, actor ≤ 2 × 20 s, plus SpacetimeDB calls ≤ 15 s each. The service's own turn lease is 155 s.
- **Production behaviour:**
  - The player cookie is `Secure` in production.
  - The same-origin check accepts `x-forwarded-host`.
  - The SpacetimeDB config must come from the env trio, because `.spacetime/` isn't deployed.
- **Hosted verification not done yet:** the Vercel CLI isn't logged in, and the credentials must be entered by the operator. See the README's "Deploy (Vercel)" section for the exact variables.

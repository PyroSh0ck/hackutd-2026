# Backend completion status (scamper-backend-completion-and-reference-data brief)

- **Branch:** `scamper/spacetime` (local only; nothing pushed for this work).
- **Known-good commit:** `984e386`.
- **Date:** 2026-11-07/08.
- **Baseline:** the overview's `d564fd6`.

## Done (by brief section)

| § | Deliverable | Where |
| --- | --- | --- |
| 2 | Practice-specific live smoke runner. Covers: an observer structured response with validated evidence, the planner's tool calls with call ids, the commit, and that a terminal stop prevents a late reply. Writes redacted evidence. Exits 2 when unconfigured and never falls back to fixtures. | `scripts/practice-smoke.ts`, `pnpm practice:smoke` |
| 3 | **Reference catalog.**<br>• Schema-validated catalog. Private scenario truth is server/module-only.<br>• Client-safe directory projection, rendered as display-only contacts (no links).<br>• The canonical F06 text is kept for `mobile-code-01` v1 (it takes precedence over the brief's wording). | `src/contracts/reference.ts`, `src/server/reference/{catalog,canonical}.ts`, `GET /api/observer/reference-directory` |
| 3/4 | **Trusted lookup.**<br>• Directory → official support check (existing challenge flow).<br>• Account portal: opening a notice and marking it reviewed are separate events the server validates. | `/scamper` Practice details, `GET /api/observer/sessions/[id]/account` |
| 6 | **Verification resumes after reload.**<br>• The owner's GET returns the active attempt's challenge and `attemptId`, only while verifying.<br>• Cancel invalidates it; an old challenge cannot acknowledge a new attempt. | `src/contracts/observer.ts`, `service.view`, UI |
| 5 | **Server-side history and progress.**<br>• Owner-scoped, newest first, with a stable opaque cursor (createdAt + id).<br>• Computed by shared pure functions on Postgres, memory and the SpacetimeDB module (`list_sessions`).<br>• `/scamper` history and home now use them. | `src/server/engine/history.ts`, `GET /api/observer/sessions`, `GET /api/observer/progress` |
| 7 | **Actor runtime content rules.**<br>• Rules: credential, code, payment/fee, threat and new-sensitive-data requests.<br>• Each violation records a rule id and an exact span in the private audit.<br>• Negation-aware: "No code or payment is required" passes.<br>• Scenario/candidate specific: the fraud scenario may ask for the code only on a request move.<br>• Uses the actor's existing single repair; a draft that still fails is withheld with a technical notice. | `src/server/actor/content-rules.ts`, `validate.ts` |
| 4/5 | **`mobile-notice-01` (legitimate).**<br>• Same engine, with a candidate registry: answer identity, procedure or statement questions, and acknowledge a refusal. Facts L01–L04. No code request, payment or fraud-only additions.<br>• New outcomes: `legitimate_task_completed`, `benign_task_completed_unverified`, `legitimate_request_declined`.<br>• Old outcome meanings are unchanged.<br>• The scenario id stays opaque (`"practice"`) in the view until the session ends. | `src/server/planner/scenario.ts`, `src/server/observer/state.ts`, contracts, module |
| 6 | **Scenario selection.**<br>• `mixed` (backend randomness) or `recommended` (least recently completed scenario; catalog id tie-break).<br>• The explicit `scenarioId` is gated (`E2E_TEST=1` or `PRACTICE_ALLOW_SCENARIO_SELECTION=1`).<br>• Enabled scenarios come from `PRACTICE_SCENARIOS` (default: both). | `src/server/engine/selection.ts`, `POST /api/observer/sessions`, module `start_session` |
| 8 | **Test fixtures.**<br>• Deterministic test reservations (test-only).<br>• Observer cases O02, O03, O05 and O08–O12 added as proposed, review-pending expectations.<br>• O01, O04, O06 and O07 already existed verbatim. | `tests/fixtures/reference.ts`, `tests/observer/eval/dataset.ts` |
| 9 | **Hardening.**<br>• The raw `/assessments`, `/plans` and `/planner` routes are dev / `AGENT_DEBUG=1` only (404 in production).<br>• `/explain` stays redacted and post-session.<br>• `/api/ready` gives a redacted readiness check (backend reachability, configuration names; no model calls).<br>• Player routes call `connection()` so they are never prerendered. | routes, `src/server/http/route.ts` |

### Bugs found and fixed along the way
- **Module ids could collide across transactions.** `ctx.random` is deterministic per transaction seed. Ids now embed a persistent `id_sequence` counter.
- **The line-suffix exemption was keyed to fact id F02 only.** It now uses the selected fact's text, so the legitimate scenario's L02 works.
- **The actor commit port still required a request card.** That requirement is removed; the backend's commit guard is the authority.
- **Build-time prerender errors for cookie-bound GET routes** under Cache Components (fixed by calling `connection()` in player routes).

## Checks run (results are from these runs, not historical counts)

| Category | Command | Result |
| --- | --- | --- |
| Unit/component (fixture models) | `pnpm check` | lint and typecheck clean, **735/735** (includes the observer eval additions) |
| Module typecheck | `pnpm spacetime:typecheck` | passes |
| Live **local** SpacetimeDB (fixture models) | `pnpm test:spacetime` | **11 passed**, 1 skipped placeholder |
| Browser, Postgres (fixture models) | `pnpm test:integration` | **39/39** (production build) |
| Browser, SpacetimeDB + tool planner (fixture models) | `TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools pnpm exec playwright test tests/e2e/scamper.spec.ts tests/e2e/scamper-notice.spec.ts --repeat-each 2` | **20/20** |
| **Live model** | `pnpm practice:smoke`, `pnpm game:smoke` | **BLOCKED (exit 2)**: `MODEL_BASE_URL`, `MODEL_API_KEY` and `MODEL_ID` are not configured |
| **Deployed** browser flow | — | **NOT RUN**: no deployment target or authorization |

All counts are from the final runs on `984e386` (735 = 727 before the eval additions + 8 new eval cases).

## Blocked: operator actions needed
1. **Nemotron access.**
   - Put `MODEL_BASE_URL=https://integrate.api.nvidia.com/v1`, `MODEL_API_KEY`, and a tool-capable Nemotron `MODEL_ID` in `.env.local` (never in chat or git).
   - Then run `PLANNER_PROTOCOL=tools pnpm practice:smoke`, and with SpacetimeDB: `TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools pnpm practice:smoke`.
   - Then run `pnpm observer:eval` and `pnpm planner:eval`.
2. **Deployment (needs explicit authorization).**
   - Publish the module to Maincloud (`spacetime login`, then `spacetime publish scamper-training --server maincloud --module-path ./spacetime`).
   - Run `pnpm spacetime:setup` against it, with `SPACETIME_URL` set to the Maincloud URL and `SPACETIME_SERVER=maincloud`.
   - Configure the app host with:
     - `TRAINING_BACKEND=spacetime`;
     - `SPACETIME_URL`, `SPACETIME_DATABASE` and `SPACETIME_TOKEN` (the worker token, host-side only);
     - `PLANNER_PROTOCOL=tools`;
     - the `MODEL_*` values;
     - `BETTER_AUTH_*`, `DATABASE_URL` and `GAME_COOKIE_SECRET`.
   - Keep `AGENT_DEBUG` unset.
   - Verify `/api/ready`, then one full browser flow on the deployed URL.
3. **Human review** of the eval labels (observer, planner, actor), including the new brief-v2 cases.

## Limits (truthful)
- **History is per anonymous player cookie.** It survives clearing browser storage while the cookie lasts. It is not cross-device and not linked to Better Auth accounts.
- **The content rules are bounded patterns.** Semantic errors (invented corroboration, invented user actions, contradicting the user) still pass deterministic checks; only live evaluation and human review can measure them.
- **`/practice` (the older UI) has no account portal**, so the legitimate scenario is only playable in `/scamper`. Runtime defaults enable both scenarios for `/scamper`, and `/practice` sessions use the same selection.
- **No direct SpacetimeDB subscriptions.** The browser reads through authenticated routes.
- **A composite (owner, createdAt) index was not added in Postgres.** The existing `ownerKey` index is used, and history is bounded to 500 rows per owner.

## Demo (local, fixture models)
```bash
pnpm spacetime:start            # once, keep running (127.0.0.1:3300)
pnpm spacetime:publish && pnpm spacetime:setup
TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev
# open /scamper → Begin practice (mixed: either scenario) → chat → Practice details: Official contacts /
# Account portal → official check (reload mid-check resumes) → decision → review → "How this session worked"
```

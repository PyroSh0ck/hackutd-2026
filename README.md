# Cyber Sleuth: scam-defense practice with SpacetimeDB + NVIDIA Nemotron

Cyber Sleuth (internal code name SCAMPER; routes, ids and the database keep that name) is a consent-based,
clearly fictional practice simulator. A player chats with a simulated sender
(Nemotron), decides whom to trust, can check with "official support" through the app, and gets a review
of what they did. Two scenarios exist:
- `mobile-code-01`: a fraudulent "account security check" that asks for a fictional practice code;
- `mobile-notice-01`: a genuine monthly-statement notice, checked through a trusted account portal.

The player-facing app is at **`/scamper`**.

## Architecture

| Component | Responsibility |
| --- | --- |
| `spacetime/` (SpacetimeDB 2.14.1 TypeScript module) | **Authoritative training engine.** Private tables for sessions, messages, requests, events, assessments, agent turns (claims and plan audit), issues, idempotency receipts, outcomes and per-owner progress. Every mutation runs the shared rules in `src/server/engine/` inside one transaction. |
| `src/server/engine/` | The training rules as pure code (`decide.ts`, `ops.ts`, `commands.ts`), with no Node imports. The module and the Postgres path run the same code. |
| Next.js (`src/server/observer/service.ts`) | Orchestration: **observer → eligible moves → planner → actor**. It sends commands to a `TrainingBackend`. With `TRAINING_BACKEND=spacetime` it never decides a state transition itself, and there is no Postgres fallback. |
| Observer (Nemotron, structured output) | Interprets each player message with quoted evidence (decision, open questions, verification behaviour). Validated deterministically; one bounded repair; falls back to "unclear" on failure. |
| Planner (Nemotron, `PLANNER_PROTOCOL=tools`) | A function-calling agent with two tools backed by the training service:<br>• `get_training_context` re-reads the authoritative session (server-computed candidate moves and permitted facts; no hidden truth).<br>• `execute_training_move` validates the plan, runs the constrained actor, and calls the module's atomic `commit_agent_turn`.<br>At most 3 model calls. |
| Actor (Nemotron, structured output) | Writes the sender's message from the accepted plan, under deterministic content rules (no credential, payment, threat or new sensitive-data requests). One repair. |
| Module commit guard | Rechecks the claim, revision, current input and the **server-derived** eligible move, and refuses output containing the practice code or the official result. |

The browser never talks to SpacetimeDB directly. Server routes use a restricted **worker** identity whose
token stays server-side. Player identity is an anonymous signed `httpOnly` cookie.

## Run locally (live models)

1. **Model access:** in `.env.local` set `MODEL_BASE_URL=https://integrate.api.nvidia.com/v1`, `MODEL_API_KEY` (a build.nvidia.com key, `nvapi-…`; a Brev `bak-…` key does not work with this endpoint), and `MODEL_ID` (we use `nvidia/nemotron-3.5-bolt-e4b`).
2. **SpacetimeDB:** pick one target.
   - **Local server:**
     ```bash
     curl -sSf https://install.spacetimedb.com | sh   # spacetime CLI 2.14.1 into ~/.local/bin
     pnpm spacetime:start                             # 127.0.0.1:3300 (keep running)
     spacetime server add stdb-local --url http://127.0.0.1:3300
     pnpm spacetime:publish                           # publishes the module as scamper-training
     pnpm spacetime:setup                             # authorizes a worker → .spacetime/worker.json
     ```
   - **Maincloud:** after `spacetime login`:
     ```bash
     pnpm spacetime:publish:maincloud   # publishes as cybersleuth-db (asks to confirm)
     pnpm spacetime:setup:maincloud     # authorizes a worker → .spacetime/maincloud.json
     ```
     Then either set `SPACETIME_WORKER_FILE=.spacetime/maincloud.json`, or set `SPACETIME_URL`, `SPACETIME_DATABASE` and `SPACETIME_TOKEN` in `.env.local`.
3. **Start the app:**
   ```bash
   TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools PRACTICE_SCENARIOS=mobile-code-01 pnpm dev
   ```
   Open `/scamper`. `/api/ready` should report `backend: "spacetime"`, `backendReachable: true`, `modelConfigured: true` and `fixtureModels: false`.

`PRACTICE_SCENARIOS` takes `mobile-code-01`, `mobile-notice-01`, or both comma-separated (the default is both, randomly mixed).

### Test-model mode (labeled test doubles, not live AI)

`E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev` replaces all three agents with deterministic fixtures. Use it for rehearsal and tests only; it must never be presented as live AI.

## Deploy (Vercel)

Configure these as **server-side** environment variables (never `NEXT_PUBLIC_*`):

| Variable | Value |
| --- | --- |
| `TRAINING_BACKEND` | `spacetime` |
| `PLANNER_PROTOCOL` | `tools` |
| `SPACETIME_URL` | `https://maincloud.spacetimedb.com` |
| `SPACETIME_DATABASE` | `cybersleuth-db` |
| `SPACETIME_TOKEN` | the authorized worker token (`token` in `.spacetime/maincloud.json`) |
| `MODEL_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `MODEL_API_KEY` | NVIDIA API key (`nvapi-…`) |
| `MODEL_ID` | `nvidia/nemotron-3.5-bolt-e4b` |
| `DATABASE_URL` | Postgres URL (auth tables, Prisma) |
| `BETTER_AUTH_SECRET` | stable 32+ character secret (also signs the player cookie unless `GAME_COOKIE_SECRET` is set) |
| `BETTER_AUTH_URL` | the deployment's public origin, e.g. `https://<project>.vercel.app` |
| `PRACTICE_SCENARIOS` | `mobile-code-01` (recommended for judging; see limits) |

- **Leave unset:** `E2E_TEST`, `OBSERVER_MODEL_MODE`, `AGENT_DEBUG`, `PRACTICE_ALLOW_SCENARIO_SELECTION`.
- **Duration:** `vercel.json` gives the observer routes a 300 s maximum duration. A typical turn takes 6–12 s, but the bounded worst case (observer + planner + actor timeouts and repairs) is well above typical serverless defaults.
- **Keep secrets stable:** changing `BETTER_AUTH_SECRET` / `GAME_COOKIE_SECRET` resets every anonymous player's ownership.

## Checks

| Command | What it proves |
| --- | --- |
| `pnpm check` | Lint, typecheck, unit/component tests (fixture models). |
| `pnpm test:integration` | All API and browser tests on a production build (Postgres, fixture models). |
| `pnpm test:spacetime` | Against a live SpacetimeDB server: full flow, exposure only via the explicit request action, idempotency, commit guards, stop race, unauthorized identities. |
| `TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools pnpm exec playwright test tests/e2e/scamper.spec.ts tests/e2e/scamper-notice.spec.ts` | The browser flows with the module as authority (fixture models). |
| `pnpm practice:smoke` | **Live** model smoke: observer evidence, planner tool calls with provider call ids, a committed reply, terminal stop. |
| `LIVE_BASE_URL=http://localhost:3000 pnpm test:live` | **Live** browser checks against a running server with real models (refuses fixture mode). Add `LIVE_SCENARIO=notice` for a server running `mobile-notice-01`. Results go to `tmp/live-results/`. |

After a session ends, the review page's **How this session worked** panel shows the backend, models,
observer decisions, planner protocol, tool calls with their call ids, and the outcome.

## Live results and known limits (2026-11-08)

- **Live runs:** with `nemotron-3.5-bolt-e4b` on Maincloud, live browser sessions passed. Details, per-session numbers and the fixes made along the way are in `docs/agents/DEMO-READINESS.md`.
  - Fraud flows: verification, simulated exposure, stop mid-generation.
  - Legitimate notice: verified and declined endings.
- **The sample is small.** The request typically appears after 2–5 player turns; turns take about 6–12 s, mostly the observer. Hosted-model latency and rate limits vary; a failed turn shows a **Retry reply** control.
- **Legitimate scenario replies are functional but weak** (e.g. "I don't have that detail."), which is why `mobile-code-01` alone is recommended for judging.
- **Notice scenario gaps:** "What is this about?" can still get "I don't have that detail." (the topic gate is in the shared engine and needs a module republish to change).
- **Chat behaviour (2026-11-08 fixes):** the player's message appears immediately; the reply is generated after the message is saved (`respond: "after_save"`) and the page follows the server's `turnStatus` (generating / paused with a reason / failed), including after a reload. The opponent stays in character (app controls and the simulation framing live in the app chrome only).
- **Other limits:**
  - History is per anonymous cookie; it is not cross-device.
  - The legacy `/practice` page has no account portal.
  - Eval labels have not had human review.

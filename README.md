To run use pnpm dev :D

## SpacetimeDB + NVIDIA Nemotron track build

**What runs where**

| Component | Responsibility |
| --- | --- |
| `spacetime/` (SpacetimeDB 2.14.1 TypeScript module) | **Authoritative training engine.** Private tables for sessions, messages, requests, events, assessments, agent turns (claims + plan audit), issues, additions, idempotency receipts, outcomes and per-owner progress. Every mutation runs the shared rules in `src/server/engine/` inside one transaction. Outcome and progress are recorded once, when the outcome is first decided. |
| `src/server/engine/` | The training rules as pure code (`decide.ts`, `ops.ts`, `commands.ts`), with no Node imports. The module and the Postgres path run the same code. |
| Next.js (`src/server/observer/service.ts`) | Orchestration: observer → eligibility → planner → actor. It sends **commands** to a `TrainingBackend`; with `TRAINING_BACKEND=spacetime` it never decides a state transition itself, and there is no Postgres fallback. |
| Planner (`PLANNER_PROTOCOL=tools`) | A function-calling agent with two app-defined tools backed by the training service:<br>• `get_training_context` re-reads the authoritative session (server-computed candidates and permitted facts; no hidden truth).<br>• `execute_training_move` validates the plan, runs the constrained actor, and calls the module's atomic `commit_agent_turn`. It returns the real message, request and event ids under the provider's `tool_call_id`.<br>Limits: one read, one move, one repair, at most 3 model calls. It stops after the move. |
| Module commit guard | Rechecks the claim, revision, current input and the **server-derived** eligible candidate (it does not trust the worker's record), and refuses output containing the practice code or the official result. |

**Run it locally**

```bash
curl -sSf https://install.spacetimedb.com | sh   # installs the spacetime CLI 2.14.1 into ~/.local/bin
pnpm spacetime:start                             # local server on 127.0.0.1:3300 (keep running)
spacetime server add stdb-local --url http://127.0.0.1:3300
pnpm spacetime:publish                           # builds + publishes the module as scamper-training
pnpm spacetime:setup                             # creates and authorizes a worker identity → .spacetime/worker.json
TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools pnpm dev   # then open /scamper
```

Nemotron: put `MODEL_BASE_URL=https://integrate.api.nvidia.com/v1`, `MODEL_API_KEY` and `MODEL_ID` (a tool-capable Nemotron model your account can reach) in `.env.local`, then run `pnpm game:smoke`.

**Checks** (fixture models are labeled test doubles; they prove wiring and authority, not model quality)

- `pnpm check`: lint, typecheck, unit tests (includes tool-planner protocol tests).
- `pnpm spacetime:typecheck`: the module.
- `pnpm test:spacetime`: runs against the **live local SpacetimeDB server**. Covers the full practice flow, explicit request action as the only path to exposure, idempotency, commit guards (wrong claim, stale revision, forged candidate), a stop race, unauthorized identities, the tool planner committing through the module, and the "Spacetime unreachable → no transition" check.
- `TRAINING_BACKEND=spacetime PLANNER_PROTOCOL=tools pnpm exec playwright test tests/e2e/scamper.spec.ts`: the browser flow with the module as the authority.
- After a session ends, the review page's **How this session worked** panel shows the backend, models, observer decisions, planner protocol, tool calls with their call ids, committed ids and the outcome.

**Known limits**

- Live Nemotron acceptance has not run: `MODEL_*` credentials are not configured.
- The browser reads state through authenticated Next.js routes; no direct Spacetime subscriptions are exposed.
- Sessions created on Postgres are not migrated into the module.
- Only the planner uses tools; the observer and actor keep their structured-output adapters.

# Engine/backend status

Branch `scamper/engine`, worktree `scamper-engine`. Newest entry first.

## M2 — UI checkpoint integrated; E19 passes on the real backend (2026-11-07)

Integrated UI commits `773aaf3` + `9810f2d` (pinned SHA, on contract `c8d5139`) via `--no-ff` merge.
All UI changes are in UI-owned paths; no conflicts. The UI worktree's uncommitted AGENTS.md
(`next dev` auto-block) and `.artifacts/` were not taken.

Integration fixes (integrator-owned):
- `tests/e2e/auth.spec.ts`: "existing user can sign in" asserted the old starter heading, which the
  new Scamper home page replaced. It now asserts landing on `/` plus the new h1. Same intent, not weaker.
- New `tests/e2e/integration-game-flow.spec.ts` (E19/E21): real UI at `/play?adapter=api` against the
  real API + Neon test DB, no interception. Flow: send → labeled scripted-fallback request → inspect →
  approve → loss (1000) → debrief → replay (reconstruction matches, decisive moment) → fork (new id,
  parent lineage, 1500) → verify → reject twice (opponent adapts once, then finishes) → protected →
  practice debrief. Original re-read from the server: same version/lastSequence, still loss, 1000.

Commands and results (after merge):
- `pnpm check` → pass: lint clean, typecheck pass, 168/168 (9 files).
- `pnpm test:integration` → 19/19 pass (10 game API, 4 auth E2E, 4 UI fixture/mocked-transport, 1 E19
  real-backend). First run before the auth fix: 17/18 (the stale heading).
- Production build (inside the integration run) → pass; `/` and `/play` static, game routes dynamic.

Not verified: live model (still no `MODEL_*`; E19 runs on the labeled fallback). Live acceptance =
`pnpm game:smoke`, reported separately.

For the UI owner / user:
- `/play` defaults to the **fixture storyboard**; the real game is only at `/play?adapter=api`, and the
  home page's primary link is "Play the fixture preview". For the demo the primary path should be the
  API adapter (fixtures as an explicit preview). UI-owned, not changed here.
- UI requested extra public fixture snapshots (safe exit, reflection, protected replay, etc.); not yet added.

## M1 — Backend core complete; live provider BLOCKED on credentials (2026-11-07)

Works now (all through the real API on Neon unless noted):
- Pure `decide`/`evolve`; `reconstructState` folds the same reducer; replay snapshots per event and
  a stored-vs-folded equality check (canonical JSON; holds after JSONB round trip).
- Atomic action acceptance: one transaction = version CAS + events + idempotency receipt;
  unique `(sessionId, sequence)` / `(sessionId, actionId)`. Duplicates return `duplicate`, same id
  with a different body → 409, concurrent approvals → exactly one debit.
- Anonymous signed-cookie ownership on every route; not-owned/malformed/unknown → 404; cross-origin
  mutation → 403.
- Opponent turn runs after the transaction is released, bounded (3 requests / 4 tools / 20 s);
  each tool effect commits atomically, bound to the still-pending turn id (stale → `TURN_STALE`);
  provider retries deduplicated by tool-call receipts; expired pending turns recovered once with a
  labeled fallback. Rejections are returned to the model as tool results.
- Restricted observation via a strict allowlist schema; player text redacted; verified at the
  **serialized HTTP request body** of the real client (sentinels, facts, contacts, account details,
  balance absent; balance-only variants produce byte-identical requests). Mutation check: leaking
  the balance into the brief makes all three E9 tests fail.
- Scripted fallback (labeled `scripted_fallback`) uses the same engine dispatch; adapts to rejections.
- Deterministic scoring + debrief with evidence ids; fork at `before-payment-decision` with
  fresh-id prefix copy + `branch.started`; original verified unchanged.
- Inline `<TOOLCALL>` and `<think>` handling for Nemotron-style outputs (unverified against the
  real endpoint).

Commands and results:
- `pnpm check` → pass: lint clean, typecheck pass, 163/163 unit/component (8 files).
- `pnpm exec playwright test tests/api/game.spec.ts` → 10/10 pass (real server + Neon test DB).
- `pnpm db:migrate:dev --name add_game`, `pnpm db:migrate:test` → applied `20261107134356_add_game`.
- `pnpm test:integration` (commit 069c079) → 14/14 pass (4 existing auth E2E + 10 game API).
- `pnpm game:smoke` → **exit 2 BLOCKED**: `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` not configured.
- `pnpm game:smoke` against a local stand-in OpenAI-compatible server → 5/5 checks pass. This
  validates the harness over real HTTP only; it is **not** live acceptance.

Acceptance mapping (mocked/fake-provider unless stated): E1–E8, E11, E12, E16–E18 unit; E3, E4,
E5, E6, E7, E13, E14, E15(reload), E16–E18 also API/DB. E9/E10 pass with the fake provider at the
serialized boundary; **live E9/E10 not run (blocked)**. E19–E21 need the UI/integration.

Blockers / user action:
- Provide provider credentials in `.env.local` (main checkout; symlinked here):
  `MODEL_BASE_URL` (e.g. `https://integrate.api.nvidia.com/v1`), `MODEL_API_KEY`, `MODEL_ID`
  (an available Nemotron with tool calling). Then run `pnpm game:smoke`.

Next: wait for UI SHA to integrate; meanwhile latency tuning and an E2E (E19) harness.

## M0 — Baseline and shared contract (2026-11-07)

Baseline before changes (HEAD d794df1):
- `pnpm check`: pass (lint clean, typecheck pass, 81/81 unit/component).
- `pnpm test:integration`: 4/4 pass against the Neon testing branch.
- No pre-existing failures.

Environment notes:
- This worktree had no `.env.local` / `.env.test.local`; symlinked (gitignored) to the main checkout's
  files without reading them. `src/generated/prisma` generated with `pnpm exec prisma generate`.
- `docs/scamper/{brief,scamper-project-and-claude-plan}.md` existed only untracked in the main
  checkout; copied here unchanged.
- No `MODEL_*`/NVIDIA/Discord variables in the shell environment. Discord notifier hook exists but is
  a no-op without `DISCORD_WEBHOOK_URL`, so reports are local (this file).

Decisions (reversible):
- Repo conventions over brief's proposed paths: contracts in `src/contracts`, server code in
  `src/server/game`, Prisma models in `prisma/models/`.
- Anonymous signed cookie identity (no login needed for play), reusing `BETTER_AUTH_SECRET` for HMAC.
- Opening tabs (bank/contacts) are not events: the bank panel is always in the view. Avoids
  version churn; verification only counts through `verify_trusted_contact`.
- `changePersona`, OTP exposure, Nessie, Protect, Recover: deferred per plan.
- Approve requires prior inspection (demonstrates out-of-order rejection).
- Rejecting does not end the encounter (lets the opponent adapt); `end_encounter` ends it.

Conflicts between brief and plan: none material. Brief lists `changePersona` and an "open bank"
action; the plan defers/demotes them. Followed the plan.

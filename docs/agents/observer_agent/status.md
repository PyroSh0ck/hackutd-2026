# Observer agent — implementation status

Branch `scamper/observer` (from `scamper/engine` @ `d13f125`). Brief: `observer-agent-claude-implementation-brief.md`
(copied unchanged from the main checkout, where it is untracked). Newest stage last.

## Stage 0 — inspection and plan

Actual stack: Next.js 16.4.4, React 19.3, Zod 4.6 (`z.toJSONSchema` available), Prisma 7.10 + Neon adapter,
Vitest 5, Playwright 1.64. Existing reusable pieces: OpenAI-compatible provider config (`MODEL_BASE_URL`,
`MODEL_API_KEY`, `MODEL_ID`), anonymous signed-cookie ownership (`playerRoute`), CAS-in-one-transaction
persistence pattern. No existing observer/planner code.

Baseline (HEAD `d13f125`): `pnpm check` 168/168; `pnpm test:integration` 19/19. No pre-existing failures.

**Deviation: no LangGraph.** LangGraph/LangChain are not installed. The brief says "LangGraph orchestration …
where already configured" and "do not introduce extra frameworks", and warns against competing sources of
truth. The orchestration is a fixed, bounded pipeline (≤3 model calls, no loops), so it is implemented as an
explicit typed state machine over pure functions. Prisma tables are the single durable source of truth (no
separate checkpointer). Each step is a pure function, so wrapping them as LangGraph nodes later is mechanical.

Structured output: provider-native forced tool call (`tool_choice` = the one function whose `parameters` is
the Zod-generated JSON Schema), with `response_format: json_schema` as a configurable alternative. Runtime Zod
validation is authoritative either way. No SDK, so there are no hidden retries.

Module map (repo conventions over the brief's suggested names):

| Responsibility | Path |
| --- | --- |
| Runtime schemas + types (shared) | `src/contracts/observer.ts` |
| Rubric (versioned) | `src/server/observer/rubric.ts` |
| Evidence/reference/cross-field validation | `src/server/observer/evidence.ts` |
| Deterministic review flags + policy | `src/server/observer/flags.ts` |
| Prompts | `src/server/observer/prompts.ts` |
| Model adapter | `src/server/observer/model.ts` |
| Reviewer validation + resolution | `src/server/observer/review.ts` |
| Bounded orchestration + audit | `src/server/observer/run.ts` |
| Fallback + event reductions + input assembly | `src/server/observer/state.ts` |
| Planner handoff | `src/server/observer/planner-input.ts` |
| Persistence (memory + Prisma), claims, CAS | `src/server/observer/store/*` |
| Service (ownership, idempotency, sequential processing) | `src/server/observer/service.ts` |
| HTTP | `src/app/api/observer/sessions/**` |
| Tests | `tests/unit/observer/**`, `tests/api/observer.spec.ts`, `tests/observer/eval/**` |
| Live eval runner | `scripts/observer-eval.ts` (`pnpm observer:eval`) |

## Stages 1–7 — results (every gate run, failures fixed and rerun)

| Stage | Gate evidence | Notable failures found and fixed |
| --- | --- | --- |
| 1 Schemas + rubric | `vitest tests/unit/observer/schemas.test.ts` 42/42; mutation check (loose top-level object, dropped condition rule) → 3 failures caught | — |
| 2 Evidence + flags | `evidence-flags.test.ts` 38/38 | Acceptance regex matched "I **will** not" → added negative lookahead; one test fixture lacked a condition |
| 3 Adapter + prompts | `model-prompts.test.ts` 27/27 | Invalid `OBSERVER_REVIEW_POLICY` silently defaulted → now an error |
| 4 Orchestration | `run.test.ts` 37/37 incl. 300 randomized runs; mutation check → 6 failures caught | Tightened: a reviewer correction that still trips any flag falls back (no self-excusing) |
| 5 Persistence/concurrency | `service.test.ts` 19/19 (4 mutations caught); `tests/api/observer.spec.ts` on Neon ×3 repeats, 21/21 | Requests sharing one revision came back in random order from Postgres → added `seq` (migration 2) |
| 6 Planner + E2E | `planner.test.ts` 10/10; HTTP scenarios; full `pnpm test:integration` 27/27 | — |
| 7 Semantic eval | `eval.test.ts` 53/53 (dataset, metrics, oracle wiring); `pnpm observer:eval` → **BLOCKED (exit 2)** | Oracle key collision in the test harness |

Final: `pnpm check` → lint clean, typecheck pass, **394/394** (16 files). `pnpm test:integration` → **27/27**
(10 game API, 8 observer API, 4 auth E2E, 4 UI, 1 game E2E). Migrations `20261107165519_add_observer`,
`20261107165922_observer_request_order` applied to dev (`db:migrate:dev`) and test (`db:migrate:test`) branches only.

## Completion report (brief §13)

**1. Implemented / files.** Contracts `src/contracts/observer.ts`; `src/server/observer/{rubric,evidence,flags,
prompts,model,review,run,state,planner-input,service,runtime}.ts`, `store/{types,memory-store,prisma-store}.ts`,
`testing/fixture-model.ts`; routes `src/app/api/observer/sessions/**` (create, get, messages, events, process,
assessments, planner); `prisma/models/observer.prisma` + 2 migrations; `scripts/observer-eval.ts`, `scripts/observer-demo.sh`; tests
`tests/unit/observer/*`, `tests/api/observer.spec.ts`, `tests/observer/eval/{dataset,harness,metrics}.ts`;
`playwright.config.ts` (test-server flag), `package.json` (`observer:eval`), `.env.example`.

**2. Four separate notions.**
- *Schema validity* = strict Zod parse (unknown keys rejected, enums, bounds). Says nothing about meaning.
- *Evidence validity* = ids match input; every quote an exact, case-preserving substring of a USER message in
  the supplied context of this session; cross-field rules. Says the words occurred, not that they support the label.
- *Semantic review* = one reviewer call; "supported" is corroboration only. Every final assessment is stored and
  handed off with `interpretationSource: "model_interpretation"`.
- *Server-observed facts* = `RequestState.action` / `inAppVerification`, reduced only from application events
  that the server validated. No model output reaches that reducer; completing verification requires the
  server-issued challenge from opening the directory.

**3. Model/provider.** OpenAI-compatible chat completions via `fetch` (same provider env as the game: `MODEL_*`;
optional `OBSERVER_MODEL_ID`, `OBSERVER_REVIEWER_MODEL_ID`). Structured output: forced function call whose
parameters are the Zod-generated strict JSON Schema (`OBSERVER_STRUCTURED_MODE=json_schema` switches to
`response_format`). Tolerates `<think>`, inline `<TOOLCALL>`, fenced JSON. **Not verified against a real
endpoint** — no credentials here.

**4. Policy, limits, fallback.** Default policy `consequential_and_flagged` (every explicit_acceptance and refused,
plus any flagged candidate); `flagged_only` available, invalid values rejected. Per message/request pair: 1
observer call, ≤1 repair (only after invalid returned output), ≤1 review, 0 reviewer repairs → ≤3 calls, enforced
by a hard guard. 15 s timeout per call; one HTTP request per call; transport failure/refusal/timeout → fallback,
never a hidden retry. Fallback = correct ids, `unclear`, no evidence, no observations; reason in
`failureReason` metadata. Call paths: normal 1; +review 2; repair 2; repair+review 3; failed repair 2.

**5. Persistence/concurrency.** Postgres via Prisma is the single source of truth (no separate checkpointer).
Append-only rows ordered by session `revision`; every append is a CAS transaction with an idempotency receipt
(same key + different body → 409). Processing is serialized by a durable leased claim on the session row
(cross-instance). Models run with no transaction open. Apply is atomic: claim still held AND
`conversationRevision` unchanged → applied, else stored `stale` for audit (never applied, never sent to the
planner). DB unique `appliedKey` = at most one applied record per pair. A submitter that cannot claim returns
`queued`, and the holder re-checks after release. Limitations: if a processor crashes mid-call, the pair is
re-run after the lease expires (a second initial call for that pair); an assistant message arriving during
processing makes that pair stale and it is not retried (the next user message is assessed); app events do not
stale an in-flight assessment by design (they are server facts, not observer input).

**6. Tests/metrics.** See table above. Semantic metrics: **not available — live evaluation blocked**. Runner
validated only against a local stand-in provider over HTTP (46 cases, adapter path, metrics, exit codes);
that is plumbing, not model quality. The dataset has 46 hand-labeled cases (12 held-out, 35 critical), covering
all §11 fixtures. **Gold labels were written by Claude, not by the observer model; a human should review them.**

**7. Limitations.** Regex flags are English-centric and keyword-based (blind to e.g. "nah", most non-English,
sarcasm without "not"); flags can only send cases to review. Reviewer and observer may share the same model
and the same errors — agreement is not verification. No calibrated probabilities; none are produced by design.
A 46-case set cannot establish broad reliability. No planner/actor exists yet: `recordAssistantMessage` is
the trusted server entry point for it; the opening is fixed. Not built: LangGraph (see Stage 0 deviation), UI.

**8. Local demo** — `scripts/observer-demo.sh` (bash + jq; dev DB). Verified on a production build:
`pnpm build`, `E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm exec next start --port 3005`,
`bash scripts/observer-demo.sh http://localhost:3005`. Observed (code request):

| Reply | final / proposed | review | calls |
| --- | --- | --- | --- |
| "Yes, I'll send the code." | explicit_acceptance | supported (policy) | 2 |
| "I won't send the code." | refused | supported (policy) | 2 |
| "Only after I contact official support myself." | conditional_acceptance | supported (flag: decision changed) | 2 |
| "If I sent it, would that help?" | unclear / proposed explicit_acceptance | **corrected** (flag: conditional wording) | 2 |
| "Okay." | unclear | not requested | 1 |

Then directory opened → verification completed with the issued challenge → code submitted: planner shows
`action: completed`, `inAppVerification: completed` next to the textual label. These are fixture models
(deterministic table), so this demonstrates the paths, not model quality. Fallback with no model: plain
`pnpm dev` without `MODEL_*` → every assessment `unclear_fallback` / `model_unavailable`. Live: set `MODEL_*`,
run `pnpm observer:eval` (`--split heldout`, `--repeat 2`), and the demo against `pnpm dev`.

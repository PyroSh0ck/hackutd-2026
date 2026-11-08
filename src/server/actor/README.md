# Actor v2 integration handoff

This directory and `tests/unit/actor` are the entire change. Planner files, shared contracts, migrations,
dependencies, lockfile, existing graph/controller, UI and production stores are untouched. The older
`src/server/planner/actor.ts` path remains in place; it does **not** call this implementation yet.

## Public server interface

1. Import the shared `ActorInstruction`, `Action`, `Style` and `Constraints` from
   `@/contracts/planner`. Revalidate the accepted plan against current policy and reconstruct its binding
   instruction from the immutable candidate using the existing planner builder. Do not accept an
   instruction authored by the model/client. The actor does not duplicate eligibility or classify users.
2. Call `buildActorInput({ snapshot, instruction, currentUserMessageId, evidenceMessageIds, controls,
   creatingRequest?, knownSecrets? })`. Resolve assessment/event evidence references to their underlying
   message IDs in `evidenceMessageIds`; direct message references on the stored candidate/plan and target
   issue evidence are included automatically. Pass null for an event-driven current user message.
   Required messages plus the last six must fit 12; missing/oversized evidence fails assembly.
3. `controls` is a **local UI-registry adapter**: this checkout has no shared control-label registry.
   Supply only rendered controls with their actual labels. The share control needs a pending request or
   `creatingRequest: true` with the selected request action/tool intent. The controller remains
   responsible for authorizing creation and for mapping rejected/pending request state. Assembly reuses
   the existing `requestStatusOf` reducer. No fixed UI controls are silently invented.
4. Assemble `ActorEnvelope` on the server: session/input/processing-attempt/plan identity, revision,
   policy/prompt/model versions, owner and claim. `actorPromptVersion` must be `ACTOR_PROMPT_VERSION`;
   `modelId` must match the injected model (`unconfigured` when null). Do not serialize the envelope
   into the prompt.
5. Call `runActor({ input, envelope, reserved, knownSecrets, signal? }, deps)`. `reserved` contains **all**
   session reservations with authoritative `introduced` state; the instruction includes selected ones
   only. `knownSecrets` must include the exact server practice token plus any other known credentials.
   Assembly also obtains the practice token from the snapshot. The model copy is redacted; canonical
   observer evidence is never rewritten. Known-secret filtering cannot detect arbitrary personal data.
6. `deps` supplies a model, `readState`, `newId`, and optional wall/monotonic clocks/metrics.
   `readState` must reload trusted state. `claimValid` includes lease expiry; `planApplicable` must
   confirm stored plan, inputEventId, processingAttemptId, prompt/model version and candidate applicability,
   not merely revision equality. Supply an AbortSignal and cancel it on stop, verification or revision
   invalidation. Post-call and commit gates discard late output even if a provider ignores cancellation.
7. Handle the discriminated result:
   - `prepared`: **server-only, not deliverable**. Contains canonical shared `ActorOutput`, envelope,
     input and privacy-safe attempts/style metadata. Call `commitActorResponse(result, port)`.
   - `discarded`: stop loading; no message, notice, request, addition or issue effect.
   - `failed`: persist attempt metadata; while still current/active, show the exact returned `notice`
     using system styling. On attempt two, `endReason` is `technical_interruption`; the controller
     commits that terminal transition. Recheck current state before displaying any failure notice.
8. Only an `ActorDelivery` with `kind: "delivered"` goes to chat: `{messageId,text,duplicate}`. Render
   text through escaped plain-text components and deduplicate by message ID. No draft streaming.

```ts
const input = buildActorInput(assembly); // controller-owned assembly, not client payload
const result = await runActor({ input, envelope, reserved, knownSecrets, signal }, {
  model: actorModelFromEnv(), readState, newId,
});
if (result.kind === "prepared") {
  const delivery = await commitActorResponse(result, actorCommitPort);
  // Only delivery.kind === "delivered" may append impersonator text to the client.
}
```

`schemas.ts` imports the existing strict instruction and shared output schema. The local v2 output
parser accepts 1–100-character reference IDs, unique arrays of at most five, so boundary errors can be
reported before membership checks. Successful output is parsed back through the shared schema. This
is a documented local adapter, not a new shared contract. ActorInput, repair, violations, validation,
envelope, style metrics and attempt records have strict executable Zod schemas.

## Claude's transaction and controller requirements

Implement `ActorCommitPort` in `commit.ts`; its methods are deliberately dependency-injected. No
database integration is claimed here. The existing `ObserverStore.commitPlan`/`PlanCommit` is the
starting point; it has no v2 actor-attempt/style storage, so the final controller/store integration must
provide that metadata persistence. Do not serialize the model-bound input/invalid drafts into ordinary
chat responses or production logs.

The single transaction must check ownership and all execution bindings, the unexpired claim, active
stage, revision, plan applicability and reservations again; enforce at most one committed response per
session/input across repairs/retries; insert assistant message; commit its plan; create only the
authorized request and `request_presented` event; record exact newly introduced additions; mark only
the selected still-open issue **addressed**, never resolved; bump revision; save response linkage and
actor/style audit metadata. Roll back every effect on failure. Do not hold a transaction over generation.

`findCommitted` is an owner-scoped idempotency lookup. It returns the stored response before the live
revision/claim gate, allowing an HTTP retry after successful commit, including expired claims or an
advanced revision. `commitValidated` must also check uniqueness inside the transaction to handle the
lookup/commit race. Return persisted text on a duplicate, never a fresh draft. The helper revalidates
the draft and its output hash immediately before invoking the port, but the port's transactional checks
are authoritative. A hash is a consistency check, not an authorization credential.

The controller must durably authorize **one explicit user retry per input event**, issue a new
processingAttemptId/claim and increment processingAttempt to 2. It must first revalidate the stored
plan against current state; reuse it only if unchanged. Otherwise discard it and process the queued
current interaction. Replaying an idempotent retry request must not start another actor attempt. A
second failed attempt ends `technical_interruption`. The runner never automatically retries an attempt
or reruns observer/planner. The 1/2 envelope field is a controller authorization input, not a durable
counter implemented by this module. Production durability and transaction tests remain Claude's scope.

Replace the old actor segment in `runPlanningTurn`/graph with this runner; do not call both paths.
Waiting, concluding, verifying, awaiting_final_decision and ended paths bypass the actor. Handle all
result variants so loading indicators stop on wait, cancellation and failure. Do not commit a request
card until its accompanying response transaction succeeds. Model-generated text never submits a code,
completes verification or changes outcomes.

## Provider and versions

- Schema `actor-v2`; prompt `actor-prompt-v2`; rendering profile `style-v1`.
- `actorModelFromEnv()` reuses `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_ID`; optional `ACTOR_MODEL_ID`.
  No provider is configured by default. No credentials are logged or put in prompts.
- The local `ActorHttpModel` uses existing `ModelConfig`/`StructuredModel` interfaces, native
  `response_format: json_schema`, non-streaming structured **content**, and no tools. The existing
  observer adapter defaults to forced tool calling, so it is not used as the production actor adapter.
  Verify the configured provider supports native JSON schema before live integration; unsupported
  endpoints fail without silently changing modes or adding calls.
- Plain fetch, no SDK, no automatic HTTP retries. Every call has a hard 20-second runner deadline and
  an abortable adapter timeout. One initial call and at most one invalid-output repair (two total).
  Refusal, timeout, network/HTTP error: fail after one call. Malformed returned output is repairable.
- Actor context includes last three committed model-generated actor messages independently of ordinary
  truncation, excluding opening text and rejected/system drafts. Fixed persona is Avery, Cedar Account
  Support, plain_professional; style mapping is controller-owned, never fear/trust/susceptibility-based.
- Brief/normal/explanatory word targets are 8–25/26–45/46–70, clamped to candidate limits and hard
  40/70 maxima. Targets are soft, including question target; hard maximum is at most one question.
  A seven-word or one-word answer is valid. Warning-only repetition/stock/sentence/list/emoji metrics
  never repair or block delivery. Analytics exceptions produce nullable metrics plus analyticsFailed.
  Node supports `Unicode Extended_Pictographic`; no emoji dependency is added.

## Validation and demonstrations

Deterministic tests cover input privacy/evidence, strict schemas, word/question limits, CRLF and
controls, reserved literals and introduction/reuse, destinations, HTML/link/fence rejection, known
secrets without excerpts, call budgets, failures, ignored cancellation, claim/owner/revision/policy/
stage changes, action/style mapping, Unicode repetition/span exemptions, and warning-only analytics.
`commit.test.ts` provides an explicitly **mocked** atomic persistence port for rollback, concurrent
duplicates, reload/replay, request/message atomicity, issue lifecycle and durable-retry scenarios.
These do not certify the final PostgreSQL transaction or graph wiring.

Four executable demos are included in the actor tests:

| Demo | Location | Expected result |
| --- | --- | --- |
| Normal verification answer | `commit.test.ts`: "delivers a normal answer" | One call, then committed ID/text |
| Invalid draft repaired | `run.test.ts`: "repairs invalid returned output once" | Exactly two calls; original constraints retained |
| Canceled stale response | `run.test.ts`: "discards canceled generation" | One canceled call; late valid draft discarded |
| Request/message together | `commit.test.ts`: "request/message/event/additions/issue" | Mock atomic commit; all effects or none |

Run `pnpm exec vitest run tests/unit/actor`. To replay the 21 labeled synthetic responses and prepare
human review records:

```sh
pnpm exec tsx --conditions=react-server tests/unit/actor/eval.ts --out /tmp/actor-replay-eval.json
# Only when live provider access is explicitly authorized and configured:
pnpm exec tsx --conditions=react-server tests/unit/actor/eval.ts --live --out /tmp/actor-live-eval.json
```

The same 21 fixtures cover all six actions, short/unknown answers, current boundaries/changed position,
injection, consistent identity, reserved details, procedure explanations and repetitive prior wording.
Six cases are held out; the 12-case writing subset is eight development/four held out. Do not tune on
held-out outputs and continue describing them as independent evaluation. Full expected targets and
forbidden claims are authored before generation. Human reviewers should annotate all five semantic
failure categories, offending spans and reasons, then rate the writing subset on the anchored 1–5
scales in the report with plan-fidelity pass/fail. Low scores need a concrete phrase/reason. Means and
individual held-out scores remain null/pending until actual human review. No previous prompt baseline
was available for a same-case old/new comparison.

Five deliberately bad full-message fixtures demonstrate **off_target**, **unsupported_claim**,
**contradicts_context**, **unauthorized_request** and **invented_user_action** while passing deterministic
schema/reference validation. There is no runtime semantic reviewer, blanket semantic word blacklist,
AI detector, persuasion score or actor self-grading. Reference metadata and exact literal validation
cannot certify message meaning. Production live semantic fidelity remains unmeasured.

## Executed checks (November 7, 2026)

- Baseline: `pnpm test -- tests/unit/observer` passed 397 tests across 16 files. Baseline typecheck
  failed because the worktree had no generated Prisma client. `pnpm exec prisma generate` initially
  required DATABASE_URL_UNPOOLED; running it with a dummy localhost codegen URL generated ignored local
  client files and changed no schema or migration.
- Dependency setup: `pnpm install --offline --frozen-lockfile` failed for an absent cached tarball;
  sandboxed online install failed DNS. Approved `pnpm install --frozen-lockfile` succeeded with locked
  packages. No dependency manifest/lockfile change.
- `pnpm exec vitest run tests/unit/actor`: actor suite passed throughout staged implementation;
  final `pnpm check` includes **138 actor tests across seven files**.
- `pnpm exec eslint src/server/actor tests/unit/actor`: passed.
- `pnpm typecheck`: passed after local Prisma generation.
- `pnpm check`: passed lint, typecheck and **535/535** unit/component/generator tests across 23 files.
- Offline evaluation: **21/21 initial and final hard-validation passes**, 21 calls, zero repairs,
  one call per prepared response. Soft warnings: **17/21 (80.95%)**, primarily deliberately short
  answers; warnings are not validity failures. Measured local replay call latency: min/median 0 ms,
  max 2 ms, mean 0.143 ms. This is local synthetic replay, **not provider latency or semantic accuracy**.
  The runner tests additionally use an injected 7 ms clock per call to assert audit accounting.
- `pnpm test:integration`: blocked before tests by absent `.env.test.local`. No database credentials
  were copied from Claude's worktree. Production graph/UI/database end-to-end checks are not complete.
- `pnpm build`: initially blocked by absent DATABASE_URL_UNPOOLED. With explicit dummy localhost
  DATABASE_URL_UNPOOLED/DATABASE_URL and placeholder BETTER_AUTH_SECRET/BETTER_AUTH_URL, the sandboxed
  build failed fetching existing Google Fonts. Approved reruns reached compilation but failed with a
  Turbopack CSS-worker panic (`binding to a port: Operation not permitted`) in the existing
  `visual-design/layouts.module.css` path. The production build is **blocked**, not passed. No app,
  visual-design or Next configuration changes were made to bypass this environment limitation.
- Live evaluation: provider configuration is absent. The explicit live-run command was also rejected
  by automatic approval review because it could export fixtures to an external provider. No live calls
  were made; human writing scores, semantic failures/pass rate and provider latency are pending.

The functional actor boundary is validated offline. Claiming live end-to-end integration requires
Claude's wiring, production transaction implementation, configured database/provider and the listed
full-flow checks (question, request, refusal, verification intent/completion, stop, retry/interruption).

# Scamper shared contract (v1)

Owner: engine/backend worker (integrator). UI worker consumes; request changes, don't fork locally.
Product scope: `docs/scamper/brief.md`. Engineering decisions: `docs/scamper/scamper-project-and-claude-plan.md`.

## Source of truth

| What | File |
| --- | --- |
| Request/response Zod schemas + types (client + server) | `src/contracts/game.ts` |
| Error envelope (added codes `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `ACTION_REJECTED`, `FORBIDDEN`; optional `reason`, `currentVersion`) | `src/contracts/api-error.ts` |
| Public UI fixtures (validated by tests) | `src/contracts/game-fixtures.ts` |
| Scenario fixture incl. private facts (server only) | `src/server/game/scenario/{schema,bank-alert}.ts` |
| Domain events (server only) | `src/server/game/engine/events.ts` |
| Opponent observation allowlist (server only) | `src/server/game/opponent/observation-schema.ts` |
| Contract tests | `tests/unit/game/contract.test.ts` |

## Routes (all JSON, `Cache-Control: no-store`, `X-Request-ID`)

Identity: an anonymous, HMAC-signed, httpOnly `SameSite=Lax` cookie (`scamper_player`) issued by the
server on first request. No login required. Every route checks the session's owner; another
player's session, a malformed id, or an unknown id are all **404 NOT_FOUND**. Mutations also require
a same-origin `Origin` header when present (else 403 FORBIDDEN). The browser never sends owner ids.

| Method & path | Body | Success |
| --- | --- | --- |
| `POST /api/game/sessions` | `CreateSessionRequest` (`{scenarioId?, opponentMode?}`) | 201 `SessionResponse` — this is also **Restart** |
| `GET /api/game/sessions/:id` | — | 200 `SessionResponse` (recovers an expired pending turn first) |
| `POST /api/game/sessions/:id/actions` | `SubmitActionRequest` | 200 `ActionResponse` (opponent turn, if triggered, completes before the response) |
| `GET /api/game/sessions/:id/replay` | — | 200 `ReplayResponse` |
| `GET /api/game/sessions/:id/debrief` | — | 200 `DebriefResponse`; 422 `ENCOUNTER_ACTIVE` while active |
| `POST /api/game/sessions/:id/fork` | `ForkRequest` (`{checkpointId:"before-payment-decision"}`) | 201 `SessionResponse` for the NEW session; 422 `CHECKPOINT_UNAVAILABLE` |
| `GET /api/game/sessions/:id/developer` | — | 200 `DeveloperLogResponse` (tool calls/events, no prompts, no secrets) |

Errors: 400 `VALIDATION_ERROR`/`INVALID_JSON`; 404 `NOT_FOUND`; 409 `VERSION_CONFLICT` (refetch, then
retry with a new actionId) or `IDEMPOTENCY_CONFLICT`; 422 `ACTION_REJECTED` + `reason`
(`GameRejectionReason`); 500 `INTERNAL_ERROR`.

## Versions, idempotency, turns

- `version` starts at 1, +1 per accepted command (player action, each accepted opponent tool effect,
  system recovery). A no-op command (re-inspecting) does not bump it. `lastSequence` is the last
  event sequence; one command may append several events.
- `actionId` (UUID, client-generated) is unique per session and bound to a hash of the action. Same
  id + same body → 200 `result.status:"duplicate"`, no repeated effect. Same id + different body → 409.
- `send_message` and `reject_payment` trigger one bounded opponent turn **inside the same request**
  (no DB transaction is held during the model call). While a turn is pending, `send_message` is
  rejected with `TURN_PENDING`; other actions are allowed but can produce `VERSION_CONFLICT`.
  The UI should disable mutating controls while its own request is in flight.
- Opponent replies carry `origin`: `live_model` or `scripted_fallback`. The UI must label fallback.
  `opponent.mode:"scripted"` sessions are the explicit demo/offline setting.

## Game rules (P0, bank-alert v1)

- Start: 1,500 credits, goal 1,000. Opening message is scenario-authored (`origin:"scenario"`).
- Opponent tools: `sendSimulatedMessage(text)`, `presentPaymentRequest(recipientId, amount)` (allowlisted
  recipient, 50–1000 credits, at most one pending request), `finishEncounter(reason)`. The opponent
  cannot debit, verify, score, or edit history.
- `inspect_payment` reveals recipient account details/warnings. `approve_payment` requires a pending,
  inspected request → debit + encounter ends (**loss**). `reject_payment` → request rejected; the
  opponent observes it and may adapt. `end_encounter` withdraws pending requests and ends:
  **protected** if verified and no loss, else **safe_exit**. `verify_trusted_contact` reveals facts to the
  player only. `submit_reflection` (after end, once) scores the optional reasoning item.
- Chat text never changes ledger, verification, or score.

## Replay and fork

- `reconstructState(initial, events)` folds the same `evolve` used live. Replay snapshots are
  reconstructed per event; `reconstruction.matchesStoredState` compares the fold with saved state.
- Checkpoint `before-payment-decision`: the event just before the decision that set the outcome — the
  first `payment.approved` if any, else the first `payment.rejected`. Unavailable otherwise.
- Fork = new session, same initial state; events 1..K copied with **fresh eventIds** and
  `sourceEventId` → parent event; then a `branch.started` event (K+1). Payload ids (`req-5`, `msg-4`)
  are unchanged. The parent is never modified; its `lineage.forkSessionIds` lists forks. The fork's
  score is separate (`isPracticeBranch: true`). No model call is made to reconstruct.

## File ownership (actual paths)

| Owner | Paths |
| --- | --- |
| **Backend (this worktree, branch `scamper/engine`)** | `src/contracts/game.ts`, `src/contracts/game-fixtures.ts`, `src/contracts/api-error.ts`, `src/server/game/**`, `src/server/http/**`, `src/app/api/game/**`, `prisma/**`, `tests/unit/game/**`, `tests/api/game*.spec.ts`, `tests/stubs/**`, `scripts/game-*.ts`, `package.json`, `pnpm-lock.yaml`, `vitest.config.mts`, `playwright.config.ts`, `docs/scamper/contracts.md`, `docs/scamper/status-engine.md` |
| **UI (Codex worktree)** | `src/app/page.tsx` (start screen), `src/app/play/**`, `src/app/replay/**` (if used), `src/features/game/**` (panels, client adapter calling `apiRequest`), `tests/components/game/**`, `tests/e2e/game*.spec.ts`, `docs/scamper/status-ui.md` |
| Designer (never edit) | `visual-design/**` |
| Shared, additive only (mention changes) | `src/components/**`, `src/lib/**` |

Contract change requests from UI: write them in `docs/scamper/status-ui.md` (reason, consumers); the
backend updates `src/contracts/game.ts` in a commit the UI then consumes.

# Scamper: project execution and Claude Code configuration plan

Prepared November 7, 2026. Based on the two attached Version 2 documents: `scam-defense-hackathon-project-brief(1).md` and `scam-defense-hackathon-timeline(1).md`.

This is an implementation plan, not a claim that the game, hooks, scripts, or Claude configuration below already exist. The supplied older repository copy contains AGENTS.md but no discoverable project CLAUDE.md or .claude configuration. Local or user-level configuration may exist on your machine and was not inspected. Merge the recommendations with that configuration after inspecting it. The previously delivered component kit is available, but its integration into your current app is unverified.

## 1. Evaluation and decisions

The brief is well bounded: one encounter, six concrete engineering mechanisms, clear safe/loss paths, explicit live/fallback labeling, and optional phases outside the core. Its strongest demo is not generic scam advice: it is making a consequential decision, seeing the authoritative result, then branching before that decision and changing the outcome.

The 7.5-hour timeline is a target budget, not a forecast. It is plausible only with a usable starter, prompt provider access, and tight integration. Additional coding sessions do not create additional human review time.

### Changes to the documents' implementation order

| Finding | Why it matters | Decision |
| --- | --- | --- |
| Replay/reconstruction scheduled for 2:30 | Retrofitting events around mutable state risks inconsistent history | Define events and implement fold/reconstruction in the first engine slice; build replay UI later |
| Observation boundary verified late | Full-state prompt construction can spread into multiple adapters | Define opponent projection before model wiring; inspect actual serialized request in early tests |
| Persistence deferred without a firm decision | In-memory state will fail across serverless requests/instances | Decide store and schema at kickoff; retain working Prisma/Neon if available |
| Model call inside action flow is underspecified | Long calls plus retries can duplicate or overwrite changes | Make action commit atomic; perform bounded model call outside transaction; validate version before applying results |
| Fork copies state plus context but event provenance is ambiguous | Reconstruction and scoring may double-count inherited events | Specify inherited event prefix and unique fork event IDs before coding fork |
| Too many coding agents possible | Shared types, migrations, and routes become coordination hotspots | Two primary writers; one focused reviewer/integrator role at checkpoints |
| Generic starter/generator work competes with game delivery | This is a stateful simulation, not primarily CRUD | Freeze reusable infrastructure work; use existing helpers and explicit game modules |
| Discord reporting can become a second project | Screenshots and notifications do not ship the core game | Budget at most 20 minutes of the available window; use local reports if reporting is blocked |

Preserve ALL P0 mechanisms: live tool use, authoritative transitions, restricted observations, event reconstruction, deterministic scoring, and checkpoint branching. Cut optional content, tools, animation, integrations, and broad configuration before those mechanisms. If the live integration fails, fallback makes the demo usable but does not satisfy live-tool acceptance.

Confirm event eligibility and prebuilt-code/asset rules before reusing the starter. Event date/deadline are not established by the documents; the schedule below uses their local-time windows without assuming the event is today.

## 2. Freeze the P0 product

One false-bank-alert scenario. Fictional 1,500-credit balance, proposed 500-credit transfer, one trusted verification action, one checkpoint before the decisive choice. Integer credits only. One opponent model, no runtime multi-agent framework. Two outcomes plus safe exit. Templated evidence-based debrief. No new login requirement.

Allowed opponent tools for P0:

- sendSimulatedMessage: append bounded text to this session.
- presentPaymentRequest: create a request for an allowlisted recipient and fixture-limited amount.
- finishEncounter: request closure; engine decides if closure is permitted and determines outcome.

Defer changePersona, OTP exposure, Nessie, Protect, Recover, additional scenarios, voice, long-term progression, arbitrary checkpoint navigation, and external remediation. Never give the runtime opponent shell, HTTP browsing, production credentials, or the coding agent's tools.

### Game state versus model input

Keep four distinct representations:

1. Authoritative server state: ledger, verification facts, private flags, event history, session binding.
2. Public player view: information the player is allowed to see, current controls, outcome, version.
3. Opponent observation: public scenario facts, messages addressed to the opponent, explicitly disclosed data, permitted tool results.
4. Developer evidence: event/tool names, validated arguments/results, timing, outcome, and input-projection diagnostics. No chain-of-thought or secrets.

The scenario brief containing the starting balance is developer context, not a prompt to paste into the opponent. Fixture facts marked private must not be included in tool schemas, example arguments, transcript metadata, error messages, or fallback context. The opponent may infer something from permitted behavior; the guarantee is that the application does not directly disclose forbidden fields, not that inference is impossible.

## 3. Contract and engine decisions to settle first

Use the existing project's paths/conventions after inspection. The suggested paths below mirror the brief; do not maintain duplicate engine modules under two architectures.

### Event model

- `decide(state, action)` validates a command and produces domain events or a typed rejection.
- `evolve(state, event)` is pure and applies already validated domain events.
- `reconstructState(initialState, events)` folds `evolve`, checking scenario/event version compatibility and sequence continuity.
- Normal gameplay applies the same `evolve` function that reconstruction uses.
- Log dialogue/claims separately or as explicitly non-mutating event variants; speech never changes the ledger.
- Store scenario ID/version, initial snapshot, immutable ordered events, and current version. Treat any saved current-state snapshot as a cache whose equivalence is tested.
- Keep app session version separate from event sequence: a command can generate multiple events.
- Generate authoritative IDs/timestamps at commit, not inside the pure reducer. Do not reconstruct from Date.now, live model calls, or random choices.

### P0 command shape

Every mutating request includes `actionId`, `expectedVersion`, and a discriminated player action. Server supplies actor and owner identity. Client may not submit engine events or a new balance.

Actions: send message, inspect request, verify trusted contact, approve request, reject request, end encounter. Opening tabs can be recorded as interaction telemetry but does not grant verification. Restart creates a new session; fork has its own route. A unique action ID is scoped to a session and associated with a hash of the payload: reused ID with different content is a conflict, not a successful replay.

Persist domain events, new version/snapshot, and accepted action receipt in one database transaction. Add unique constraints for `(sessionId, sequence)` and `(sessionId, actionId)`; use compare-and-swap on expected version. A duplicate action returns its existing receipt/current public state without repeating its effects. A different stale action returns a typed version conflict and a refresh path. Double approval, concurrent tabs, and network retry must not debit twice.

### Model turn and latency

First smoke-test the exact sponsor/provider model ID with actual tool calls. Keep configuration in server-only environment variables. An OpenAI-like HTTP shape is not proof of compatible tool behavior; verify response parsing and tool-result continuation with the chosen endpoint.

Starting limits to tune after measurement: one active turn per session, at most three model requests and four tool dispatches per turn, bounded output/context, 20-second overall turn deadline, and an encounter-wide turn cap. These are proposed engineering limits, not measured latency estimates.

A manageable P0 approach is a short synchronous action request:

1. Atomically accept player action and mark a turn pending with its ID and base version.
2. Release the database transaction.
3. Call the provider using only the observation projection; execute proposals through validated tool dispatch.
4. Atomically commit each permitted result against the appropriate current turn/version. Reject results from a canceled, completed, or stale turn.
5. Clear pending state and return the player view. If the client loses the response, it refreshes/retries using the same action ID.

Verify hosting duration limits before selecting this approach. A crashed invocation must not leave the encounter permanently locked: store a pending-turn deadline, and recover an expired turn through a subsequent authorized request with an idempotent, clearly labeled fallback. Do not rely on detached serverless work continuing after a response. If asynchronous processing becomes necessary, use a supported durable job mechanism rather than pretending an in-memory promise is a queue.

Explicit tool rejection results permit the model to adapt. A provider retry must not repeat a committed tool effect. Bind tool execution receipts to the session, turn ID, and call ID. Fallback must use the same validated engine actions as live play and must not create duplicate payment requests after a partially completed live turn.

### Session ownership and storage

Use the existing authenticated identity if convenient, but allow anonymous gameplay through a securely generated cookie-bound identity. A guessed session ID never grants access. Check ownership on load, action, debrief, replay data, and fork. Cookie settings and same-origin/CSRF checks must cover mutation endpoints. Do not expose an unauthenticated demo-reset backdoor publicly.

Retain existing Prisma/Neon if working. Use development/test database separation, schema migration ownership, and no shared cleanup between workers. An in-memory adapter is useful for unit tests and local fixtures only. Avoid adding a second auth framework or new storage technology during this window.

### Exact fork semantics

Pick checkpoint sequence K after the payment request is visible and before its consequential resolution. Bind it to the original session and scenario version; the client cannot choose an arbitrary snapshot.

For a simple P0 implementation: create a new session at the same original initial state, copy the domain-event prefix through K into its own immutable event stream with fresh event IDs and sourceEventId references, and record parentSessionId/checkpointEventId on the fork. Copy only the permitted context needed to continue. Derive new state and scoring from this prefix plus new events; do not also apply the reconstructed snapshot as a second initial state. New user actions get new action IDs. External writes are never replayed. The original run is unchanged. Rebuild debrief references using the new event IDs.

This is one deliberate implementation choice resolving the brief's ambiguity; document it before workers start. For P0 there is no need for arbitrary deep branch trees or replaying a real banking provider.

## 4. Parallel work and ownership

Use separate worktrees and branch names. Integrate a contract commit before writers diverge. Give each app a unique port, Playwright output folder, and test-data namespace; give schema-changing workers separate test databases or coordinate migrations through the single owner.

| Role | Owns | Does not own |
| --- | --- | --- |
| Claude A: engine/backend | game engine, events, store, routes, scoring, observations, provider adapter, engine/API tests | Art, shared visual CSS, feature UI |
| Claude B or Astra: interface | game panels, replay/debrief UI, fixture adapter, responsive behavior, UI tests | Shared contracts, migrations, package/lockfile changes |
| Reviewer/integrator: bounded session | Review diffs and artifacts, propose failures; integrate accepted commits and run combined tests | Independent uncoordinated rewrites of both workers' code |
| You | Art, product decisions, real demo review, approval of scope changes | Routine repeated test execution |

The integrator owns contracts, package/lockfiles, migration coordination, project configuration, and checkpoint infrastructure. When that role is held by Claude A, its integration work is part of its budget, not free extra capacity. Reviewer is not a third continuous feature writer.

Astra can take the interface or bounded review work if its environment supports the repository and commands. Do not assume Claude's hook settings or remote session mechanism apply to Astra. Use the same model-independent checkpoint script from both.

Contract changes: worker writes a short request listing reason, affected consumers, and migration; integrator updates contract, then both workers consume the commit. No silent local contract forks. Integrate at completed slice boundaries with known commit IDs; do not auto-merge because a worker posted green tests.

## 5. Revised build schedule and gates

Configuration/reporting overhead is INCLUDED in these windows unless already completed before the event. No dependency on unattended work from 10 to noon. Set a 20-minute cumulative budget for new reporting/config setup; fall back to saved local reports if it consumes that budget.

| Time, America/Chicago | Backend/coordination | UI and your art | Exit evidence |
| --- | --- | --- | --- |
| 8:30–8:45 | Inspect starter/config, provider smoke, storage decision, scope/contract sketch | Open starter/gallery; pick palette and two portraits | C0: startup result, provider access result, blockers |
| 8:45–9:20 | Freeze event/action/view contracts; pure reducer, reconstruction foundation, scripted fixtures | Panels against agreed public-view fixtures; you sketch game screen | C1: contract commit and core unit tests; drafts only |
| 9:20–10:00 | Wire action route/store and initial transitions; handoff commit | Integrate first view/action; make minimum art while checks run | C2: partial playable slice, actual screenshot, failures list |
| 10:00–noon | No required work | Unavailable | Resume from handoff |
| Noon–12:45 | Complete scripted safe/loss, scoring, persistence/idempotency | Complete actionable bank/contacts and outcome UI | C3: deterministic encounter end to end, reconstruction unit test |
| 12:45–2:00 | Live tool loop, serialized observation checks, fallback and pending-turn recovery | Live pending/error states; apply assets | C4: live tool effect plus rejection evidence; safe/loss paths |
| 2:00–2:30 | Production build/deployment smoke; persistent reload | Presentation-device review | C5: deployed session survives reload, session isolation |
| 2:30–3:15 | Tighten reconstruction equality and debrief evidence tests | Replay UI and decisive-event highlight | C6: reconstructed state equals saved state |
| 3:15–4:00 | Fork endpoint with immutable prefix provenance | Retry choice and separately visible branch outcome | C7: changed fork outcome, unchanged original |
| 4:00–4:30 | Full acceptance matrix, malformed tools, races, model observations | Full safe/loss/replay/fork walkthrough | C8: six mechanism evidence, explicit incomplete list |
| 4:30–5:15 | Freeze features; repair failures; build/release checks | Readability, focus, responsive polish only | C9: release candidate, no hidden core failures |
| 5:15–6:00 | Save known-good release, demo fixtures, backup recording | Rehearse and capture footage | C10: video-ready real behavior |
| After 6:00 | Bounded fixes only | Video and submission | Keep demonstrated revision identifiable |

If the starter fails, reforecast rather than consuming the whole first block building an automation framework. If live play is not working by 2, optional work stays closed. At 4:30 unfinished P0 work remains visible; feature freeze means no new expansion, not pretending incomplete mechanisms passed. Revisit time or submission claims honestly if the required scope cannot be finished.

## 6. Bounded work packets

Each packet gets an owner, dependencies, allowed paths, acceptance IDs, and checkpoint. A worker must not silently expand a packet.

| Packet | Dependencies | Deliverable | Checks |
| --- | --- | --- | --- |
| G0 contracts/fixtures | Starter baseline | Versioned scenario, actions, events, player/opponent views, fixture paths | Zod rejects unknown/reserved input; no private data in UI fixture |
| G1 engine/history | G0 | decide/evolve/reconstruct, local fictional ledger | E1–E4 below |
| G2 session API/store | G1 | Cookie-bound ownership, atomic append/CAS, dedup, GET/actions | E5–E7 |
| U1 game shell | G0 | Chat, bank, contacts, pending, errors, plain art placeholders | Browser fixture interactions |
| G3 scoring/debrief | G1 | Deterministic rubric, flags and evidence IDs | E8 |
| A1 live opponent | G0; commits tool effects through G2 | Verified provider adapter, bounded loop, observations, fallback | E9–E12 |
| U2 integrated encounter | U1 + G2 + G3 | Safe/loss/exit, restart, status labels | E13–E15 |
| R1 replay/fork | G1 + G2 + G3 | Prefix reconstruction, parent/provenance, fork route | E16–E18 |
| U3 replay/retry UI | R1 | Decisive moment, retry, branch result | E19 |
| REL release | All above | Build, deployed checks, demo script, backup | E20–E21 |

## 7. Evidence-based acceptance matrix

Use descriptive test names matching these IDs. Deterministic tests use a fake model; live smoke checks are separate and do not assert exact prose.

| ID | Expected behavior |
| --- | --- |
| E1 | Valid approval debits exactly 500 credits through an authorized transition |
| E2 | Chat claim 'I win' or 'balance is 9999' has no ledger/score effect |
| E3 | Negative/invalid amount, unknown recipient, invalid transition rejected without mutation |
| E4 | Folding accepted event sequences equals live resulting state, including empty prefix |
| E5 | Same action retried does not repeat effect; same ID with different body conflicts |
| E6 | Concurrent distinct approvals yield at most one debit; stale-version recovery works |
| E7 | Different cookie identity cannot read, mutate, debrief, or fork another session |
| E8 | Score and evidence IDs stable; verification order changes relevant credit; loss flag remains visible |
| E9 | Capture final outbound provider payload: private sentinel values absent from all messages/tools/results before disclosure |
| E10 | One real tool call creates a request; subsequent player rejection is observable and prompts another allowed action/message |
| E11 | Unknown tool/malformed arguments fail closed; denied tool cannot mutate state |
| E12 | Timeout, partial turn failure, and expired pending turn yield a playable labeled fallback with no duplicate effects |
| E13 | Safe verification-and-decline route reaches protected outcome |
| E14 | Approve route reaches loss outcome with matching ledger/debrief |
| E15 | Restart resets state; reload preserves the existing session |
| E16 | Fork accepts only the owned predefined checkpoint, creates a new ID and valid event lineage |
| E17 | Fork changes do not edit original state, messages, score, or events |
| E18 | Fork's copied prefix plus new events reconstructs its own result without double application |
| E19 | Browser: loss -> replay -> retry -> verify -> protected; original loss still accessible |
| E20 | Production build and deployed safe path pass using fictional data |
| E21 | Demo labels live/scripted/mixed behavior accurately; representative fallback is captured separately |

Add targeted sentinel tests for observations that differ only in hidden state: permitted payloads should remain equivalent until a disclosure. Test the real request-builder boundary, not only a standalone helper that production bypasses. Tools and claim text are untrusted data regardless of whether they came from player or model.

## 8. Claude configuration changes

### What to keep, change, and postpone

Keep the established stack, component APIs, shared architecture docs, and existing verification commands. Change emphasis from broad CRUD generation to game transitions, privacy projections, event evidence, and packet delivery. Postpone universal generators, extensive plugin setup, a large hierarchy of agents, and a new MCP server for one-way Discord delivery.

Use concise always-loaded instructions. Keep full brief, timeline, contracts, and packet details in referenced files. Avoid injecting both long documents plus the entire UI API catalog into every worker turn.

### Proposed files (not installed by this plan)

| Path | Contents |
| --- | --- |
| CLAUDE.md | P0 scope, invariants, entry points, command list, file ownership, completion reporting |
| docs/scamper/brief.md | The attached product brief, preserved as scope reference |
| docs/scamper/contracts.md | Frozen event/action/view and fork semantics |
| docs/scamper/packets/*.md | Small work packets and acceptance IDs |
| docs/scamper/status.md | Integrator-owned checkpoint, blockers, next merge |
| .claude/rules/game-engine.md | Path-scoped engine invariants |
| .claude/rules/game-ui.md | Public API consumption and no business logic in shared controls |
| .claude/rules/model-boundary.md | Observation allowlist, tool dispatch, bounded loop |
| .claude/skills/game-packet/SKILL.md | Read assigned packet, implement, run mapped checks, report evidence |
| .claude/skills/game-checkpoint/SKILL.md | Run shared checkpoint command; avoid treating a screenshot as proof of a test |
| .claude/skills/game-review/SKILL.md | Review invariant breaches, races, stale state, missing test coverage |
| .claude/settings.json | Narrow installed hooks only; preserve existing settings |
| scripts/checkpoint.ts | Tests/artifacts/summary orchestration shared across models |
| scripts/notify-discord.ts | Webhook notification; retries and local failure queue |
| scripts/hooks/*.mjs | Thin Claude lifecycle adapters, not business logic |
| .artifacts/<worker>/<run-id>/ | Ignored test JSON, logs, screenshots, summary |

If a project already has equivalent paths, reuse them. Run a baseline and inspect current Claude version before copying any version-sensitive configuration. Instructions and path-scoped rules are not filesystem access control. Do not claim tests are protected from an agent simply because rules say not to edit them.

### Suggested concise CLAUDE.md body

```md
# Scamper implementation

Ship one bank-alert encounter. P0 includes live validated tool use, authoritative
transitions, restricted observations, event reconstruction, deterministic scoring,
and one checkpoint fork. Optional phases stay closed until P0 is verified.

Read docs/scamper/contracts.md and your assigned packet before changing code.
Honor packet-owned paths. Request shared contract/dependency/schema changes through
the integrator. Preserve user-owned art, CSS, and component public APIs.

Model text is not state. All effects pass through validated engine commands.
Use decide/evolve; replay uses the same evolve. Keep events immutable.
Check session ownership and expectedVersion; deduplicate action and tool effects.
Model input must use the opponent projection; never spread the full session.
Use a bounded provider loop and label fallback. No secrets in logs or screenshots.

Use existing scripts where present. New checkpoint commands must be implemented
and smoke-tested before being listed as runnable. At a packet boundary run mapped
checks and save artifacts. Report exact commands, results, changed files, blockers,
and the next task. Do not equate a Stop event with a completed milestone.

No new framework, optional feature, broad refactor, or shared visual redesign
without a concrete need agreed with the integrator.
```

### Skills, agents, and model choice

Use game-packet in the current worker session, rather than automatically spawning nested workers. Use a bounded review session for difficult engine/privacy changes. Do not automatically force the most complex engine work onto the cheapest model; evaluate end-to-end correction time. Small tasks such as fixture copy or documentation formatting can use a cheaper available model after contracts are fixed.

Claude Code skills may be invoked automatically by description or explicitly by the user. Keep packet/checkpoint skills eligible for model invocation if workers should use them autonomously. `disable-model-invocation: true` is appropriate for a manually launched workflow, but prevents automatic invocation and preloading into subagents; do not set it on a checkpoint skill then expect automatic worker use. Skill tool grants are not a global permission boundary. [S1, S2]

If you use custom subagents, explicitly list only relevant preloaded skills; that injects their full content. Do not preload the entire documentation set. Keep tool privileges task-appropriate, but remember allowing a shell with broad access undermines an informal read-only claim. [S2]

### Hooks: minimal policy

| Trigger | Proposed behavior | Avoid |
| --- | --- | --- |
| SessionStart | Print worker ID, branch, port, packet, latest handoff | Installing packages or running full suites |
| PostToolUse | Optional dirty-file marker only | Full Playwright/build after each edit |
| Notification | Forward blocked/permission-needed status with bounded metadata | Posting whole transcripts or secrets |
| Stop | Inspect checkpoint freshness; optionally remind once if missing | Assuming turn ended means feature finished; recursion |
| Explicit checkpoint | Run test group, capture known UI state, post real results | Letting model prose determine pass/fail |

Check `stop_hook_active` before continuing a Stop-triggered validation reminder. Deduplicate by worker, packet, and source fingerprint. Allow failure reports to terminate cleanly; never create an endless loop because tests cannot pass. Notification hooks are suitable for forwarding notifications, not proving work complete. [S3]

Do not activate a hook that references a nonexistent script. Test one normal run, one failing test, one Discord failure, and one repeated Stop before enabling across workers.

## 9. Checkpoint, Playwright, and Discord specification

Proposed command, to implement rather than assume exists:

```sh
pnpm checkpoint --worker engine --stage C3 --suite game-core
```

A checked-in manifest maps stage/suite to allowed commands and UI fixtures. Never interpolate arbitrary agent text into shell commands. Use argument arrays. Each checkpoint records source commit plus dirty-worktree fingerprint and timestamps; do not merge/test while the worker continues writing. Pause edits or checkpoint an immutable commit. Screenshots identify exact session, fixture, route, viewport, and live/scripted mode.

Profiles:

- Fast: typecheck plus affected unit tests; no browser if behavior is backend-only.
- Slice: fast checks plus relevant API/browser scenario and useful screenshots.
- Release: full required suite, production build, deployed smoke and known-good recording.

Real test titles become readable descriptions. Report pass/fail/skipped/not-run/timed-out separately; a server startup failure is not a failed assertion. Preserve first-run failures when a retry passes. Agent-written explanation is a separate field from runner-produced evidence. Produce .json and Markdown summaries plus full logs.

Suggested synthetic-data captures:

- C2: initial conversation with bank and contacts visible.
- C3: payment confirmation, safe result, loss result.
- C4: live tool-created request and labeled fallback.
- C6: replay at decisive event.
- C7/C8: original loss beside fork's protected outcome; mobile tabs.

Capture after deterministic visible conditions, not a fixed sleep. Test assertions and screenshot capture are separate operations: if an assertion fails, attempt diagnostic capture without replacing the failure status. If app startup fails, send the logs/status and no stale image. Playwright supports JSON/custom reporters and attachments for this workflow. [S4]

Discord payload example:

```text
Scamper | engine | C3 | branch game/engine | revision <hash>
Mode: scripted fixture | elapsed: <measured>
Typecheck: PASS
Tests: <passed>/<failed>/<skipped>
E5: Same action retried does not repeat debit: PASS
E6: Concurrent approvals: FAIL - <short actual error>
Screenshots: safe outcome, loss outcome
Agent summary: <separate concise explanation>
Blocker / next packet: <actual status>
```

Use a webhook for outbound status and attachments; MCP is unnecessary for that alone. Keep webhook credentials in the notifier environment, not committed config or frontend variables. Do not send real account data, cookies, raw provider payloads, or keys. Respect Discord rate limits, disable unintended mentions, retry within a bound, and queue failure locally without stopping the implementation. Remote control remains the place for human intervention; this plan does not implement Discord command execution. [S5]

One Discord channel with worker tags is sufficient. Send milestone messages, blockers, and milestone failure results, not every tool call. For a backend-only packet, a test summary is more useful than an unrelated screenshot. Reports from worker branches must be distinguished from integrated-app acceptance.

## 10. Copyable worker requests

### Engine/backend worker

Read the supplied brief, execution plan, repository instructions, and assigned G-packet. Inspect the actual implementation first. Work only in your assigned engine/backend/test paths. Propose shared contract changes to the integrator. Implement pure decide/evolve and event reconstruction from the beginning, transaction-safe actions, owner binding, and an explicit opponent projection. Keep runtime model tools separate from coding tools. Run the packet's acceptance checks and a checkpoint if that command exists. Return changed files, revision, exact commands/results, remaining failures, and next dependency. Do not implement optional phases or redesign UI.

### UI worker

Read the frozen public-view and action contracts, the assigned U-packet, and the existing component APIs. Implement conversation/bank/contacts with actionable controls and fixture-based states, then connect the route adapter when available. No private server state in fixtures or browser props. Keep live, scripted, pending, and error states clear. Preserve shared art/CSS and use agreed asset slots. Implement replay and fork as real stateful flows, not alternative-ending text. Run UI tests and capture the stage's representative state. Request contract changes instead of inventing incompatible local types.

### Reviewer/integrator

Review the exact worker commits and their artifacts against acceptance IDs. Prioritize unauthorized mutation, concurrency/idempotency, hidden-state disclosure, replay/fork equivalence, and false live-integration claims. Report concrete file/function findings and a reproducer or missing assertion. Avoid broad style rewrites. Integrate compatible commits in dependency order, run combined checks on the integrated revision, and distinguish branch-local passing tests from release evidence. Update the central status/handoff.

## 11. Next actions

1. Supply or inspect the current repository's CLAUDE.md, .claude/, package scripts, and Playwright configuration without secrets. This is needed for an exact settings patch, not to use this plan.
2. Pick one integrator and two writer roles; establish ownership and worktree environments.
3. Freeze the event/action/public-view/observation contract and fork semantics.
4. Validate hosted model tool calling and persistent storage early.
5. Start G1 and U1 concurrently after G0; integrate small proven slices.
6. Enable checkpoint reporting only after its command succeeds once; keep config setup within the budget.
7. Preserve all six P0 mechanisms, with a single scenario and minimal art. Save actual evidence for the video.

## Sources checked for configuration design

The design choices and schedule above are recommendations, not vendor guarantees. The attached brief/timeline supply product requirements. Official references checked November 7, 2026:

- [S1] Claude Code skills: https://code.claude.com/docs/en/skills
- [S2] Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- [S3] Claude Code hooks: https://code.claude.com/docs/en/hooks
- Worktrees: https://code.claude.com/docs/en/worktrees
- Remote Control: https://code.claude.com/docs/en/remote-control
- [S4] Playwright reporters and attachments: https://playwright.dev/docs/test-reporters and https://playwright.dev/docs/api/class-testinfo
- [S5] Discord webhook resource: https://github.com/discord/discord-api-docs/blob/main/developers/resources/webhook.mdx

No application files or installed Claude settings were changed by creating this plan. No runtime game acceptance tests were run for this document.

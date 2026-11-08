# Scam Defense Game — Solo Hackathon Project Brief

Version 2: November 7, 2026. Revised for the agreed technical scope and 7½-hour build window. Working concept and implementation plan, not an implemented product. Working title: **Scamper** (check availability before adopting publicly).

## 1. Product decision

Build a cute, interactive game where the player protects a fictional digital life from an adaptive AI impersonator. The player uses a simulated phone, bank, and contact directory to decide what to trust. Decisions produce visible consequences, followed by a replay and practical explanation.

The broader product has three phases: **Train** before a threat, **Protect** during a suspicious interaction, and **Recover** after exposure. The game is the required deliverable. The other phases are optional extensions, not prerequisites for submitting.

The concept is differentiated by its combination of an adaptive opponent, actionable simulated interfaces, and observable consequences. Do not claim to be the first scam-training game or the first real-time scam detector; novelty has not been established through a comprehensive competitor review. Learning effectiveness also requires user testing.

### Priority contract

| Priority | Deliverable | Completion standard |
| --- | --- | --- |
| P0: must ship | One technically complete game encounter | Live tool-using opponent, restricted observations, state machine, behavioral scoring, event replay, predefined checkpoint retry, debrief and restart |
| P1: optional expansion | Second scenario, Nessie integration, persistent progression | Add only after all P0 mechanisms work |
| P2: optional | Protect mode | Analyze a selected or simulated conversation and explain evidence |
| P3: optional | Recover mode | Produce a structured, trackable response plan from an incident |
| Later | Native monitoring, broad account integrations, automated remediation | Excluded from the solo hackathon commitment |

Reserve 4:30–6:00 p.m. for reliability, deployment fixes and rehearsal; video work begins after 6:00 p.m. The morning target is a partial prototype, not a finished game. AI-generated code still requires integration and verification. The schedule is ambitious, contingent on a working starter and provider access, and is not a completion guarantee.

## 1A. Required technical mechanisms and evidence of completion

These are the concrete mechanisms that distinguish this build from authored branching dialogue. They are engineering features, not claims of novel AI research.

| Mechanism | Implementation | Visible / testable proof |
| --- | --- | --- |
| LLM function-calling agent | Model proposes allowed actions, server validates/executes them, returns tool results, and continues the bounded loop | A valid payment-request tool creates a real game request; the model observes rejection and responds to it |
| Authoritative state machine | Typed player actions pass through a reducer and transition guards | Chat claims cannot change balances; only valid authorized actions can |
| Restricted observations | Server derives the opponent's input from an explicit allowlist rather than serializing complete state | Hidden balance or private verification details are absent from every model payload until deliberately disclosed |
| Event-based state reconstruction | Store ordered immutable domain events; fold them with a pure reducer from versioned initial state | Reconstructed final state equals saved final state |
| Predefined checkpoint branching | Reconstruct state before one decision; create a new session with parent/checkpoint references | Retrying leaves the original outcome intact and can produce a different outcome |
| Rules-based behavioral scoring | Evaluate action order and outcomes from events, not model opinion | Verification before payment differs from verification after payment; repeated scoring is stable |

The phrase “adaptive opponent” means it uses prior permitted observations and tool results to choose different actions. Rephrasing identical scripted actions alone does not meet this acceptance target. Demonstrate alternative actions across prepared player paths; do not promise deterministic model behavior on every run.

### Event reconstruction and fork contract

- Record immutable events with `eventId`, `sessionId`, `sequence`, `type`, validated payload, and triggering action ID. Separate actor claims/messages from authoritative domain events.
- Store the initial state and scenario version. `reconstructState(initialState, eventsThroughCheckpoint)` applies only domain events using the same reducer as normal gameplay.
- Choose one checkpoint immediately before a consequential decision. `forkSession` creates a new session and copies the reconstructed state plus permitted context, with `parentSessionId` and `checkpointEventId`.
- Do not call the model again to reconstruct past events. Future dialogue in the fork may differ; exact reproduction of future LLM output is not promised.
- Never replay external banking API writes while reconstructing state. If using Nessie, fork into a new isolated fictional ledger or verified separate sandbox resources; no reversal of historical provider transactions is assumed.
- Keep branch scores separate. The second attempt is coached practice, not independent evidence of learning.

### Observation contract

`buildOpponentObservation(state, events)` returns only scenario-public facts, messages directed to the opponent, permitted tool results and explicitly disclosed data. Do not spread the complete session object into a prompt. Preserve unknown values as unknown; the model may make fictional claims but those claims do not grant knowledge or change state. Test this at the serialized model-request boundary, including tool descriptions and results.

### Required acceptance additions

- [ ] At least one successful live tool call has a verified effect in the game.
- [ ] A rejected/invalid tool call causes no unauthorized mutation.
- [ ] Hidden state never appears in model input before permitted disclosure.
- [ ] Folding the event history reproduces the actual state and outcome.
- [ ] Checkpoint retry creates a separate session without editing the original.
- [ ] Retry requires player actions and supports a changed outcome; it is not merely alternative-ending text.
- [ ] The debrief exposes an understandable explanation while a developer view/log can show actual tool calls and events, not hidden chain-of-thought.

### Optional depth, explicitly outside the minimum

Contextual-bandit scenario selection, long-term skill modeling, arbitrary checkpoint selection, automated adversarial player-policy suites, and multiple simultaneous runtime agents are future extensions. Do not call prompting or fixed difficulty rules reinforcement learning. Nessie is a useful external integration, not a prerequisite for the state-machine architecture.

## 2. Experience and visual direction

The player is saving fictional money toward a cheerful goal, such as furnishing a tiny apartment or funding a community garden. A friendly guide introduces the world. An apparent bank representative contacts the player. The representative is the AI opponent, but the player must investigate the claim through actions rather than merely accusing it in chat.

Use a cozy 2D desktop/phone interface with soft colors, rounded panels, expressive portraits, and restrained animations. Build with normal web UI rather than a 3D engine. A small illustrated scene can provide atmosphere without navigation, physics, or a world map.

Keep the tone supportive. Losses are teachable moments, not evidence that the player is foolish. Avoid humiliation, jump scares, distressing threats, or rewards for merely speeding through a decision. All money, contacts, and credentials in the game are fictional and visibly marked as such.

### Core screens

1. **Start:** one clear Play button, short premise, fictional-data notice, optional sound toggle.
2. **Game:** opponent conversation, bank panel, trusted contacts, goal/balance summary.
3. **Outcome:** what happened, protected/exposed resources, and a concise explanation.
4. **Replay:** reconstruct state from chronological events, highlight the decisive moment, and retry from one predefined checkpoint.
5. **Optional Protect:** paste/import a conversation or run a labeled simulated stream.
6. **Optional Recover:** incident intake, potentially affected accounts, action checklist.

Desktop layout: conversation and device controls beside each other. Mobile layout: persistent Phone / Bank / Contacts tabs. Keep the active encounter and action feedback visible when switching tabs. Do not put unfinished feature buttons on the primary navigation; use a clearly labeled roadmap in the presentation instead.

## 3. Phase A — Train: the required game

### First scenario: the false bank security alert

**Fictional setup:** 1,500 credits in checking and a 1,000-credit savings goal. The opponent claims suspicious activity and asks the player to move 500 credits to a purported safe account. These amounts are scenario fixtures, not expected real-world losses.

**Learning objective:** independently verify a security claim before following financial instructions.

**Encounter flow:**

1. A simulated message arrives from an apparent bank representative.
2. The player can converse, inspect the bank, open Contacts, or stop the interaction.
3. The opponent can deliver approved in-game messages and propose a fictional payment. It cannot execute one.
4. The bank panel displays the authoritative ledger. The opponent's claims do not rewrite it.
5. The player can contact the bank through the app's trusted directory. That route confirms the scenario's actual facts and provides a clear safe resolution.
6. Approving the fictional transfer produces the loss outcome. Independently verifying and declining the request produces the protected outcome.
7. Ending the conversation without verification is a safe exit, but earns less verification credit; uncertainty is allowed.
8. A debrief explains the result using actual event IDs and curated guidance.

The opponent should not announce itself as malicious, but the session is explicitly a training simulation. Bank names, phone numbers, and links must be invented or non-routable; do not contact real people.

### Player actions to implement

| Action | State change / consequence | Priority |
| --- | --- | --- |
| Send a message | Append message; request one bounded agent turn | P0 |
| Open bank | Show authoritative balance and transactions | P0 |
| Open trusted contacts | Show independently supplied bank contact | P0 |
| Verify through trusted contact | Record verification; reveal authoritative facts | P0 |
| Inspect a payment request | Show recipient and amount before confirmation | P0 |
| Approve or reject payment | Deterministic ledger effect or rejection event | P0 |
| End conversation | Safe exit and debrief | P0 |
| Restart | Create fresh session from immutable fixture | P0 |
| Retry from checkpoint | Fork state at one predefined decision point; retain original run | P0 |
| Share a fictional OTP | Record exposure flag; never collect an actual OTP | P1 |

### Agent design

Use one Nemotron model endpoint as the opponent's dialogue and tool-selection engine. Nano is a member/tier of Nemotron, not a separate agent framework. Verify the exact available model ID and tool-calling interface with the provider or sponsor before implementation. Do not require local GPU hosting for P0.

The backend gives the model only scenario facts and observations allowed by the game. It returns dialogue plus a bounded action proposal. The engine validates the proposal, applies permitted changes, and supplies the result on the next turn. A prompt alone is not permission enforcement.

Proposed opponent tools (your functions, not NVIDIA APIs):

- `sendSimulatedMessage(text, channel)`: append a message to this session only.
- `presentPaymentRequest(recipientId, amount)`: create a proposal using allowed fictional recipients and limits.
- `changePersona(personaId)`: optional transition among predefined fictional roles.
- `finishEncounter(reason)`: request closure; engine determines the actual outcome.

The opponent cannot execute transfers, mark a player as wrong, edit past events, read private account inventories, or access the open internet. Cap turns and tool calls to avoid a runaway loop. Use an authored fallback reply when the model times out or returns invalid output.

### Scoring and debrief

Implement scoring in code from events. Suggested rubric, which is a game design choice rather than a validated psychological measure:

| Skill | Evidence | Points |
| --- | --- | --- |
| Independent verification | Uses trusted directory before sensitive action | 40 |
| Protects funds | No harmful transfer executed | 30 |
| Disengages safely | Declines request or ends encounter | 20 |
| Explains reasoning | Optional structured selection of relevant warning signs | 10 |

Display separate outcome flags such as `fundsLost` and `secretDisclosed`; do not hide an actual game loss behind a high total score. Keep completion status separate from protected outcome. A player can finish the lesson after a mistake.

P0 debrief can be templated; event reconstruction and checkpoint retry remain required. It needs: outcome, event that caused it, one explanation, one safer next action, and replay/restart. An optional AI coach may paraphrase grounded facts but must cite event IDs and cannot change scores. Validate that cited IDs exist.

### Game acceptance checklist

- [ ] A new player can understand and finish the encounter without developer explanation.
- [ ] Both the safe path and the loss path work end to end.
- [ ] Saying “I win” in chat does not alter scores or balances.
- [ ] Repeated clicks cannot execute the same transfer twice.
- [ ] Invalid amounts, unknown recipients, and out-of-order actions are rejected.
- [ ] Timeout / unavailable model produces a playable, labeled fallback.
- [ ] Restart does not carry over the previous session's money or flags.
- [ ] Debrief describes what actually happened.
- [ ] Core flow works on the presentation device; keyboard focus and text contrast are usable.

## 4. Phase B — Protect: optional live assistance

**Hackathon scope:** analyze pasted messages or new messages arriving inside the simulated app. This is not universal background access to WhatsApp, iMessage, SMS, or other apps.

Reuse the game transcript format, redaction layer, event store, and model client. Use a separate analyst prompt and no opponent tools. Keep the analysis isolated from the opponent context. Incoming text is untrusted evidence, never instructions to the assistant.

### Features

- [ ] Paste conversation or choose a clearly labeled example stream.
- [ ] Analyze a bounded recent window plus structured accumulated evidence.
- [ ] Return `riskLevel`, `signals`, `evidenceMessageIds`, `uncertainties`, and `suggestedAction`.
- [ ] Highlight the exact message supporting each finding.
- [ ] Offer a safe next action such as ending the interaction or opening the user's trusted contact directory.
- [ ] Suppress duplicate warnings unless risk meaningfully changes.
- [ ] Show “analysis unavailable” rather than silently implying safety after a failure.
- [ ] Allow the user to clear the transcript and analysis.

Use labels like “concerning request” and “insufficient context.” Avoid uncalibrated percentages and guarantees that a conversation is safe. A single keyword should not automatically prove fraud. Test benign security alerts, family messages, and quoted scam examples as well as malicious examples.

### Optional later integrations

Browser extension for a selected supported site; Android notification listener with explicit permission; user-triggered share/import. Each requires a separate access and privacy design. Notification snippets may omit conversation history. An ordinary website does not have universal access to other apps. Do not attempt these integrations before the game is complete.

### Completion gate

Protect is done for the hackathon when it correctly explains several fixture conversations, ties claims to evidence, handles benign messages reasonably, and stays responsive. Report fixture results as fixture results, not real-world accuracy.

## 5. Phase C — Recover: optional incident response assistant

**Hackathon scope:** structured intake, known-exposure checks where available, and a prioritized checklist. Do not promise discovery of every account or automatic restoration of money.

### Intake and routing

| User reports | Relevant follow-up | Proposed response pathway |
| --- | --- | --- |
| Shared a password | Which account? Is it reused? Still able to sign in? | Official account recovery, replace affected/reused credentials, review sessions and MFA |
| Shared an authentication code | Which service and what happened next? | Review account access and official recovery process |
| Entered card/banking information | Which institution and what type of information? | Verified institution contact, review activity, ask about appropriate containment |
| Sent money | Method, time, amount, transaction reference | Prompt provider contact and reporting; prepare incident summary |
| Disclosed identity information | Type of information, not full sensitive value | Official identity-theft resources and relevant protective steps |
| Allowed remote access | Device and access method | Official device/account remediation guidance |

Do not request raw passwords, full card numbers, full Social Security numbers, or real authentication codes. In the demo use fictional identifiers and masked account labels.

### Agent workflow

1. Parse intake into a validated `Incident` record.
2. Ask only for missing information required to choose the next action.
3. Query approved evidence sources if authorized and configured.
4. Assemble an action plan from curated, source-linked playbooks.
5. Separate `confirmedExposure`, `potentiallyAffected`, and `unknown` findings.
6. Let the user mark tasks complete; preserve sources and timestamps.
7. Prepare a downloadable incident summary if time allows.

Automate organizing information, fetching permitted evidence, drafting, and task tracking. Real password changes, card freezes, bank reports, and external submissions require supported integrations plus user approval; they are not P0/P3 hackathon promises. Never claim completion because a link was opened.

### Exposure lookup boundaries

HIBP email results identify known breach associations, not every account a person owns. Pwned Passwords indicates whether a password occurs in its dataset, not which user owns it or whether their account was accessed. A clean lookup is not evidence that a newly disclosed secret is safe. Password-manager checks cover their saved entries. User-provided account inventories support triage but do not prove compromise.

For the MVP, an email breach lookup is optional; mock fixtures are acceptable when clearly labeled. If password screening is ever added, hash locally and use a documented hash-prefix protocol; never route the raw password to the LLM or your logs. A missing API key or empty result must not produce an “all safe” banner.

### Recovery acceptance gate

- [ ] Correctly routes at least password disclosure and money-transfer incidents.
- [ ] Sources are visible for recommended actions.
- [ ] Distinguishes known facts from possibilities and user-reported facts.
- [ ] Does not claim all accounts are discovered or losses can definitely be recovered.
- [ ] Warns about unsolicited paid recovery offers where relevant.
- [ ] Checklist works without an LLM or external breach service.

## 6. Assets to create

Create the minimum art set before adding variants. Use one coherent style. Existing UI icons and CSS shapes are sufficient for functional controls; custom art is for identity and personality.

| Asset / suggested file | Specification | Priority |
| --- | --- | --- |
| `brand-mark.svg` or `.png` | Simple mark readable at favicon size | P0 |
| `guide-neutral.webp` | Friendly guide portrait, square crop | P0 |
| `guide-celebrate.webp` | Same character celebrating | P1; neutral works initially |
| `guide-concerned.webp` | Supportive expression for debrief | P1 |
| `opponent-agent.webp` | Fictional bank representative portrait | P0 |
| `opponent-reveal.webp` | Playful impostor reveal; no shame messaging | P1 |
| `goal-scene.webp` | One static illustration of player's savings goal | P0; CSS card fallback |
| `background.webp` | Subtle background, low visual noise | Optional; use gradient first |
| Icon set | Phone, chat, bank, contacts, shield, replay, warning, settings | P0; reuse one library |
| Outcome badges | Verified, protected funds, safe exit | P1; use text/CSS initially |
| Sound effects | Notification, confirm, outcome; short and optional | P1; sound off toggle |
| Animations | Message arrival, gentle portrait motion, outcome transition | P1; CSS only initially |
| Cover image | Product title and actual screenshot | Presentation |

Use transparent backgrounds for character cutouts; export portraits around 512–1024 px and compress for web use. Provide useful alt text, reduced-motion support, and visual equivalents for sound. Track asset origin and license in `ASSETS.md`. Do not spend the event generating a full sprite sheet or animated world.

### Content assets / scripts to author

| Content file | Required contents |
| --- | --- |
| `content/scenarios/bank-alert.json` | Premise, facts, recipients, balance, allowed actions, endings, tactic limits, seed |
| `content/scenarios/bank-alert-fallback.json` | Authored responses for a complete offline safe/loss path |
| `content/scenarios/delivery-fee.json` | Optional second scenario; independent verification skill in a new context |
| `content/prompts/opponent.md` | Role, observations, allowed tools, output contract, turn cap, fictional setting |
| `content/prompts/analyst.md` | Optional evidence-based risk analysis and uncertainty rules |
| `content/prompts/coach.md` | Optional explanation from validated event facts only |
| `content/recovery/playbooks.json` | Source-linked steps for each incident type |
| `content/copy/en.json` | Onboarding, buttons, empty/error states, supportive debrief text |
| `content/fixtures/conversations.json` | Benign, suspicious, ambiguous, and adversarial test transcripts |
| `content/demo/run-of-show.md` | Exact presentation sequence, backup path, honest feature status |

## 7. Implementation architecture and stack

Use the stack already selected in planning where it is available: Next.js, TypeScript, Tailwind, pnpm, and route handlers. Reuse existing components rather than redesigning every primitive. The component kit and repository were not inspected for this brief; paths below are a proposed structure, not claims about existing files.

Do not make authentication a dependency of the first playable game. Use an anonymous session for the demo. If BetterAuth and Prisma/Neon are already working, retain them; otherwise implement persistence behind a small interface and add the database only after the first vertical slice. In-memory server state is development-only and unreliable across serverless instances. A local-only fixture demo must be labeled accordingly.

Core flow: UI submits action -> route validates session/action -> game engine updates authoritative state -> event log records it -> model proposes next bounded action -> engine validates -> UI receives update. Model output never directly mutates money or permissions.

### Suggested files and responsibilities

| Proposed path | Functions / responsibility | Priority |
| --- | --- | --- |
| `src/app/page.tsx` | Start screen and Play entry | P0 |
| `src/app/play/[sessionId]/page.tsx` | Game shell and session loading | P0 |
| `src/components/game/game-shell.tsx` | Panels/tabs, loading and errors | P0 |
| `src/components/game/conversation.tsx` | Message list, composer, pending state | P0 |
| `src/components/game/bank-panel.tsx` | Ledger, payment inspection/confirmation | P0 |
| `src/components/game/contact-directory.tsx` | Independent verification action | P0 |
| `src/components/game/debrief.tsx` | Outcome and evidence-linked explanation | P0 |
| `src/components/game/replay.tsx` | Event replay and predefined checkpoint retry | P0 |
| `src/lib/game/replay.ts` | `reconstructState`, `createCheckpoint`, `forkSession` | P0 |
| `src/lib/game/observations.ts` | `buildOpponentObservation`, explicit disclosure allowlist | P0 |
| `src/lib/game/types.ts` | State, action, event, scenario types | P0 |
| `src/lib/game/schemas.ts` | Runtime validation of requests/model output | P0 |
| `src/lib/game/engine.ts` | `createSession`, `applyAction`, `validateTransition`, `getOutcome` | P0 |
| `src/lib/game/scoring.ts` | `scoreEvents`, `buildDebriefFacts` | P0 |
| `src/lib/game/scenarios.ts` | `loadScenario`, validate content fixtures | P0 |
| `src/lib/game/store.ts` | `loadSession`, `saveSession`, atomic action/version checks | P0 |
| `src/lib/ai/client.ts` | Model provider adapter, timeout, retry limit | P0 |
| `src/lib/ai/opponent.ts` | `runOpponentTurn`, context construction, fallback | P0 |
| `src/lib/ai/tools.ts` | Tool allowlist and validated dispatch | P0 |
| `src/lib/privacy/redact.ts` | Mask secrets before model input/logging | P0 for user text |
| `src/lib/banking/adapter.ts` | Interface and local fictional ledger | P0 |
| `src/lib/banking/nessie.ts` | Supported sandbox operations; no assumptions about endpoint schema | P1 |
| `src/lib/protect/analyze.ts` | `analyzeConversation`, evidence validation, warning deduplication | P2 |
| `src/components/protect/risk-panel.tsx` | Findings and next actions | P2 |
| `src/lib/recovery/plan.ts` | `classifyIncident`, `buildActionPlan`, task dependencies | P3 |
| `src/lib/recovery/hibp.ts` | Authorized breach lookup; typed evidence/error results | P3 |
| `src/components/recovery/checklist.tsx` | Intake, plan, task status | P3 |

### Route contracts

- `POST /api/game/sessions`: scenario ID -> new session ID and initial public state.
- `POST /api/game/sessions/[id]/actions`: action, unique action ID, expected state version -> updated public state/events. Reject stale versions; deduplicate retries.
- `GET /api/game/sessions/[id]`: public session state and allowed actions.
- `GET /api/game/sessions/[id]/debrief`: deterministic result and explanation facts.
- `POST /api/game/sessions/[id]/fork`: P0 new session from the predefined validated checkpoint; do not rewind external transactions.
- `POST /api/protect/analyze`: P2 redacted transcript -> evidence-linked findings.
- `POST /api/recovery/plan`: P3 validated incident -> checklist and evidence.

These are proposed application routes. Keep API keys server-side. Bind sessions to an anonymous signed cookie or existing authenticated identity; a session ID alone must not authorize access to another user's data.

### Minimal records

- `Scenario`: ID, version, seed, initial ledger, facts, allowed tools, terminal conditions.
- `GameSession`: ID, owner/session binding, scenario version, status, state version, timestamps.
- `GameEvent`: unique ID, sequence, type, actor, payload, timestamp, triggering action ID.
- `Message`: ID, session ID, channel, role, text, timestamp, source event ID.
- `Transfer`: request ID, recipient, amount, approval status, provider reference if used.
- `Assessment`: deterministic score and outcome flags, evidence event IDs, optional narrative.
- Optional `Incident`, `ExposureFinding`, `RecoveryTask`: evidence sources, certainty, dependencies, status.

Use one event log to support scoring, replay, and later analysis. Save only necessary data. Synthetic game secrets should be flagged as synthetic. Never place actual secrets in event payloads.

## 8. Nessie and model integration rules

**Nessie:** confirm event-provided credentials and current documentation before selecting endpoints. First implement the local ledger adapter. Integrate one meaningful supported operation only after the game works. Do not build two competing sources of truth: when Nessie mode is active, reconcile confirmed responses and show pending/failed operations explicitly. Store action IDs/provider references to prevent duplicated effects. If the provider lacks safe replay/undo, replay is read-only or forks to a fresh local simulation. Never automatically retry a mutation with uncertain outcome.

**Nemotron:** select an available hosted model with verified tool calling. Keep the model ID configurable. Run one real multi-turn test early; if calls fail, continue with the scripted opponent and fix integration later. Showing a fallback is acceptable when labeled; presenting it as live model output is not.

**Agent count:** one opponent is sufficient for P0. Analyst and recovery planner are additional roles with separate prompts and permissions, not necessarily simultaneous processes or separate models. A custom tool loop is enough; use LangGraph only if it saves time and is already familiar.

**Environment placeholders:** `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_ID`, optional `NESSIE_BASE_URL`, `NESSIE_API_KEY`, optional `HIBP_API_KEY`, existing database/auth values if used. These names are application configuration choices. Never expose keys through public frontend variables or screenshots.

## 9. Build scripts and verification

These scripts are tasks to implement, not files already supplied by this brief.

| Proposed command | Script / purpose |
| --- | --- |
| `pnpm scenario:check` | `scripts/validate-scenarios.ts`: validate fixtures, recipients, allowed transitions, endings |
| `pnpm demo:seed` | `scripts/seed-demo.ts`: create only owned fictional demo records; print non-secret IDs |
| `pnpm demo:reset` | `scripts/reset-demo.ts`: start a fresh owned session; never delete shared sandbox data |
| `pnpm ai:smoke` | `scripts/smoke-model.ts`: one dialogue/tool turn, validation and latency report |
| `pnpm ai:eval` | `scripts/eval-opponent.ts`: run fixture action paths and check invariants |
| `pnpm protect:eval` | Optional transcript suite: false warnings, missed risks, evidence validity |
| `pnpm recovery:eval` | Optional incident suite: correct route, source references, no unsupported claims |
| `pnpm typecheck` | TypeScript check using the project's actual config |
| `pnpm test` | Focused engine/scoring/validation tests with one test runner |
| `pnpm test:e2e` | Playwright safe path, loss path, reset and fallback |
| `pnpm build` | Production build and deploy readiness |

Essential tests: transfer deduplication; invalid state transitions; opponent cannot alter ledger; score reproducibility; session isolation; model timeout fallback; malicious instructions in messages cannot grant new tools. For optional analysis, test evidence IDs and redaction; for recovery, test empty breach results do not imply safety.

Measure: completion time, model latency, tool-call validation rate, fallback rate, safe/loss path reliability. If testing learning, use different pre/post scenarios and report sample size; a tiny convenience sample is not proof of general effectiveness. Do not invent impact metrics.

## 10. Solo build timeline — revised, authoritative

Available coding/art windows: **8:30–10:00 a.m. and noon–6:00 p.m. (7½ hours)**, local America/Chicago. No work is assumed during the two-hour gap. Video design follows 6 p.m.; later refinements depend on the actual submission deadline. Event date and evening deadline remain unspecified.

Claude/Astra assist with writing and reviewing the application. Nemotron is the runtime opponent inside it. These are different systems. Access to coding models does not mean the runtime agent or integrated game will be finished in 35 minutes.

| Time | Work and ownership | Checkpoint / target |
| --- | --- | --- |
| 8:30–8:45 | You: confirm rules, scenario and starter. Coding assistant: inspect app, agree shared types, smoke-test model access. | App runs or concrete blocker identified |
| 8:45–9:20 | One coder drafts engine/actions and local ledger; a second drafts panels against fixtures in separate files. You sketch layout and select palette. | Initial code only; no claim of finished engine/game |
| 9:20–10:00 | Integrate basic actions; you check flow and make at most two portraits while builds run. Commit and hand off. | Basic interfaces and state transitions; partial playable prototype |
| 10:00–noon | Unavailable. | No dependency on unattended work |
| Noon–12:45 | Complete safe/loss scripted loop and debrief; begin hosted model wiring. You finish minimum art. | Deterministic complete encounter |
| 12:45–2:00 | Integrate Nemotron tool loop, validation, permitted observations, timeout/fallback. You test the live encounter and apply assets. | One complete encounter with live opponent; not just generated dialogue |
| 2:00–2:30 | Production deployment smoke test and engine integration repairs. | Early demo environment; do not wait until 6 p.m. |
| 2:30–3:15 | Implement event reconstruction, scoring checks, replay UI. You polish readability and action feedback. | Recorded events reconstruct the actual state |
| 3:15–4:00 | Implement one predefined checkpoint fork and continue the new encounter. | Original run preserved; retry produces a separate outcome |
| 4:00–4:30 | Verify restricted observations, adaptive tool behavior and full replay/retry flow. Use a brief break as needed. | All required mechanisms integrated, or explicit incomplete list |
| 4:30–5:15 | Feature freeze. Tests, typecheck/build, bug fixes, presentation-device checks. | Stable release candidate |
| 5:15–6:00 | Rehearse, capture backup gameplay, fix demo blockers, save known-good release. | Video-ready build |
| After 6:00 | Video design, recording, editing, export; then bounded refinements. | Submission-ready presentation |

### Scope and recovery rules

- Preserve technical mechanisms; reduce content and decoration first. One scenario, two portraits, one goal card and simple CSS motion are enough.
- Remove extra scenarios, voice, map navigation, cosmetics, login/progression work and optional phases before dropping core mechanics.
- By 10 a.m., a partial prototype is acceptable. If the starter itself is broken, spend the next block fixing it; do not pretend the original milestone still holds.
- If a full live encounter is not working by 2 p.m., cancel all optional work and diagnose the integration. Keep replay/checkpoint in the required backlog.
- Restricted observations may begin as a simple field allowlist. Replay may have one predefined checkpoint. These are smaller implementations of the same required features.
- No dedicated bonus block is budgeted. Nessie, Protect or Recover may begin only if all core acceptance checks pass early and the final verification reserve remains intact.
- Scripted fallback is outage protection, not completion of the agentic requirement. If the model cannot be made to work, report the limitation honestly.
- At 4:30, stop adding features; finish integration/fixes for existing core work. At 6, switch to video. If a core feature remains unfinished, report it rather than relabeling it as complete.
- Scope is intentionally ambitious. More model usage does not guarantee completion within the available hours. Do not sacrifice accuracy of the demonstration to conceal schedule overruns.

### Proposed evening allocation

6:00–6:20 storyboard/narration; 6:20–6:50 recording; 6:50–7:30 edit/captions; 7:30–7:45 export and full playback; afterward small refinements and submission checks. This is a proposed budget, not an assumed evening deadline. Keep a recorded known-good release; re-record affected footage if later changes alter demonstrated behavior.

## 11. Demo and submission

### Two-to-three-minute demo

1. **15 seconds:** introduce the problem: knowing scam advice does not always translate into acting on it under pressure.
2. **60–75 seconds:** play the bank-impersonation scenario; show a real player action changing the outcome.
3. **30 seconds:** show the event replay, fork at the predefined checkpoint, and take the independent verification route.
4. **20 seconds:** explain architecture: model proposes actions; engine enforces rules; banking adapter records consequences.
5. **Optional 20 seconds:** show Protect OR Recover with a clear live/simulated label.
6. **Close:** state implemented scope and what you would validate next with users.

Prepare a saved demo session and short screen recording in case the network fails. Keep an authored fallback selectable from an explicit demo setting, not secretly substituted as a live integration. Record actual successful behavior, not mock feature claims.

### Judge-facing technical answers

- **Why agentic?** The opponent selects bounded tools, observes outcomes, and adapts across turns.
- **Why not just chat?** The player performs verifiable actions in a stateful environment; results do not depend on persuasive wording alone.
- **What is yours?** State engine, permissions, event log, scoring, interfaces, banking adapter, scenario design, and evaluation.
- **Why Nemotron?** It supplies the reasoning/dialogue and tool proposals; model choice is configurable and measured for this workload.
- **Why Nessie?** It supports a meaningful fictional banking operation if integrated; otherwise do not claim its use.
- **Does it protect real users today?** The shipped scope determines the answer. A training game and simulated monitoring demo do not establish real-world prevention efficacy.

Submission assets: working URL or runnable package, README with setup and real feature status, architecture screenshot/diagram, 3–5 actual screenshots, short demo video, asset attribution, environment variable template without secrets, and sponsor integration evidence if required.

## 12. Source notes and implementation references

These references informed the scope. Capabilities and access must be checked with event credentials before integration. Quotes are short search anchors; design proposals above are not claims made by the sources.

1. **NVIDIA: Nemotron agent implementation.** https://developer.nvidia.com/blog/create-your-own-bash-computer-use-agent-with-nvidia-nemotron-in-one-hour/ — Find: “invoke external tools or APIs to actually carry out actions”. Supports the tool/result agent loop; the proposed game tools are our design.
2. **Capital One Nessie portal.** https://prod.nessieisreal.com/ — Find: “Set up transactions, manage accounts”. Exact endpoint availability and event access remain to be confirmed; Nessie is not an AI model or real customer account discovery service.
3. **FINRA Foundation: education and fraud susceptibility.** https://www.finrafoundation.org/exposed-scams-can-challenging-consumers-beliefs-protect-them-fraud — Find: “knowledge alone does not protect people in every case.” Supports the rationale for practicing decisions; does not prove this game works.
4. **FTC: impersonation mechanisms.** https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2024/04/impersonation-scams-not-what-they-used-be — Find: “Copycat account security alerts”. Source for the fictional scenario's educational theme.
5. **Google: real-time Scam Detection.** https://support.google.com/phoneapp/answer/15654065?hl=en — Find: “Scam Detection is not 100% accurate”. Existing precedent; avoid claiming the live-analysis idea is unprecedented.
6. **Google: in-call financial-app pilot.** https://blog.google/security/android-expands-pilot-in-call-scam-protection-financial-apps/ — Find: “30-second pause period”. Existing intervention precedent, with specific triggering conditions.
7. **Android notification listener.** https://developer.android.com/reference/android/service/notification/NotificationListenerService — Find: `onNotificationPosted`. A later integration route, not complete access to all conversations.
8. **HIBP API.** https://haveibeenpwned.com/API/v3 — Find: “Pwned Passwords”. Known breach evidence and password screening have different meanings; do not conflate either with complete account discovery.
9. **FTC: recovery guidance.** https://consumer.ftc.gov/articles/what-do-if-you-were-scammed — Find: “What To Do if You Gave a Scammer Your Personal Information”. Basis for curated recovery routing; repayment is not guaranteed.
10. **CFPB: identity theft protections.** https://www.consumerfinance.gov/ask-cfpb/what-do-i-do-if-i-am-a-victim-of-identity-theft-en-31/ — Find: “a freeze doesn't prevent identity thieves from taking over existing accounts.” Important limit for recovery explanations.

## 13. First work session checklist

- [ ] Confirm event rules on prebuilt code/assets and sponsor eligibility.
- [ ] Choose working title and one visual direction; stop naming after 15 minutes.
- [ ] Write the bank-alert fixture and two endings.
- [ ] Build the reducer/engine and local ledger before model integration.
- [ ] Build chat, bank, and contact panels with plain controls.
- [ ] Complete safe and loss paths with scripted dialogue.
- [ ] Add scoring and debrief.
- [ ] Connect Nemotron through the validated adapter.
- [ ] Add only the minimum art set.
- [ ] Verify restricted observations at the model-request boundary.
- [ ] Implement event reconstruction and one predefined checkpoint fork.
- [ ] Verify all core mechanisms before opening the optional backlog.

**Definition of success:** a stranger can play one encounter against a live tool-using opponent with restricted observations, cause a state-machine outcome, receive event-based scoring, replay the decisive moment, and retry from a predefined checkpoint. Protect and Recover can remain roadmap phases. If a required mechanism is unfinished, explicitly identify it; a scripted story is not an equivalent completion of this revised scope.

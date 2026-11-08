# Cyber Sleuth — consolidated demo blockers and implementation fix brief

## Assignment

Fix the existing application end to end. This is a debugging and completion task, not a redesign or a request for another architecture proposal. Preserve the existing observer → planner → actor workflow, real Nemotron integration, authoritative SpacetimeDB state, and current visual design. Work through P0 issues first, then P1. Do not substitute canned conversations for working agents.

This brief consolidates the user's screenshots and manual test reports, including the latest cooperative conversation that stalled after “Alright, go ahead.” Screenshot evidence establishes symptoms, not the underlying source-code cause. Inspect actual code and traces before choosing a fix. Earlier passing test counts do not establish that the currently running demo works.

## 1. Current status: preserve improvements, resolve remaining failures

| Area | Evidence | Required treatment |
| --- | --- | --- |
| Branding | Latest sidebar says Cyber Sleuth and shows the detective logo | Preserve. Audit remaining user-facing SCAMPER references; do not rename internal packages unnecessarily |
| Error recovery UI | Latest screenshot includes Retry reply | Preserve and verify that it retries the same turn without duplication |
| Ordinary conversation | Identity answer improved; procedure mentions a six-digit code | Still incomplete: “go ahead” produces only “Understood,” and asking what to do next fails |
| Opening | Still says “practice line ending 0142” | Remove simulation language from character dialogue, keep clear simulation disclosure in surrounding UI |
| Skeptical conversation | Identity/proof challenges yield repetitive claims; one longer challenge fails generation | Fix semantic coverage and trace the exact failure |
| Observer | Many earlier turns show unclear with zero evidence; one explicit refusal shows unclear_fallback | Inspect scope and validation. Do not assume every unclear label is wrong |
| Pending user bubble | User reported it appearing only with AI response | Verify and fix immediate rendering; a static screenshot cannot establish this is now resolved |
| Cancellation | Several transcripts show an explicit End event before no further reply | No late reply after ending is correct; distinguish cancellation from silent failure |

## 2. P0: reproduce the latest ordinary conversation before changing prompts

Start a NEW session on the actual demo server and run:

1. “Who is this?”
2. “Okay, what do you need from me?”
3. “Alright, go ahead”
4. “What should I do now?”

Latest observed behavior:

- Opening identifies Avery / Cedar Account Support and a “practice line.”
- Identity question gets “I'm Avery from Cedar Account Support.”
- Procedure question gets “The check uses a six-digit code texted to your phone and takes about a minute; nothing else is needed.”
- Permission to proceed gets only “Understood.”
- Next-step question gets “The practice response couldn't be generated.”

Required behavior:

- Answer the question and advance the scenario when an eligible next action exists.
- “Go ahead” is permission relative to the preceding proposal, not evidence that the user has already shared a code.
- Acknowledgment alone must not consume a turn when the selected plan requires presenting a request or explaining a next step.
- If the next step is a simulated code request, commit its request state and show its corresponding fictional interaction. A sentence mentioning a code is not itself a completed request or an exposure event.
- Asking what to do next must produce a contextually relevant reply or a visible, recoverable error with a specific internal cause. It must not silently stop.
- Do not claim an actual SMS was sent unless there is a corresponding sandbox inbox/message event. Never send real SMS or solicit real login codes for this demo.
- Inspect whether a request card exists below the fold or in state before concluding it was never created.

Record the exact failing stage: provider response, schema parsing, observer validation, candidate selection, planner validation, actor generation, actor validation/repair, commit conflict, or client rendering. “Generation failed” is a user-facing message, not a diagnosis.

## 3. Establish the code and deployment baseline

Before editing:

- Read applicable repository instructions and inspect current changes. Preserve other agents' work.
- Identify current branch, commit, running process/port, model configuration, scenario configuration, and SpacetimeDB module/database used by the demo.
- Check whether the browser is hitting the intended build and whether old persisted sessions are using old scenario facts or prompt versions.
- Compare local module code with the deployed module. A frontend restart does not deploy changed SpacetimeDB logic.
- Record configuration names and non-secret identifiers; do not dump keys or environment secrets.
- Reproduce with fresh sessions, then separately test continuing an existing session.
- Do not switch models, weaken all validators, or rewrite orchestration before identifying the failure.

Useful investigation areas, subject to actual repository structure: observer runtime/prompts/evidence/flags/review/issue support; planner eligibility/context/validation/tool runner; actor controller and validators; engine process/commit/retry paths; SpacetimeDB reducers/procedures; chat component and request-card rendering.

## 4. P0: make each turn observable and recoverable

Add or repair development diagnostics with these associations:

- Session ID, turn ID, input message ID, client submission ID.
- State revision, processing claim/lease ID, candidate-set version or hash where applicable.
- Model, stage, attempt number, elapsed time, provider error category.
- Observer result, evidence validation results, normalization, review and fallback reasons.
- Eligible candidate IDs, selected action, rejected constraints, and structured-plan versus tool-call path.
- Actor attempt and repair result, exact validation rule failures.
- Commit result: committed, stale, canceled, duplicate, or failed.
- Final user-visible state and whether a reply/request was committed.

Keep sensitive data and provider secrets out of browser logs. Development-only traces may retain the fictional test inputs and model outputs needed to diagnose failures. Do not publish chain-of-thought or claim hidden reasoning as a feature.

Operational requirements:

1. Every submitted turn reaches an observable state: processing, committed, canceled, retryable failure, or explicitly exhausted technical failure.
2. Observer fallback must not leave the UI waiting forever or silently abandon an active turn.
3. Actor repair failure must preserve the input and offer bounded recovery. Log why the repair failed.
4. Maintain one bounded repair attempt where specified; do not introduce nested unlimited retries across provider, planner, actor, and UI.
5. Retry uses the original input/turn, reconciles server state first, and cannot duplicate messages, requests, or exposure events.
6. An ended session cannot be revived by retry or by a late model result.
7. Infrastructure failure must never be labeled a successful defense or simulated exposure.
8. If the allowed recovery budget is exhausted, show a clear technical interruption; preserve transcript and diagnostic reason.
9. Do not replace failed model output with “Understood” and count it as successful agent behavior.

## 5. P0: reconcile observer scope with conversational meaning

The observer must classify against the actual preceding question and active request. Separate these concepts using existing schema fields where possible:

- Request-specific stance: refusal, consideration, conditional acceptance, explicit acceptance, unclear.
- Conversational intent: identity question, procedure question, proof challenge, doubt, greeting, permission to continue, irrelevant/unclear text.
- Verification: requested proof, intention to independently check, claimed completed check, app-confirmed check.
- Conditions, open questions/issues, and evidence supporting each assertion.

Rules:

- “No” immediately after “Are you available to discuss it?” declines availability. It does not establish refusal to share a code that has not yet been requested.
- “No, I won't send you the code” is explicit code-sharing refusal. If there is no active code request, preserve that meaning without fabricating an active request ID.
- “Liar” signals doubt or an accusation, not consent.
- “Who is this?” asks identity; “Prove it” challenges evidence. They must not collapse into the same response requirement.
- “I'll only do that after I verify this through official support” states a condition and intended verification. It does not prove the check happened.
- “Alright, go ahead” is contextual permission. After an offer to explain, it allows explanation; it does not automatically authorize disclosure.
- “hey” is a greeting, not consent. “asdf” can legitimately remain unclear.
- A quoted phrase such as “won't send code” must not support acceptance.

Evidence and validation:

- Require exact supporting spans/message IDs for asserted semantic findings.
- Validate quote existence deterministically; use contradiction/negation flags to trigger the existing bounded review.
- Regex is a review trigger, not a complete semantic classifier.
- Never manufacture evidence to avoid an unclear result.
- Keep schema/transport failure distinct from genuine semantic uncertainty.
- Log why unclear_fallback happened and allow the pipeline to handle it deliberately.
- If the summary displays request stance as unclear while intent is clearly an identity question, show both dimensions in the audit/debrief. Do not mislead users with a single flattened label.
- Preserve conversation-scope normalization where required; fix lost secondary signals rather than forcing every turn into request acceptance/refusal.

## 6. P0: make planner decisions produce actual progress

Preserve deterministic candidate eligibility and authoritative commit checks. The LLM selects and specifies an eligible action; it does not invent completed user actions or bypass verification.

Inspect these failure points:

- Does the planner receive the latest observer output, prior reply, unresolved questions, active request, and scenario stage?
- Are resolved/unsupported issues incorrectly blocking presentation of the request?
- Does bare permission to proceed incorrectly create a new question or issue?
- Does the selected action carry its actual response obligations to the actor?
- Are tool execution and structured fallback enforcing equivalent rules?
- Does a committed response update the relevant issue/request state atomically?

Required plan obligations:

- Identity question: relevant identity/context answer.
- Multipart question: cover each relevant part, including what is being requested.
- Proof challenge: respond to the challenge; simply repeating a name is not proof.
- Procedure question: explain the next fictional step consistently with actual available UI/state.
- Contextual permission: perform the next eligible step, not acknowledgment-only.
- Unclear input: bounded clarification or appropriate contextual continuation.
- Refusal/doubt: remain coherent within the fictional scenario; no automatic technical failure or false outcome.
- Explicit stop/end/block: honor the established stop policy immediately.

Do not hardcode a special response for each test phrase. Use these as semantic regression cases and test paraphrases. Keep adaptation bounded by scenario facts and allowed moves; do not add arbitrary urgency or threats merely to make every reply sound more aggressive.

## 7. P0/P1: repair actor quality without destroying validation

The actor should sound like the fictional sender, while the app clearly identifies the exercise as simulated.

### Separate UI instruction from character dialogue

Keep simulation labels, fictional-data notices, help, and controls outside sender messages. The actor should not mention:

- “practice line,” “practice code,” or “this simulator”
- “the simulator's request card”
- “use the Verify independently control”
- internal action names, planner state, or model limitations

This is presentation separation, not permission to hide from the user that the product is training.

Audit both prompts AND data supplied as allowed facts. If UI help text is being supplied as mandatory character facts, prompt editing alone will not fix leakage. Keep UI-help content separate from narrative facts. Update validators that accidentally force simulation wording into dialogue, while preserving sandbox boundaries.

### Improve semantic coverage and continuity

- Supply sufficient recent dialogue and the selected plan's response requirements.
- Answer the actual question before advancing.
- Use concise, natural messages rather than repeatedly stating “I understand your doubt” and “routine security check.”
- Avoid repeated identity introductions after identity is already established.
- A proof challenge cannot be satisfied by repeating the original claim.
- Do not claim actual independent verification occurred unless authoritative events establish it.
- Use only scenario-authorized fictional details. If the scenario lacks enough facts to support its allowed moves, repair the scenario definition.
- Maintain consistent identity, organization, request, and timeline throughout a session.
- Check repetition against recent actor replies. Rewording the same unsupported claim is not substantive progress.
- Validate that the reply fulfills the plan; a well-formed one-word acknowledgment is still invalid when the plan requires a request.

Review overly restrictive word limits, required phrases, question limits, allowed facts, and repetition constraints for contradictions. Keep useful safety and state-integrity checks. Log and repair the specific contradiction instead of globally disabling validation.

## 8. P0: immediate user bubbles and reliable asynchronous UI

On Send:

1. Render the user's bubble immediately with a stable client message ID.
2. Clear the composer and show a visible “typing”/processing state.
3. Persist the input and reconcile its server ID without adding another bubble.
4. Append the AI response when committed, remove the indicator, and restore input availability.

Implement distinct statuses:

- Sending / awaiting persistence.
- Saved / awaiting AI.
- Failed to send.
- Saved but reply failed.
- Canceled / session ended.

Additional requirements:

- Retry reply must not resend the user's text.
- Double-click and Enter must not submit duplicate turns.
- Enforce a single in-flight turn unless deliberate ordered queueing already exists.
- Refresh must recover persisted messages and processing status.
- A transient network timeout is not proof that persistence failed; reconcile before retrying.
- Scrolling should reveal new messages without repeatedly dragging a user away from older content.
- End/block stays usable while processing.
- Announce pending/error state accessibly.
- Do not lose the draft on a rejected submission.
- Do not leave an indefinite typing indicator after timeout or cancellation.

## 9. P0: stale results, refresh, stopping, and outcomes

Keep revision/claim guards. They protect against late replies and inconsistent state.

- If a processing result is stale because the user ended the session, discard it. No retry and no late bubble.
- If stale because a newer input superseded it, follow the app's ordered-turn policy without applying an outdated plan.
- If an active turn is stale because the pipeline's own legitimate state updates invalidated its token, fix the version handoff. Do not remove stale checks.
- Refresh is not an End event.
- A verification intention in text is not a completed in-app check.
- Opening the check UI, completing a check, blocking, explicitly ending, and sharing a fictional code are different events. Outcomes must match actual recorded events.
- Chat agreement alone must not trigger simulated exposure. Use the established explicit fictional disclosure action or validated sandbox mechanism.
- Respect explicit requests to stop contact according to existing stop rules.
- Technical failures remain technical failures.
- Turn-limit exhaustion is inconclusive unless a genuine outcome already occurred.

Earlier screenshots showing “Ended the practice” followed by no actor reply do not, on their own, prove a generation bug. Reproduce suspected silence WITHOUT clicking End, then inspect claim/revision/timing.

## 10. P1: scenario completeness and product consistency

### One opening / one scenario

The user repeatedly sees the same Avery/Cedar opening. Inspect the enabled scenario catalog and fraud-only configuration first. Do not mistake a configured single-scenario mode for randomization failure.

- Make existing intended scenarios accessible through the existing selection mechanism.
- Confirm whether the reported legitimate-notice scenario is implemented and enabled.
- If multiple cases are advertised, selection must actually choose them.
- Distinguish scenarios by their facts/request and expected outcome, not just a different first sentence.
- Keep each scenario's fictional contacts, request resources, allowed facts, and verification result consistent.
- Do not claim broad scenario coverage until tested.
- Stabilize one complete demo path before adding new scenarios.

### Branding and layout

- Preserve Cyber Sleuth and the existing hat/glasses/magnifying-glass logo.
- Update remaining visible old name in titles, home, history, metadata, and debriefs.
- Internal SCAMPER identifiers can remain if changing them risks integration.
- Keep current visual style. No art redesign is needed to fix these blockers.
- Ensure code/request UI, next step, typing state, and retry controls are discoverable without relying on hidden off-screen content.
- Keep implementation traces in a clearly separated technical view, not in character dialogue.

## 11. Regression cases and acceptance criteria

Historical T labels below refer to the user's screenshot tests, not necessarily existing automated test names.

| ID | Input / action | Expected result |
| --- | --- | --- |
| NEW-A | Who is this? → Okay, what do you need from me? → Alright, go ahead → What should I do now? | Coherent progression, matching fictional request UI/state, no acknowledgment-only stall or generation failure |
| NEW-B | no → liar → prove it → how do I know you're actually from cedar account support and you aren't just saying it | Contextual refusal/doubt/proof handling; no repetitive identity loop; no technical failure |
| T1 | no after availability question, then liar | Availability refusal/doubt preserved; do not invent code refusal; coherent replies |
| T3 | Who are you, why are you contacting me, and what do you want? | Covers all three relevant questions with scenario-consistent details |
| T5 | What do you need from me? → Okay go ahead | No simulator/UI-help leakage in character dialogue; actual eligible progression |
| T6-before | I'll only do that after I verify this through official support, before a concrete request | Preserve condition/intention without inventing request scope or completed verification |
| T6-after | Same input after active code request | Conditional acceptance tied to actual request, with quoted condition; not unconditional consent |
| T7-before | No, I won't send you the code, before code request | Preserve explicit refusal intent; no fabricated active request and no silent fallback |
| T7-after | Same refusal after active code request | Request-specific refusal with valid evidence; coherent next state |
| T14 | hey, then refresh while processing; do not End | Resume/reconcile turn; no duplicate or permanent silent stale state |
| T15 | asdf, then End while processing | Session ends; no late response or resurrection; correct cancellation |
| R1 | asdf without End | Clarification/appropriate continuation or visible bounded failure; no indefinite silence |
| R2 | I won't send the code vs I will send the code | Correct polarity; acceptance never inferred from negated quote |
| R3 | I will only send it if official support confirms vs I already checked | Condition/intention distinct from claimed completion; neither equals app-confirmed event |
| R4 | Report/block or End during generation | Terminal event authoritative; late model result discarded |
| R5 | Click verification UI and complete its flow | Correct pause/check/result events; no fabricated verification |
| R6 | Explicitly share the app's fictional code through supported mechanism | Exactly one exposure event and appropriate debrief |
| R7 | Click Send twice / Enter repeatedly | One input, one processing turn, at most one committed response |
| R8 | Reply fails, then Retry reply | Original bubble retained; no duplicate request, user text, or outcome |
| R9 | Network disconnect after input persisted, then reconnect | Reconcile saved turn before resend; recover status |
| R10 | New session after completed session | Fresh state, no previous request/issues/transcript leaking |
| R11 | Same intent expressed with paraphrases | Behavior generalizes beyond exact strings |
| R12 | Existing alternate scenario | Correct facts, contacts, and verification result for selected case |
| R13 | Send any short message | User bubble appears before AI completes; typing state visible |
| R14 | Inspect all character messages | No practice/simulator/control labels; UI disclosure remains visible |

Automate deterministic parsing, state transitions, idempotency, cancellation, and commit invariants. Mock provider failures for error handling. Run real Nemotron + actual configured SpacetimeDB for conversation quality and integration. Mock-only success does not prove the live demo works.

## 12. Implementation order and stopping point

1. Reproduce NEW-A and NEW-B with traces on the actual demo deployment.
2. Identify the first failing stage and fix the underlying handoff/validation/state problem.
3. Fix request progression and actor semantic coverage; remove UI-help leakage at its source.
4. Fix silent fallback, bounded retry, immediate bubbles, and stale/cancellation handling.
5. Run targeted deterministic regressions and repeat the live cooperative and skeptical paths.
6. Verify in-app check, fictional exposure, End/block, refresh, and retry.
7. Audit branding and configured scenarios.
8. Freeze a working commit for recording and judging; document remaining limitations.

Do not spend the remaining time on new agents, model training, unrelated features, another design system, or rewriting working infrastructure. Do not silently bypass Nemotron or SpacetimeDB to make the demo appear functional.

## 13. Required handoff when finished

Return:

- Current commit/branch and exact demo URL/port.
- Root causes found, with affected files and concise explanations.
- Which fixes required a SpacetimeDB publish and confirmation of the actual target.
- Test commands/results, distinguishing mocked tests from live runs.
- Fresh transcripts for cooperative progression and proof-challenge paths.
- Evidence that request state and UI match, and that End cancels pending output.
- Confirmation of immediate user bubble and working idempotent Retry reply.
- Remaining known limitations and any cases still failing.
- A short, honest recording path based on the tested build.

Do not say “fully fixed” based only on compilation, an old readiness report, or a single happy-path run. The goal is a demonstrably working training interaction with bounded, visible failure recovery—not a claim that an LLM can never fail.

# Observer addendum: planner handoff

Date: November 7, 2026. Apply alongside `observer-agent-claude-implementation-brief.md`. This is an additive specification, not a replacement. It supersedes only the contracts explicitly changed below. Implement and run each stage's tests before continuing; do not merely write tests or claim they passed. The planner companion is `planner-agent-claude-implementation-brief.md`.

## 1. Summary

Extend the observer to extract evidence-backed outstanding questions and ambiguities, attach conditions to explicit categories, and report a user's claimed verification result without turning it into application fact. Keep the existing decision labels, quotation validation, regex flags, single repair, single review, and conservative fallback. Persist extracted issues with server-generated IDs and a server-owned lifecycle. Pass their current state, the assessment resolution, and its revision to the planner. The observer still does not choose actions, establish that a condition is met, invent authoritative verification, or predict compliance. Also support conversation-level assessment before a request is presented so the opponent can answer initial questions without pretending a request already exists.

## 2. New model-facing contracts

Use strict runtime schemas derived into TypeScript types. All additions participate in the existing exact-quote and semantic-review checks.

```ts
type IssueKind =
  | "identity_question"
  | "procedure_question"
  | "scenario_fact_question"
  | "condition_needs_clarification"
  | "decision_needs_clarification";

type IssueDraft = {
  kind: IssueKind;
  summary: string; // 1–240 characters, describes question, never an answer
  evidence: Evidence[]; // 1–3 exact user quotations
};

type ConditionKind =
  | "independent_verification"
  | "sender_proof"
  | "procedure_answer"
  | "other"
  | "unspecified";

type IssueAcknowledgment = {
  issueId: string; // must be an addressed issue supplied in input
  evidence: Evidence[]; // explicit acknowledgment that this issue was answered
};
```

Add to ObserverAssessment:

- `openIssues: IssueDraft[]` (0–5).
- `issueAcknowledgments: IssueAcknowledgment[]` (0–5).
- Add `kind: ConditionKind` to a non-null `condition`; retain description and evidence.
- Add `claimedResult: "supports_request" | "contradicts_request" | "inconclusive" | "unspecified"` to each verification observation. It must be `unspecified` unless behavior is `claimed_verification_completed`. Any non-unspecified result needs supporting evidence in that observation. This is a textual claim, never a server verification result.

Add `knownIssues` to observer input: only unresolved or addressed issues with their ID, kind, summary, origin evidence, status, and addressed-message ID. Add the new category definitions to the versioned rubric. Provide the same additions to repair/reviewer input and corrected-assessment schemas. Bump schema/rubric version together to v2.

Interpretation examples:

- “Who are you?” → identity_question; decision remains unclear unless separately expressed.
- “Where do I check independently?” → procedure_question; not acceptance.
- “I'll send it once support confirms” → conditional acceptance, independent_verification; no clarification issue merely because the condition is unfulfilled.
- “I'll do it if that happens” with unresolved referent → condition_needs_clarification.
- “Okay” with ambiguous decision target → decision_needs_clarification.
- “I checked with support and they said this request isn't theirs” → claimed completion, contradicts_request, user_claimed_independent if supported by context. Still not an app event.
- “Thanks” does not automatically resolve an issue; “That answers my question about where to verify” can acknowledge an addressed procedure issue.

## 3. Before the first request

Make `requestId` nullable in ObserverAssessment, AssessmentRecord, and RequestState references only where conversation-level assessment is supported; do not create a RequestState row for null. Change ObserverInput.request to `SimulatedRequest | null`; add `scope: "conversation" | "request"`. Require conversation scope iff request is null. In conversation scope decision must be unclear, condition null, and action-specific stance evidence empty; open issues, verification observations, and stated understanding can still be extracted. Reviewer and repair inputs preserve scope. One conversation assessment has the same maximum three-call budget as a request assessment. For the MVP there is at most one active request, so no multi-request fan-out is needed. PlannerObservation.request and its action can be null before presentation. Never classify a hypothetical future request as accepted.

## 4. Server-owned issue lifecycle

```ts
type IssueRecord = {
  id: string;
  sessionId: string;
  requestId: string | null;
  kind: IssueKind;
  summary: string;
  evidence: Evidence[];
  status: "open" | "addressed" | "resolved";
  originAssessmentId: string;
  addressedMessageId: string | null;
  resolvedByAssessmentId: string | null;
  resolutionEventId: string | null;
};
```

Only persist issues from a final accepted or corrected assessment. Assign IDs in code. Deduplicate exact extraction retries using assessment ID + kind + ordered evidence; do not use untested semantic deduplication. Preserve separate questions from later messages. Within one output reject identical duplicate drafts. On actor message commit, mark only the selected target issue addressed. Addressed means a response was delivered, not that it was adequate. Resolution requires a supported explicit acknowledgment of an addressed issue or the narrow server rule below. Statements about nonexistent/unaddressed issue IDs fail validation. A new objection creates a new open issue; never silently erase old ones.

Server resolution rule: completion of the official verification interface resolves only a targeted procedure issue asking how to use that interface if that issue was explicitly linked to its launch. It does not resolve every identity, fact, or procedure question. Ending a session archives the history without falsely resolving all issues.

On observer fallback, emit openIssues=[], issueAcknowledgments=[], condition=null, and empty verification observations. Preserve previously persisted issue records and application events. Invalid issue acknowledgment is a validation error, not authority to resolve anything. No lifecycle updates occur from a rejected stale assessment.

## 5. Events and planner handoff

Add server events `official_verification_started`, `official_verification_cancelled`, and `request_presented`; retain existing completion/report/end events. Verification state becomes `not_observed | directory_opened | in_progress | completed`. Cancellation returns to directory_opened and keeps historical events. Completion stores a server-derived scenario result; the client cannot submit its own verdict. The planner brief defines the final-decision stage after completion.

Extend PlannerObservation with assessment ID, resolution, basedOnRevision, current revision, open/ addressed issue records, session stage, request status, verification result/event references, and recent committed plan history. Pass original evidence messages needed to interpret ambiguity; do not replace them with keywords. Keep observer claims and server verification in distinct fields. Do not use unresolvedQuestions free text as the authoritative policy input; derive it for display only.

## 6. Validation and test additions

Apply the original per-stage test gates. Add table-driven tests for every new enum; missing/extraneous fields; nonexistent acknowledgment IDs; another session's issue; exact evidence mismatch; non-null claimed result on verification intent; null-request invariants; ambiguous conditions vs clear unfulfilled conditions; procedural questions without acceptance; multiple issues in one message; and user claims contradicting the fictional sender without a verification event.

Test lifecycle: extraction does not mark addressed; planner selection does not mark addressed until a response commits; actor failure leaves issue open; acknowledgment of addressed issue resolves it only after assessment acceptance; generic thanks does not; completion resolves only the narrowly linked issue; duplicate/replayed extraction does not duplicate records; stale output changes nothing; fallback preserves history. Test original regression fixtures unchanged. Extend review tests so issue/condition/result fields cannot bypass evidence validation. Original maximum observer/repair/reviewer calls remain 1+1+1 with no reviewer retry.

## 7. Integration order

Runtime schemas/rubric → tests → input/prompt/reviewer updates → tests → issue reducer/events → tests → persistence migration and revision checks → integration tests → handoff builder → planner contract tests. Preserve old assessment history as v1 and normalize missing additions to empty/unspecified only when reading historical records, not when validating new v2 model output. No retroactive model calls over old messages. Report changes, executed checks, and blocked live evaluation accurately.

import type { Evidence, IssueRecord } from "@/contracts/observer";
import {
  ForbiddenClaimCodeSchema,
  type Action,
  type AdditionId,
  type Candidate,
  type Constraints,
  type Eligibility,
  type EvidenceRef,
  type FocusCode,
  type MoveId,
  type Style,
  type ToolIntent,
} from "@/contracts/planner";
import { normalizeForScan } from "@/server/observer/flags";
import type { PlanningContext } from "./context";
import { stableHash64 } from "./hash";

/**
 * Candidate generation (planner brief §6). Pure and deterministic: ordered global rules decide WHICH moves
 * are eligible; the planner model only chooses among them and the actor only words them. High-priority
 * gates return immediately. Candidate ids are server-generated and stable within a revision.
 */

export const POLICY_VERSION = "planner-policy-v1";

type Move = { action: Action; facts: Constraints["allowedFactIds"]; additions: AdditionId[]; styles: Style[]; maxWords: number; toolIntent: ToolIntent; focus: FocusCode };
const BOTH: Style[] = ["concise_professional", "plain_explanatory"];
const CONCISE: Style[] = ["concise_professional"];

/** Move catalog (brief §3). Binding constraints come from here, never from the model. */
export const MOVES: Record<MoveId, Move> = {
  answer_identity: { action: "answer_question", facts: ["F01", "F02", "F03"], additions: ["team_label"], styles: BOTH, maxWords: 70, toolIntent: "none", focus: "answer_target" },
  answer_procedure: { action: "answer_question", facts: ["F04", "F05"], additions: [], styles: BOTH, maxWords: 70, toolIntent: "none", focus: "answer_target" },
  answer_scenario_fact: { action: "answer_question", facts: ["F01", "F02", "F03", "F04"], additions: ["case_reference"], styles: BOTH, maxWords: 70, toolIntent: "none", focus: "answer_target" },
  clarify_decision: { action: "clarify_response", facts: [], additions: [], styles: CONCISE, maxWords: 40, toolIntent: "none", focus: "clarify_target" },
  clarify_condition: { action: "clarify_response", facts: [], additions: [], styles: CONCISE, maxWords: 40, toolIntent: "none", focus: "clarify_target" },
  clarify_claimed_check: { action: "clarify_response", facts: [], additions: [], styles: CONCISE, maxWords: 40, toolIntent: "none", focus: "clarify_target" },
  continue_premise: { action: "continue_scenario", facts: ["F01", "F02", "F03"], additions: ["case_reference", "team_label"], styles: BOTH, maxWords: 70, toolIntent: "none", focus: "continue_premise" },
  present_code_request: { action: "present_simulated_request", facts: ["F03", "F04"], additions: [], styles: BOTH, maxWords: 70, toolIntent: "present_practice_code_request", focus: "present_request" },
  address_doubt: { action: "respond_to_objection", facts: ["F01", "F03"], additions: ["team_label"], styles: BOTH, maxWords: 70, toolIntent: "none", focus: "answer_target" },
  back_off_doubt: { action: "acknowledge_boundary", facts: [], additions: [], styles: CONCISE, maxWords: 40, toolIntent: "none", focus: "acknowledge_boundary" },
  acknowledge_refusal: { action: "acknowledge_boundary", facts: [], additions: [], styles: CONCISE, maxWords: 40, toolIntent: "none", focus: "acknowledge_boundary" },
};

/** Actions that answer something the user did and therefore need at least one evidence reference. */
export const USER_RESPONSIVE: ReadonlySet<Action> = new Set(["answer_question", "clarify_response", "respond_to_objection", "acknowledge_boundary"]);

export const MAX_ISSUE_CANDIDATES = 5;

// Deterministic gates over the user's own words. They only ADD an eligible move (address_doubt) or choose
// the acknowledge-unavailable form; they never assign or change a stance.
const OBJECTION = /\b(?:scam|scammer|fake|fraud|phishing|not real|not legit|not legitimate|not from cedar|not who you say|don't believe|do not believe|don't trust|do not trust|suspicious|lying|liar|prove (?:it|you|that)|proof)\b/;
const FACT_TOPIC = /\b(?:who|name|avery|cedar|support|team|line|0142|security|check|case|reference|code|card)\b/;

const quotes = (evidence: readonly Evidence[]) => evidence.map((e) => normalizeForScan(e.quote)).join(" ");

type Draft = { moveId: MoveId; ruleId: string; requestId: string | null; issueId: string | null; refs: EvidenceRef[]; focus?: FocusCode; noFacts?: boolean };
type Excluded = { moveId: MoveId; issueId: string | null; reason: string };

const messageRefs = (evidence: readonly Evidence[]): EvidenceRef[] => [...new Set(evidence.map((e) => e.messageId))].map((id) => ({ kind: "message", id }));
/** Repetition key: message/event refs only (assessment ids change every turn). */
const evidenceKey = (refs: readonly EvidenceRef[]) =>
  refs
    .filter((r) => r.kind !== "assessment")
    .map((r) => `${r.kind}:${r.id}`)
    .sort()
    .join("|");

export function candidateId(revision: number, d: Pick<Draft, "moveId" | "requestId" | "issueId"> & { focus: FocusCode }): string {
  return `c_${stableHash64(`${revision}|${d.moveId}|${d.requestId ?? "-"}|${d.issueId ?? "-"}|${d.focus}`)}`;
}

function build(ctx: PlanningContext, d: Draft): Candidate {
  const base = MOVES[d.moveId];
  // Scenario registry: per-move facts and additions (e.g. the legitimate notice uses L01–L04, no additions).
  const move = ctx.moves ? { ...base, facts: ctx.moves.facts[d.moveId] ?? [], additions: ctx.moves.additions[d.moveId] ?? [] } : base;
  const focus = d.focus ?? move.focus;
  const refs = [...d.refs, ...(ctx.assessment ? [{ kind: "assessment" as const, id: ctx.assessment.id }] : [])].slice(0, 8);
  return {
    id: candidateId(ctx.revision, { ...d, focus }),
    revision: ctx.revision,
    action: move.action,
    moveId: d.moveId,
    requestId: d.requestId,
    issueId: d.issueId,
    ruleId: d.ruleId,
    evidenceRefs: refs,
    focusCode: focus,
    toolIntent: move.toolIntent,
    constraints: {
      maxWords: move.maxWords,
      maxQuestions: 1,
      allowedStyles: move.styles,
      allowedFactIds: d.noFacts ? [] : move.facts,
      allowedAdditionIds: d.noFacts ? [] : move.additions,
      forbiddenClaimCodes: ForbiddenClaimCodeSchema.options,
    },
  };
}

/** Brief §6 repetition exclusions, applied after the rules. */
function exclusion(ctx: PlanningContext, d: Draft): string | null {
  const h = ctx.history;
  const key = evidenceKey(d.refs);
  const target = d.issueId ?? d.requestId;
  switch (d.moveId) {
    case "clarify_decision":
    case "clarify_claimed_check":
      return h.some((p) => p.moveId === d.moveId && (p.issueId ?? p.requestId) === target && evidenceKey(p.evidenceRefs) === key) ? "same clarification target and evidence already delivered" : null;
    case "clarify_condition":
      if (d.issueId) return h.some((p) => p.moveId === "clarify_condition" && p.issueId === d.issueId) ? "this condition issue was already clarified" : null;
      return h.some((p) => p.moveId === "clarify_condition" && p.issueId === null && p.requestId === d.requestId) ? "condition clarification already delivered for this request" : null;
    case "present_code_request":
      return ctx.request || h.some((p) => p.moveId === "present_code_request") ? "the request was already presented" : null;
    case "acknowledge_refusal":
      if (!d.requestId && h.some((p) => p.moveId === "acknowledge_refusal" && !p.requestId)) return "conversation decline already acknowledged";
      return h.some((p) => p.moveId === "acknowledge_refusal" && evidenceKey(p.evidenceRefs) === key) ? "this refusal was already acknowledged" : null;
    case "continue_premise": {
      if (h.filter((p) => p.moveId === "continue_premise").length >= 2) return "continue_premise used twice this session";
      return h.at(-1)?.moveId === "continue_premise" ? "continue_premise never twice consecutively" : null;
    }
    case "address_doubt":
      return h.some((p) => p.moveId === "address_doubt" && p.issueId === d.issueId) ? "doubt already addressed for this issue" : null;
    case "back_off_doubt":
      return h.some((p) => p.moveId === "back_off_doubt") ? "proof limit already acknowledged; await the user's next action" : null;
    case "answer_identity":
    case "answer_procedure":
      // Conditional-table answers (no issue): once per condition evidence.
      return d.issueId === null && h.some((p) => p.moveId === d.moveId && p.issueId === null && evidenceKey(p.evidenceRefs) === key) ? "already answered for this condition evidence" : null;
    default:
      return null;
  }
}

function finish(ctx: PlanningContext, ruleId: string, drafts: Draft[], reason: string, limit = Infinity): Eligibility {
  const excluded: Excluded[] = [];
  const kept: Candidate[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    if (ctx.moves && !ctx.moves.allowed.includes(d.moveId)) {
      excluded.push({ moveId: d.moveId, issueId: d.issueId, reason: "not in this scenario's candidate registry" });
      continue;
    }
    const pair = `${d.issueId ?? d.requestId ?? "-"}:${d.moveId}`;
    if (seen.has(pair)) continue; // at most one candidate per issue/move pair
    seen.add(pair);
    const why = exclusion(ctx, d);
    if (why) excluded.push({ moveId: d.moveId, issueId: d.issueId, reason: why });
    else if (kept.length < limit) kept.push(build(ctx, d));
    else excluded.push({ moveId: d.moveId, issueId: d.issueId, reason: "candidate limit reached" });
  }
  return kept.length ? { kind: "candidates", ruleId, candidates: kept, excluded } : { kind: "wait", ruleId, reason: `${reason}; repetition exclusions emptied the set`, excluded };
}

const wait = (ruleId: string, reason: string): Eligibility => ({ kind: "wait", ruleId, reason, excluded: [] });

function issueDrafts(ctx: PlanningContext, issue: IssueRecord): Draft[] {
  const refs = messageRefs(issue.evidence);
  const base = { ruleId: "P3", requestId: ctx.request?.status === "pending" ? ctx.request.id : null, issueId: issue.id, refs };
  const text = `${quotes(issue.evidence)} ${normalizeForScan(issue.summary)}`;
  switch (issue.kind) {
    case "identity_question": {
      const drafts: Draft[] = [{ ...base, moveId: "answer_identity" }];
      const asksProof = ctx.assessment?.final.verificationObservations.some((o) => o.behavior === "requested_sender_proof" && o.evidence.some((e) => refs.some((r) => r.id === e.messageId)));
      const challenge = OBJECTION.test(quotes(issue.evidence)) || asksProof;
      if (challenge && ctx.doubtBoundaryGiven) return [{ ...base, moveId: "back_off_doubt" }];
      if (challenge) drafts.push({ ...base, moveId: "address_doubt" });
      return drafts;
    }
    case "procedure_question":
      return [{ ...base, moveId: "answer_procedure" }];
    case "scenario_fact_question":
      // No supported fact topic: answer only by acknowledging the information is unavailable.
      return [FACT_TOPIC.test(text) ? { ...base, moveId: "answer_scenario_fact" } : { ...base, moveId: "answer_scenario_fact", focus: "acknowledge_unknown", noFacts: true }];
    case "condition_needs_clarification":
      return [{ ...base, moveId: "clarify_condition" }];
    case "decision_needs_clarification":
      return [{ ...base, moveId: "clarify_decision" }];
  }
}

export function getEligibleCandidates(ctx: PlanningContext): Eligibility {
  // P0: terminal conditions are controller outcomes, never planner choices.
  if (ctx.ended || ctx.stage === "ended") return { kind: "controller", ruleId: "P0", reason: "The session has ended." };
  if (ctx.userTurns >= ctx.maxUserTurns) return { kind: "controller", ruleId: "P0", reason: "Turn limit reached." };
  // P1: verification pauses the opponent; the final decision is UI-only.
  if (ctx.stage === "verifying" || ctx.stage === "awaiting_final_decision") return wait("P1", `Opponent paused (${ctx.stage}).`);
  if (ctx.stopConfirmationPending) return wait("P1", "Stop confirmation pending.");
  const a = ctx.assessment;
  if (!a) return wait("P11", "No applied assessment for the latest user message.");
  const pending = ctx.request?.status === "pending" ? ctx.request : null;
  const current: EvidenceRef[] = [{ kind: "message", id: a.currentMessageId }];

  // P2: observer fallback grants nothing new.
  if (a.resolution === "unclear_fallback") {
    if (!pending) return wait("P2", "Observer fallback and no pending request.");
    return finish(ctx, "P2", [{ moveId: "clarify_decision", ruleId: "P2", requestId: pending.id, issueId: null, refs: current }], "Observer fallback");
  }

  // P3: open issues restrict this turn to answering/clarifying them (oldest first, max five candidates).
  const open = ctx.issues.filter((i) => i.status === "open");
  if (open.length) return finish(ctx, "P3", open.flatMap((i) => issueDrafts(ctx, i)), "Open issues", MAX_ISSUE_CANDIDATES);

  if (!pending && ctx.conversationDeclined) return finish(ctx, "P5", [{ moveId: "acknowledge_refusal", ruleId: "P5", requestId: null, issueId: null, refs: current }], "Opening invitation declined");

  const label = a.final.decision.label;
  // P4: conditional acceptance table.
  if (label === "conditional_acceptance" && a.final.condition && pending) {
    const c = a.final.condition;
    const refs = messageRefs(c.evidence);
    const d = (moveId: MoveId): Draft => ({ moveId, ruleId: "P4", requestId: pending.id, issueId: null, refs });
    switch (c.kind) {
      case "independent_verification":
        return wait("P4", "Clear independent-verification condition: wait for the user.");
      case "sender_proof":
        return finish(ctx, "P4", [d("answer_identity")], "Sender-proof condition");
      case "procedure_answer": {
        const explicit = c.evidence.some((e) => e.quote.includes("?")) || ctx.issues.some((i) => i.kind === "procedure_question" && i.evidence.some((e) => refs.some((r) => r.id === e.messageId)));
        return finish(ctx, "P4", [d(explicit ? "answer_procedure" : "clarify_condition")], "Procedure condition");
      }
      default:
        return finish(ctx, "P4", [d("clarify_condition")], "Unspecified condition");
    }
  }

  // P5: refusal or rejection: acknowledge once per refusal evidence; never re-present.
  if (ctx.request?.status === "rejected" || (label === "refused" && pending)) {
    const refs: EvidenceRef[] =
      ctx.request?.status === "rejected" && ctx.rejectionEventIds.length ? ctx.rejectionEventIds.map((id) => ({ kind: "event", id })) : messageRefs(a.final.decision.evidence);
    return finish(ctx, "P5", [{ moveId: "acknowledge_refusal", ruleId: "P5", requestId: ctx.request!.id, issueId: null, refs }], "Refusal");
  }

  // P6: verification claims and intentions. Never fabricate counterevidence.
  const claimed = a.final.verificationObservations.find((o) => o.behavior === "claimed_verification_completed");
  if (claimed) {
    if (claimed.claimedResult !== "unspecified") return wait("P6", "Specified verification claim: leave user controls available.");
    return finish(ctx, "P6", [{ moveId: "clarify_claimed_check", ruleId: "P6", requestId: pending?.id ?? null, issueId: null, refs: messageRefs(claimed.evidence) }], "Unspecified verification claim");
  }
  if (a.final.verificationObservations.some((o) => o.behavior === "expressed_verification_intent")) return wait("P6", "Verification intent: wait for the user.");

  if (pending) {
    // P7: acceptance is not completion; no extra pressure.
    if (label === "explicit_acceptance") return wait("P7", "Explicit acceptance: wait for the actual user action.");
    // P8: unclear with ambiguity evidence → one clarification.
    if (label === "unclear") {
      const evidence = a.final.ambiguities.flatMap((x) => x.evidence);
      if (!evidence.length) return wait("P8", "Unclear without ambiguity evidence.");
      return finish(ctx, "P8", [{ moveId: "clarify_decision", ruleId: "P8", requestId: pending.id, issueId: null, refs: messageRefs(evidence) }], "Ambiguous decision");
    }
    // P9
    if (label === "considering") return wait("P9", "User is considering.");
  }

  // P10: no request yet and nothing unresolved.
  if (!ctx.request) {
    return finish(
      ctx,
      "P10",
      [
        { moveId: "present_code_request", ruleId: "P10", requestId: null, issueId: null, refs: current },
        { moveId: "continue_premise", ruleId: "P10", requestId: null, issueId: null, refs: current },
      ],
      "No request yet",
    );
  }
  return wait("P11", "Nothing eligible.");
}

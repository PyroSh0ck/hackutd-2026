import { ObserverInputSchema, type DecisionLabel, type ObserverInput } from "@/contracts/observer";
import { RUBRIC, RUBRIC_VERSION } from "@/server/observer/rubric";
import type { RunOutcome } from "@/server/observer/run";
import { OPENING } from "@/server/observer/service";
import type { EvalCase } from "./dataset";

const T0 = Date.parse("2026-11-07T12:00:00.000Z");
const iso = (n: number) => new Date(T0 + n * 1000).toISOString();

/** The same input the service would build: fixed opening, context turns, then the reply under assessment. */
export function buildEvalInput(c: EvalCase): ObserverInput {
  const sessionId = `eval-${c.id}`;
  const opening = { id: "m-0", sessionId, turn: 0, role: "assistant" as const, content: OPENING.content, createdAt: iso(0) };
  let turn = 0;
  const context = c.context.map((m, i) => {
    if (m.role === "user") turn++;
    return { id: `m-${i + 1}`, sessionId, turn, role: m.role, content: m.content, createdAt: iso(i + 1) };
  });
  const reply = { id: `m-${context.length + 1}`, sessionId, turn: turn + 1, role: "user" as const, content: c.reply, createdAt: iso(context.length + 1) };
  const spec = OPENING.requests.find((r) => r.targetAction === c.target)!;
  return ObserverInputSchema.parse({
    sessionId,
    turn: reply.turn,
    basedOnRevision: 1,
    currentMessageId: reply.id,
    request: { id: c.target === "share_fictional_code" ? "r-code" : "r-pay", introducedByMessageId: "m-0", targetAction: c.target, description: spec.description, status: "open" },
    relevantMessages: [opening, ...context, reply],
    previousAssessment: null,
    relevantEvents: [],
    rubricVersion: RUBRIC_VERSION,
    rubric: RUBRIC,
  });
}

export type Prediction = {
  caseId: string;
  split: EvalCase["split"];
  critical: boolean;
  gold: DecisionLabel;
  predicted: DecisionLabel;
  resolution: RunOutcome["resolution"];
  reviewStatus: RunOutcome["reviewStatus"];
  failureReason: RunOutcome["failureReason"];
  calls: number;
  latencyMs: number;
  /** Whether the first structured observer output had valid references (null: no structured output). */
  initialEvidenceValid: boolean | null;
  evidenceMatch: boolean | null;
  verificationMatch: boolean | null;
  inventedServerFields: boolean;
};

const SERVER_OWNED = /"(action|inAppVerification|eventIds|official_verification_completed|completed_in_app_verification|app_known_official)"/;

export function toPrediction(c: EvalCase, outcome: RunOutcome, latencyMs: number): Prediction {
  const final = outcome.finalAssessment;
  const first = outcome.attempts.find((a) => a.stage === "observer");
  const structured = first && first.outcome === "ok" && !first.validationErrors.some((e) => e.code === "invalid_structure" || e.code === "invalid_category");
  const refErrors = new Set(["invalid_message_reference", "non_user_evidence", "quote_not_found", "invalid_request_reference"]);
  const quotes = final.decision.evidence.map((e) => e.quote);
  const verificationMatch = c.expected.verification
    ? c.expected.verification.every((v) => final.verificationObservations.some((o) => o.behavior === v.behavior && o.channelProvenance === v.provenance))
    : final.verificationObservations.length === 0
      ? true
      : null;
  return {
    caseId: c.id,
    split: c.split,
    critical: c.critical,
    gold: c.expected.label,
    predicted: final.decision.label,
    resolution: outcome.resolution,
    reviewStatus: outcome.reviewStatus,
    failureReason: outcome.failureReason,
    calls: outcome.calls,
    latencyMs,
    initialEvidenceValid: structured ? !first!.validationErrors.some((e) => refErrors.has(e.code)) : null,
    evidenceMatch: c.expected.evidenceIncludes && final.decision.label === c.expected.label ? c.expected.evidenceIncludes.every((s) => quotes.some((q) => q.includes(s))) : null,
    verificationMatch,
    inventedServerFields: SERVER_OWNED.test(JSON.stringify(final)),
  };
}

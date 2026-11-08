import { DECISION_LABELS, type DecisionLabel } from "@/contracts/observer";
import type { Prediction } from "./harness";

/**
 * Semantic-quality metrics (brief §10 Stage 7). Pure. Unclear is reported separately so abstaining on
 * everything cannot look like success. These measure a small labeled set, not calibrated reliability.
 */

export type Metrics = {
  n: number;
  accuracy: number | null;
  confusion: Record<DecisionLabel, Record<DecisionLabel, number>>;
  perLabel: Record<DecisionLabel, { support: number; predicted: number; precision: number | null; recall: number | null }>;
  falseAcceptance: { count: number; nonAcceptanceGold: number; rate: number | null; caseIds: string[] };
  criticalWrongAcceptance: { count: number; caseIds: string[] };
  unclearRate: number | null;
  nonUnclearCoverage: number | null;
  /** Accuracy among predictions that were not unclear (abstentions excluded). */
  selectiveAccuracy: number | null;
  evidenceReferenceValidity: { valid: number; of: number; rate: number | null };
  evidenceMatch: { matched: number; of: number; rate: number | null };
  verificationMatch: { matched: number; of: number; rate: number | null };
  reviewRate: number | null;
  correctionRate: number | null;
  fallbackRate: number | null;
  latencyMs: { p50: number | null; p95: number | null; max: number | null };
  callsPerTurn: { mean: number | null; max: number | null; histogram: Record<number, number> };
  inventedServerFields: number;
  releaseGate: { pass: boolean; reasons: string[] };
};

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);
function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function computeMetrics(preds: Prediction[]): Metrics {
  const zero = () => Object.fromEntries(DECISION_LABELS.map((l) => [l, 0])) as Record<DecisionLabel, number>;
  const confusion = Object.fromEntries(DECISION_LABELS.map((l) => [l, zero()])) as Metrics["confusion"];
  for (const p of preds) confusion[p.gold][p.predicted]++;
  const perLabel = Object.fromEntries(
    DECISION_LABELS.map((label) => {
      const tp = confusion[label][label];
      const support = DECISION_LABELS.reduce((s, pred) => s + confusion[label][pred], 0);
      const predicted = DECISION_LABELS.reduce((s, gold) => s + confusion[gold][label], 0);
      return [label, { support, predicted, precision: ratio(tp, predicted), recall: ratio(tp, support) }];
    }),
  ) as Metrics["perLabel"];

  const nonAcceptance = preds.filter((p) => p.gold !== "explicit_acceptance");
  const falseAccept = nonAcceptance.filter((p) => p.predicted === "explicit_acceptance");
  const criticalWrong = preds.filter((p) => p.critical && p.gold !== "explicit_acceptance" && p.predicted === "explicit_acceptance");
  const unclear = preds.filter((p) => p.predicted === "unclear");
  const answered = preds.filter((p) => p.predicted !== "unclear");
  const evidenceChecked = preds.filter((p) => p.initialEvidenceValid !== null);
  const evidenceMatched = preds.filter((p) => p.evidenceMatch !== null);
  const verification = preds.filter((p) => p.verificationMatch !== null);
  const latencies = preds.map((p) => p.latencyMs).sort((x, y) => x - y);
  const histogram: Record<number, number> = {};
  for (const p of preds) histogram[p.calls] = (histogram[p.calls] ?? 0) + 1;
  const invented = preds.filter((p) => p.inventedServerFields).length;

  const reasons: string[] = [];
  if (criticalWrong.length) reasons.push(`${criticalWrong.length} wrong explicit_acceptance on critical regression cases: ${criticalWrong.map((p) => p.caseId).join(", ")}`);
  if (invented) reasons.push(`${invented} final assessments contained server-owned fields`);
  if (!preds.length) reasons.push("no predictions");

  return {
    n: preds.length,
    accuracy: ratio(preds.filter((p) => p.gold === p.predicted).length, preds.length),
    confusion,
    perLabel,
    falseAcceptance: { count: falseAccept.length, nonAcceptanceGold: nonAcceptance.length, rate: ratio(falseAccept.length, nonAcceptance.length), caseIds: falseAccept.map((p) => p.caseId) },
    criticalWrongAcceptance: { count: criticalWrong.length, caseIds: criticalWrong.map((p) => p.caseId) },
    unclearRate: ratio(unclear.length, preds.length),
    nonUnclearCoverage: ratio(answered.length, preds.length),
    selectiveAccuracy: ratio(answered.filter((p) => p.gold === p.predicted).length, answered.length),
    evidenceReferenceValidity: { valid: evidenceChecked.filter((p) => p.initialEvidenceValid).length, of: evidenceChecked.length, rate: ratio(evidenceChecked.filter((p) => p.initialEvidenceValid).length, evidenceChecked.length) },
    evidenceMatch: { matched: evidenceMatched.filter((p) => p.evidenceMatch).length, of: evidenceMatched.length, rate: ratio(evidenceMatched.filter((p) => p.evidenceMatch).length, evidenceMatched.length) },
    verificationMatch: { matched: verification.filter((p) => p.verificationMatch).length, of: verification.length, rate: ratio(verification.filter((p) => p.verificationMatch).length, verification.length) },
    reviewRate: ratio(preds.filter((p) => p.reviewStatus !== "not_requested").length, preds.length),
    correctionRate: ratio(preds.filter((p) => p.reviewStatus === "corrected").length, preds.length),
    fallbackRate: ratio(preds.filter((p) => p.resolution === "unclear_fallback").length, preds.length),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.at(-1) ?? null },
    callsPerTurn: { mean: ratio(preds.reduce((s, p) => s + p.calls, 0), preds.length), max: preds.length ? Math.max(...preds.map((p) => p.calls)) : null, histogram },
    inventedServerFields: invented,
    releaseGate: { pass: reasons.length === 0, reasons },
  };
}

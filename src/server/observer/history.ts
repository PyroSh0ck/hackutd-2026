import { AssessmentRecordSchema, OBSERVER_SCHEMA_V1, type AssessmentRecord } from "@/contracts/observer";

/**
 * Historical v1 records (addendum §7): normalized ONLY when reading stored history. New model output is
 * always validated against the strict v2 schema with no defaults. No retroactive model calls.
 */

type Loose = Record<string, unknown>;

function upgradeAssessment(a: unknown): unknown {
  if (!a || typeof a !== "object") return a;
  const x = a as Loose;
  const condition = x.condition && typeof x.condition === "object" ? { kind: "unspecified", ...(x.condition as Loose) } : x.condition;
  const observations = Array.isArray(x.verificationObservations) ? x.verificationObservations.map((o) => ({ claimedResult: "unspecified", ...(o as Loose) })) : x.verificationObservations;
  return { openIssues: [], issueAcknowledgments: [], ...x, condition, verificationObservations: observations };
}

export function upgradeAssessmentRecord(raw: unknown): AssessmentRecord {
  const r = raw as Loose;
  if (r?.schemaVersion !== OBSERVER_SCHEMA_V1) return AssessmentRecordSchema.parse(raw);
  const reviewer = r.reviewerResponse as Loose | null;
  return AssessmentRecordSchema.parse({
    ...r,
    proposedAssessment: upgradeAssessment(r.proposedAssessment),
    finalAssessment: upgradeAssessment(r.finalAssessment),
    reviewerResponse: reviewer ? { ...reviewer, correctedAssessment: upgradeAssessment(reviewer.correctedAssessment) } : reviewer,
  });
}

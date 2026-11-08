import type { ObserverAssessment, ObserverInput, ReviewFlag, ReviewPolicy } from "@/contracts/observer";

/**
 * Deterministic contradiction checks (brief §7). These produce review flags (suspicions), never errors, and
 * never change a label: regex cannot determine meaning or grammatical scope. No match means no anticipated
 * pattern was found, not that the interpretation is right.
 *
 * Patterns are linear (no nested quantifiers) and inputs are length-bounded by the contracts.
 */

/** Temporary normalization for scanning only. Evidence matching always uses the original text. */
export function normalizeForScan(text: string): string {
  return text
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const REFUSAL =
  /\b(?:won't|wont|will not|not going to|refuse|refusing|never|no way|nope|don't|do not|can't|cannot|not (?:send|share|sending|sharing|give|giving|approve|approving|open|opening|doing)|find someone else|leave me alone|stop (?:texting|messaging|contacting|calling))\b|(?:^|[.!?] )no\b(?! (?:problem|worries)\b)/;
const CONDITIONAL = /\b(?:only if|only after|only once|after i|once i|if you|if i|unless|as long as|provided (?:that|you)|until i|first i|before i|when i)\b/;
// "I will not" / "I'm not going to" are not affirmative; the lookaheads keep them out.
const ACCEPTANCE = /\b(?:yes|yeah|yep|sure|ok|okay|fine|(?:i'll|i will|i'm going to|i am going to)(?! (?:not|never)\b)|here it is|here's|go ahead|i agree|agreed)\b/;

export const PATTERNS = { REFUSAL, CONDITIONAL, ACCEPTANCE } as const;

type Scan = { messageId: string; text: string };

/** Cited decision spans plus the full text of the cited messages and the current message. */
function scanTargets(a: ObserverAssessment, input: ObserverInput): Scan[] {
  const ids = new Set([input.currentMessageId, ...a.decision.evidence.map((e) => e.messageId)]);
  const targets: Scan[] = a.decision.evidence.map((e) => ({ messageId: e.messageId, text: normalizeForScan(e.quote) }));
  for (const m of input.relevantMessages) if (ids.has(m.id) && m.role === "user") targets.push({ messageId: m.id, text: normalizeForScan(m.content) });
  return targets;
}

function firstMatch(targets: Scan[], pattern: RegExp): { messageIds: string[]; matchedText: string } | null {
  const hits = targets.flatMap((t) => {
    const m = pattern.exec(t.text);
    return m ? [{ messageId: t.messageId, text: m[0].replace(/^[.!?] /, "") }] : [];
  });
  if (!hits.length) return null;
  return { messageIds: [...new Set(hits.map((h) => h.messageId))], matchedText: hits[0].text };
}

const POLARITY: Record<string, "accept" | "refuse" | null> = {
  explicit_acceptance: "accept",
  conditional_acceptance: "accept",
  refused: "refuse",
  considering: null,
  unclear: null,
};

/** Semantic-suspicion flags only (no policy). Pure: never mutates its arguments. */
export function contradictionFlags(a: ObserverAssessment, input: ObserverInput): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const targets = scanTargets(a, input);
  const label = a.decision.label;
  if (label === "explicit_acceptance") {
    const refusal = firstMatch(targets, REFUSAL);
    if (refusal) flags.push({ field: "decision.label", code: "acceptance_with_refusal_language", ...refusal, detail: "Acceptance cited alongside refusal-like wording; check negation scope and request target." });
    const conditional = firstMatch(targets, CONDITIONAL);
    if (conditional) flags.push({ field: "decision.label", code: "acceptance_with_conditional_language", ...conditional, detail: "Acceptance cited alongside conditional or hypothetical wording." });
  }
  if (label === "refused") {
    const acceptance = firstMatch(targets, ACCEPTANCE);
    if (acceptance) flags.push({ field: "decision.label", code: "refusal_with_acceptance_language", ...acceptance, detail: "Refusal cited alongside affirmative wording; check request target and scope." });
  }
  const before = input.previousAssessment ? POLARITY[input.previousAssessment.decision.label] : null;
  const now = POLARITY[label];
  if (before && now && before !== now) {
    flags.push({
      field: "decision.label",
      code: "conflicting_evidence",
      messageIds: [input.currentMessageId],
      matchedText: null,
      detail: `Decision changed from ${input.previousAssessment!.decision.label} to ${label}; confirm the latest statement supports the change.`,
    });
  }
  const decisionQuotes = new Set(a.decision.evidence.map((e) => `${e.messageId}\u0000${e.quote}`));
  a.ambiguities.forEach((amb, i) => {
    const shared = amb.evidence.find((e) => decisionQuotes.has(`${e.messageId}\u0000${e.quote}`));
    if (shared && label !== "unclear") {
      flags.push({ field: `ambiguities[${i}]`, code: "conflicting_evidence", messageIds: [shared.messageId], matchedText: shared.quote, detail: "The same span supports the decision and is listed as ambiguous." });
    }
  });
  return flags;
}

const CONSEQUENTIAL = new Set(["explicit_acceptance", "refused"]);

/** Policy-selected review (brief §7). Never silently changes the configured policy. */
export function policyFlags(a: ObserverAssessment, policy: ReviewPolicy): ReviewFlag[] {
  if (policy !== "consequential_and_flagged" || !CONSEQUENTIAL.has(a.decision.label)) return [];
  return [
    {
      field: "decision.label",
      code: "consequential_classification",
      messageIds: [a.currentMessageId],
      matchedText: null,
      detail: `Policy reviews every ${a.decision.label} classification.`,
    },
  ];
}

export function reviewFlags(a: ObserverAssessment, input: ObserverInput, policy: ReviewPolicy): ReviewFlag[] {
  const overlapping = new Set<string>();
  a.openIssues.forEach((issue, i) => {
    for (const other of a.openIssues.slice(i + 1)) {
      if (issue.kind === other.kind) continue;
      for (const e of issue.evidence) if (other.evidence.some((o) => o.messageId === e.messageId && (o.quote.includes(e.quote) || e.quote.includes(o.quote)))) overlapping.add(e.messageId);
    }
  });
  const issueFlags: ReviewFlag[] = overlapping.size ? [{ field: "openIssues", code: "conflicting_evidence", messageIds: [...overlapping], matchedText: null, detail: "Overlapping evidence was assigned different issue kinds. Review whether these are distinct questions or redundant interpretations. A question is not an ambiguous decision merely because it does not accept or refuse. Retain all genuinely distinct questions." }] : [];
  return [...contradictionFlags(a, input), ...issueFlags, ...policyFlags(a, policy)];
}

export const isSemanticFlag = (f: ReviewFlag) => f.code !== "consequential_classification";

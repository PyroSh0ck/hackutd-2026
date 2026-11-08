import type { ObserverAssessment } from "@/contracts/observer";

/**
 * Deterministic support check for observer open-issue drafts, applied to the final assessment (the raw
 * proposal stays in the audit). Live models were observed filing issues that are not there, e.g. a
 * `procedure_question` summarized "No procedure questions were raised" quoting "Sure, go on.". Because open
 * issues restrict the opponent to answering them (planner rule P3), unsupported drafts stall the
 * conversation indefinitely. Narrow on purpose (an objection such as "This is a scam, you're not from
 * Cedar." is a statement and still a genuine identity issue):
 *  - a draft whose summary asserts absence ("No …", "None …", "There are no …") is dropped;
 *  - a question-kind draft is dropped only when EVERY quote is a bare go-ahead ("Sure, go on.",
 *    "Alright, go ahead.", "Okay.") with no question mark.
 */
const QUESTION_KINDS = new Set(["identity_question", "procedure_question", "scenario_fact_question"]);
const ABSENCE = /^\s*(no|none|nothing|there\s+(is|are|were|was)\s+no)\b/i;
const GO_AHEAD_WORDS = new Set(["ok", "okay", "k", "sure", "yes", "yeah", "yep", "yup", "alright", "all", "right", "fine", "go", "on", "ahead", "continue", "proceed", "then", "please", "sounds", "good", "got", "it", "cool", "great", "thanks", "mhm", "uh", "huh"]);

export function isBareGoAhead(quote: string): boolean {
  if (quote.includes("?")) return false;
  const words = quote.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => GO_AHEAD_WORDS.has(w));
}

type Draft = ObserverAssessment["openIssues"][number];

export function issueSupported(draft: Draft): boolean {
  if (ABSENCE.test(draft.summary)) return false;
  if (QUESTION_KINDS.has(draft.kind) && draft.evidence.length > 0 && draft.evidence.every((e) => isBareGoAhead(e.quote))) return false;
  return true;
}

export function pruneUnsupportedIssues(a: ObserverAssessment): ObserverAssessment {
  const kept = a.openIssues.filter(issueSupported);
  return kept.length === a.openIssues.length ? a : { ...a, openIssues: kept };
}

/**
 * Conversation scope (no request presented yet) requires decision {label: "unclear", evidence: []}. Live
 * models were observed attaching evidence to that "unclear" decision and repeating it after repair, which
 * made the whole assessment fall back and silenced the opponent for the turn. Evidence on an "unclear"
 * decision carries no interpretation, so it is cleared before validation. Anything else (another label, a
 * requestId, a condition) is left for the validator to reject as before.
 */
export function clearConversationDecisionEvidence(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const decision = (raw as { decision?: unknown }).decision;
  if (!decision || typeof decision !== "object") return raw;
  const d = decision as { label?: unknown; evidence?: unknown };
  if (d.label !== "unclear" || !Array.isArray(d.evidence) || d.evidence.length === 0) return raw;
  return { ...(raw as object), decision: { ...d, evidence: [] } };
}

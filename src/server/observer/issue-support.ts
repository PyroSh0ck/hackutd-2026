import type { ObserverAssessment } from "@/contracts/observer";
import { issueDraftKey } from "./evidence";

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

/** Words that make a quote about the sender's identity or trustworthiness (questions or objections). */
const IDENTITY_CUE = /\b(?:who|whom|name|identity|are\s+you|you\s+are|you're|company|cedar|avery|team|department|calling|contact(?:ing)?|real|legit\w*|scam\w*|fake|fraud\w*|liar|lying|lie|trust|prove|proof|official)\b/i;

/**
 * A second classification of the SAME words as an identity question, when those words say nothing about
 * identity. Observed live: "What do you need from me?" was filed as a procedure_question AND an
 * identity_question; after the procedure answer the leftover identity issue forced a re-introduction on the
 * next turn ("Okay go ahead" → "I'm Avery from Cedar Account Support…"). Narrow on purpose: a lone identity
 * issue, or one whose quotes contain any identity/trust cue, is always kept, and other kinds are never
 * deduplicated (legitimate multi-part questions keep every issue).
 */
function redundantIdentity(draft: Draft, all: readonly Draft[]): boolean {
  if (draft.kind !== "identity_question" || draft.evidence.length === 0) return false;
  if (draft.evidence.some((e) => IDENTITY_CUE.test(e.quote))) return false;
  const quotes = new Set(draft.evidence.map((e) => `${e.messageId}|${e.quote}`));
  return all.some((o) => o !== draft && o.kind !== "identity_question" && QUESTION_KINDS.has(o.kind) && o.evidence.some((e) => quotes.has(`${e.messageId}|${e.quote}`)));
}

export function pruneUnsupportedIssues(a: ObserverAssessment): ObserverAssessment {
  const kept = a.openIssues.filter((d) => issueSupported(d) && !redundantIdentity(d, a.openIssues));
  return kept.length === a.openIssues.length ? a : { ...a, openIssues: kept };
}

/**
 * Conversation scope (no request presented yet) requires decision {label: "unclear", evidence: []} and no
 * condition: there is no request to accept or refuse. Live models were observed (1) attaching evidence to
 * that "unclear" decision and (2) labeling a pre-request boundary such as "No, I won't send you the code" as
 * "refused" or a stated condition as conditional_acceptance, and repeating it after repair. Validation then
 * rejected the whole assessment, the turn fell back, and the opponent went silent.
 *
 * A request-level decision is not applicable in this scope, so it is normalized before validation: label
 * "unclear", no evidence, no condition. The model's own reading is not lost: the raw proposal stays in the
 * audit record (`proposedAssessment`), and the user's words remain in the dialogue the planner and actor read.
 * Verification observations, issues and stated understanding are untouched and still validated. A non-null
 * requestId is left for the validator to reject.
 */
export function normalizeConversationDecision(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as { decision?: unknown; condition?: unknown };
  const decision = o.decision;
  if (!decision || typeof decision !== "object") return raw;
  const d = decision as { label?: unknown; evidence?: unknown };
  const cleanDecision = d.label === "unclear" && Array.isArray(d.evidence) && d.evidence.length === 0;
  const cleanCondition = o.condition === null || o.condition === undefined;
  if (cleanDecision && cleanCondition) return raw;
  return { ...(raw as object), decision: { ...d, label: "unclear", evidence: [] }, ...(cleanCondition ? {} : { condition: null }) };
}

/**
 * Exact duplicate issue drafts (same kind AND the same evidence messages and quotes, i.e. the validator's own
 * duplicate key) carry no extra information. Observed live: "you're lying" came back as the same
 * identity_question five times, before and after repair, so the whole assessment fell back and the turn went
 * silent. Only the first copy is kept; drafts that merely share a quote but differ in kind or evidence are
 * untouched (legitimate multi-part questions keep every issue). Malformed shapes are left to the validator.
 */
export function collapseDuplicateIssues(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const issues = (raw as { openIssues?: unknown }).openIssues;
  if (!Array.isArray(issues)) return raw;
  const seen = new Set<string>();
  const kept = issues.filter((d) => {
    if (!d || typeof d !== "object" || typeof (d as { kind?: unknown }).kind !== "string" || !Array.isArray((d as { evidence?: unknown }).evidence)) return true;
    const key = issueDraftKey(d as Parameters<typeof issueDraftKey>[0]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return kept.length === issues.length ? raw : { ...(raw as object), openIssues: kept };
}

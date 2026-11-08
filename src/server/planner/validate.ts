import type { z } from "zod";
import { PlanSchema, type Plan, type PlanError, type PlannerInput } from "@/contracts/planner";
import { normalizeForScan } from "@/server/observer/flags";
import { USER_RESPONSIVE } from "./eligibility";

/**
 * Deterministic plan validation (planner brief §7, §9). Checks schema, revision, candidate membership,
 * references, fact/addition subsets, style, and length, plus regex screens on the free-text fields.
 * Regex flags obvious forbidden forms only; it does not prove semantic compliance. The structured
 * selections remain authoritative: contentFocus is advisory and the actor's constraints come from the
 * candidate.
 */

export type PlanValidation = { plan: Plan | null; errors: PlanError[] };

function pathOf(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => (typeof key === "number" ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)), "") || "(root)";
}
const schemaErrors = (error: z.ZodError): PlanError[] =>
  error.issues.slice(0, 20).map((i) => ({ code: "schema", field: pathOf(i.path), detail: i.code === "unrecognized_keys" ? `Unknown keys are not allowed: ${i.keys.join(", ")}` : i.message }));

/** Screens shared by planner focus text and actor output (boundary protection only). */
export const FORBIDDEN_TEXT: Array<{ code: string; pattern: RegExp; detail: string }> = [
  { code: "real_contact_destination", pattern: /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|uk|info|biz|app|link|ly)\b)/i, detail: "Links or web addresses are not allowed." },
  { code: "real_contact_destination", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, detail: "Email addresses are not allowed." },
  { code: "real_contact_destination", pattern: /(?:\+?\d[\s().-]?){7,}/, detail: "Phone numbers are not allowed." },
  { code: "real_contact_destination", pattern: /\b(?:call|text|email|e-mail|message|contact|reach|dial|visit|whatsapp|dm) (?:us|me|our|the) (?:at|on|via)\b/i, detail: "External contact instructions are not allowed." },
  { code: "new_threat", pattern: /\b(?:suspend\w*|shut ?off|shut down|disconnect\w*|deactivat\w*|terminat\w*|lock(?:ed)? out|lose access|legal action|police|arrest\w*|lawsuit|penalt\w*|fees?|charges?|deadline|expires?|expiring|within \d+|last chance|immediately|urgent\w*|or else)\b/i, detail: "New threats, deadlines, fees or consequences are not allowed." },
  { code: "new_threat", pattern: /(?:[$€£¥]\s?\d|\b\d+(?:\.\d+)? ?(?:dollars|usd|credits|euros|pounds)\b)/i, detail: "Amounts are not allowed." },
  { code: "new_request_type", pattern: /\b(?:password|passcode|pin|account number|social security|ssn|card number|cvv|bank|payment|transfer|wire|gift ?cards?|bitcoin|crypto|log ?in|sign ?in|download|install|remote access|date of birth|home address)\b/i, detail: "Requests for other information or actions are not allowed." },
  { code: "authoritative_verification_override", pattern: /\b(?:ignore|skip|don't use|do not use|don't trust|do not trust|no need (?:to|for)) (?:the |any |that )?(?:official|verification|verify|independent)|\b(?:cedar (?:mobile )?(?:has |have )?(?:confirmed|verified)|(?:you(?:'re| are)|this is|we are|i am|i'm) (?:verified|officially confirmed))\b/i, detail: "Overriding or claiming official verification is not allowed." },
  { code: "invented_user_action", pattern: /\b(?:thanks? (?:you )?for (?:sending|sharing|confirming|verifying|submitting|agreeing)|you (?:already |just )?(?:sent|shared|submitted|confirmed|verified|agreed|approved)\b)/i, detail: "Claims about user actions are not allowed." },
  { code: "personal_vulnerability_inference", pattern: /\b(?:you (?:seem|sound|look|must be|are probably) (?:scared|worried|afraid|confused|nervous|old|lonely|anxious|stressed)|i can tell (?:you|that you)|your (?:age|family|health|finances|job))\b/i, detail: "Inferences about the user's vulnerabilities are not allowed." },
  { code: "unknown_identity", pattern: /\b(?:manager|supervisor|fraud (?:team|department)|security team|police|fbi|irs|government|officer|bank)\b/i, detail: "New identities or authorities are not allowed." },
];

/** Additional planner-only screen: contentFocus must not be a finished message or a script. */
const FINISHED_MESSAGE = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b|^(?:i'm|i am|this is) avery\b/i;

export function screenText(text: string): Array<{ code: string; detail: string }> {
  const hits: Array<{ code: string; detail: string }> = [];
  for (const rule of FORBIDDEN_TEXT) if (rule.pattern.test(text)) hits.push({ code: rule.code, detail: rule.detail });
  return hits;
}

export function validatePlan(raw: unknown, input: PlannerInput, options: { sessionActive: boolean }): PlanValidation {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) return { plan: null, errors: schemaErrors(parsed.error) };
  const plan = parsed.data;
  const errors: PlanError[] = [];
  if (!options.sessionActive) errors.push({ code: "session_not_active", field: "(root)", detail: "The session is not active." });
  if (plan.basedOnRevision !== input.basedOnRevision) errors.push({ code: "stale_revision", field: "basedOnRevision", detail: `Plan targets revision ${plan.basedOnRevision}; input is revision ${input.basedOnRevision}.` });
  const candidate = input.candidates.find((c) => c.id === plan.candidateId);
  if (!candidate) {
    errors.push({ code: "unknown_candidate", field: "candidateId", detail: `Candidate ${plan.candidateId} was not supplied.` });
    return { plan: null, errors };
  }
  const c = candidate.constraints;
  plan.selectedFactIds.forEach((id, i) => {
    if (!c.allowedFactIds.includes(id)) errors.push({ code: "disallowed_fact", field: `selectedFactIds[${i}]`, detail: `Fact ${id} is not allowed for this candidate.` });
  });
  if (new Set(plan.selectedFactIds).size !== plan.selectedFactIds.length) errors.push({ code: "disallowed_fact", field: "selectedFactIds", detail: "Duplicate fact ids." });
  plan.selectedAdditionIds.forEach((id, i) => {
    if (!c.allowedAdditionIds.includes(id)) errors.push({ code: "disallowed_addition", field: `selectedAdditionIds[${i}]`, detail: `Addition ${id} is not allowed for this candidate.` });
  });
  if (new Set(plan.selectedAdditionIds).size !== plan.selectedAdditionIds.length) errors.push({ code: "disallowed_addition", field: "selectedAdditionIds", detail: "Duplicate addition ids." });
  if (!c.allowedStyles.includes(plan.style)) errors.push({ code: "disallowed_style", field: "style", detail: `Style ${plan.style} is not allowed for this candidate.` });
  const allowed = new Set(candidate.evidenceRefs.map((r) => `${r.kind}:${r.id}`));
  plan.evidenceRefs.forEach((r, i) => {
    if (!allowed.has(`${r.kind}:${r.id}`)) errors.push({ code: "invalid_reference", field: `evidenceRefs[${i}]`, detail: `Reference ${r.kind}:${r.id} is not in this candidate's allowlist.` });
  });
  if (USER_RESPONSIVE.has(candidate.action) && !plan.evidenceRefs.some((r) => r.kind !== "assessment")) {
    errors.push({ code: "invalid_reference", field: "evidenceRefs", detail: "A user-responsive action needs at least one message or event reference." });
  }
  const focus = normalizeForScan(plan.contentFocus);
  for (const hit of screenText(plan.contentFocus)) errors.push({ code: "invalid_focus", field: "contentFocus", detail: `${hit.code}: ${hit.detail}` });
  if (FINISHED_MESSAGE.test(focus) || FINISHED_MESSAGE.test(plan.contentFocus)) errors.push({ code: "invalid_focus", field: "contentFocus", detail: "contentFocus must describe how to address the target, not contain a finished message." });
  if (/\b(?:F06|official result|not initiated by cedar)\b/i.test(plan.contentFocus)) errors.push({ code: "invalid_focus", field: "contentFocus", detail: "contentFocus must not reference hidden authoritative facts." });
  for (const hit of screenText(plan.briefJustification).filter((h) => h.code === "real_contact_destination")) errors.push({ code: "invalid_focus", field: "briefJustification", detail: `${hit.code}: ${hit.detail}` });
  return { plan: errors.length ? null : plan, errors };
}

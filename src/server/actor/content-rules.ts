/**
 * Runtime content permissions for actor drafts (backend-completion brief §7). Bounded, high-confidence
 * patterns with rule ids and exact spans for the private audit. A demand inside a negated clause ("do not
 * send your password", "no code or payment is required") is a protective statement and is allowed.
 *
 * These checks reduce, but do not eliminate, semantic errors; human and live evaluation remain required.
 * A violation goes through the actor's existing single repair; if it persists the draft is withheld.
 */

export type ContentPolicy = {
  /** Asking for the fictional practice code (only where the scenario and candidate authorize it). */
  allowCodeRequest: boolean;
};

export type ContentViolation = { ruleId: string; span: [number, number]; excerpt: string };

/** `negatable: false`: a negation cue does not excuse the match (mentioning it at all is the violation). */
type Rule = { id: string; pattern: RegExp; applies: (p: ContentPolicy) => boolean; negatable?: false };

const ASK = String.raw`(?:send|share|give|tell|provide|confirm|enter|type|text|read(?:\s+(?:out|back))?|reply\s+with|verify|submit|forward)`;
const RULES: Rule[] = [
  {
    id: "CR1_credential_request",
    pattern: new RegExp(String.raw`\b${ASK}\b[^.!?;\n]{0,40}?\b(?:password|passcode|pin(?:\s+number)?|social\s+security(?:\s+number)?|ssn|card\s+number|cvv|security\s+(?:code|answer|question)|bank\s+account(?:\s+number)?|routing\s+number|login(?:\s+details)?|username)\b`, "giu"),
    applies: () => true,
  },
  {
    id: "CR2_code_request",
    pattern: new RegExp(String.raw`\b${ASK}\b[^.!?;\n]{0,40}?\b(?:(?:practice|verification|one[-\s]?time|security|access|6[-\s]?digit|six[-\s]?digit)\s+)?(?:code|otp)\b`, "giu"),
    applies: (p) => !p.allowCodeRequest,
  },
  {
    id: "CR3_payment_demand",
    pattern: /\b(?:pay|send|transfer|wire|deposit)\b[^.!?;\n]{0,40}?\b(?:fees?|money|payments?|dollars|funds|gift\s+cards?|bitcoin|crypto(?:currency)?|\$\s?\d+)|\b(?:fees?|charges?|penalt(?:y|ies)|payments?)\b[^.!?;\n]{0,30}?\b(?:is|are)\s+(?:due|required|owed|needed)\b|\b(?:a|an|the)\s+(?:fee|charge|penalty)\s+(?:will|may)\s+(?:apply|be\s+(?:charged|added))\b/giu,
    applies: () => true,
  },
  {
    id: "CR4_threat",
    pattern: /\b(?:will|may|could|is\s+going\s+to)\s+be\s+(?:suspended|terminated|closed|locked|disconnected|cancell?ed|deactivated|frozen)\b|\blegal\s+action\b|\b(?:arrest(?:ed)?|police|lawsuit|prosecut(?:e|ion))\b|\byou\s+will\s+lose\b/giu,
    applies: () => true,
  },
  {
    id: "CR5_new_sensitive_request",
    pattern: new RegExp(String.raw`\b${ASK}\b[^.!?;\n]{0,40}?\b(?:date\s+of\s+birth|dob|home\s+address|photo\s+of\s+(?:your\s+)?id|id\s+card|driver'?s\s+licen[cs]e|passport|selfie)\b`, "giu"),
    applies: () => true,
  },
  {
    // The sender is a character: the app's own controls, the simulation and its practice framing belong to
    // app chrome, never to the dialogue (manual testing: "use the request card", "Verify independently").
    // Internal fact ids (F01–F05, L01–L04) are labels, not words: observed live as "…your phone F03 F04".
    id: "CR6_breaks_character",
    pattern:
      /\b(?:request\s+card|simulat(?:or|ion|ed)|practice\s+(?:line|code|account|exercise|session|conversation)|verify\s+independently|official\s+support\s+check|end\s+practice|share\s+practice\s+code|report\s*\/\s*block|(?:this|the)\s+app(?:'s)?|in[-\s]app|(?:button|control)s?\s+(?:in|on|below|above)\b|(?:click|tap|press)\s+(?:the|on)\b|\b[FL]0\d\b)/giu,
    applies: () => true,
    negatable: false,
  },
];

/** Negation cues that make a clause protective ("never", "do not", "no … required", "we will not ask"). */
const NEGATION = /\b(?:do\s+not|don'?t|never|no\s+need\s+to|not\s+(?:required|needed|necessary)|isn'?t|is\s+not|won'?t|will\s+not|should\s+not|shouldn'?t|cannot|can'?t|no)\b/iu;

function clauseAt(text: string, index: number): { start: number; text: string } {
  let start = index;
  while (start > 0 && !/[.!?;\n]/u.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !/[.!?;\n]/u.test(text[end])) end++;
  return { start, text: text.slice(start, end) };
}

export function contentViolations(text: string, policy: ContentPolicy): ContentViolation[] {
  const normalized = text.normalize("NFKC");
  const out: ContentViolation[] = [];
  for (const rule of RULES) {
    if (!rule.applies(policy)) continue;
    for (const match of normalized.matchAll(rule.pattern)) {
      const index = match.index ?? 0;
      const clause = clauseAt(normalized, index);
      // Protective if a negation cue appears in the same clause before or within the match.
      const upToMatchEnd = clause.text.slice(0, index - clause.start + match[0].length);
      if (rule.negatable !== false && NEGATION.test(upToMatchEnd)) continue;
      out.push({ ruleId: rule.id, span: [index, index + match[0].length], excerpt: match[0].slice(0, 120) });
    }
  }
  return out;
}

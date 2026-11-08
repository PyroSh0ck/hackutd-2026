import { ActorOutputSchema as SharedOutputSchema, type ActorOutput, type PlannerAddition } from "@/contracts/planner";
import { contentViolations, type ContentPolicy } from "./content-rules";
import { hardWordLimit, questionCount, wordCount } from "./counts";
import { ActorOutputSchema, type ActorInput, type ActorValidation, type ActorViolation } from "./schemas";

export type ActorGate = { stage: string; ended: boolean; revision: number };
export type ActorValidationContext = {
  reserved: readonly PlannerAddition[];
  knownSecrets: readonly string[];
  state: ActorGate;
};
/**
 * Scenario/candidate content permissions. The fraud scenario may ask for the practice code only on a
 * move that presents or targets the request; nothing may ask for credentials, payment, or new sensitive
 * data, or threaten the user.
 */
export function contentPolicyFor(input: ActorInput): ContentPolicy {
  const i = input.instruction;
  return { allowCodeRequest: input.persona.scenarioId === "mobile-code-01" && i.moveId !== "back_off_doubt" && (i.toolIntent === "present_practice_code_request" || i.target.requestId !== null) };
}

export type ValidatedActorOutput = ActorValidation & { output: ActorOutput | null };

export function gateViolations(state: ActorGate, revision: number): ActorViolation[] {
  if (state.stage !== "active" || state.ended) return [{ code: "session_not_active", field: "session", detail: "Session does not permit an actor response.", offendingExcerpt: null }];
  if (state.revision !== revision) return [{ code: "stale_revision", field: "basedOnRevision", detail: "The conversation changed.", offendingExcerpt: null }];
  return [];
}

/** No state writes and no text rewriting except CRLF canonicalization. No semantic guarantees. */
export function validateActorOutput(raw: unknown, input: ActorInput, ctx: ActorValidationContext): ValidatedActorOutput {
  const violations: ActorViolation[] = [];
  const add = (code: ActorViolation["code"], field: string, detail: string) => violations.push({ code, field, detail, offendingExcerpt: null });
  // Canonicalize before character checks so the 1,200-character boundary uses committed text.
  const candidate = raw && typeof raw === "object" && !Array.isArray(raw) && "text" in raw && typeof raw.text === "string" ? { ...raw, text: raw.text.replace(/\r\n/gu, "\n") } : raw;
  const parsed = ActorOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 20)) {
      const field = issue.path.join(".") || "(root)";
      const code = field === "text" && issue.code === "too_big" ? "text_too_long" : field === "text" && issue.code === "custom" ? "blank_text" : "schema_invalid";
      // Never copy Zod input/unknown keys into audit metadata: they can contain secrets.
      add(code, ["text", "usedFactIds", "introducedAdditionIds"].includes(String(issue.path[0])) ? field : "(root)", "Actor output does not match the strict schema.");
    }
    return { valid: false, violations: [...violations, ...gateViolations(ctx.state, input.instruction.basedOnRevision)], output: null };
  }
  const out = parsed.data;
  const text = out.text;
  const i = input.instruction;
  // A request presentation must ask for the code, not merely create a card next to an acknowledgment.
  // Reuse the existing demand recognizer and its negation handling; this is not semantic proof.
  if (i.toolIntent === "present_practice_code_request" && !contentViolations(text, { allowCodeRequest: false }).some((v) => v.ruleId === "CR2_code_request")) {
    add("prohibited_content", "text", "CR8_missing_request: ask the user to share the six-digit code; acknowledgment or procedure description alone does not fulfill this move.");
  }
  if (!text.trim()) add("blank_text", "text", "Text must not be blank.");
  if (wordCount(text) > hardWordLimit(i)) add("word_limit", "text", "Text exceeds the binding word limit.");
  if (questionCount(text) > Math.min(1, i.constraints.maxQuestions)) add("question_limit", "text", "Text exceeds the binding question limit.");
  for (const [field, ids, allowed] of [
    ["usedFactIds", out.usedFactIds, i.facts.map((f) => f.id)],
    ["introducedAdditionIds", out.introducedAdditionIds, i.additions.map((a) => a.id)],
  ] as const) if (ids.some((id) => !(allowed as readonly string[]).includes(id)) || new Set(ids).size !== ids.length) add("invalid_reference", field, "References must be unique members of the supplied instruction.");
  for (const reserved of ctx.reserved) {
    const allowed = i.additions.find((a) => a.id === reserved.id && a.text === reserved.text && a.introduced === reserved.introduced);
    const present = text.toLowerCase().includes(reserved.text.toLowerCase());
    const declared = (out.introducedAdditionIds as string[]).includes(reserved.id);
    if (present && (!allowed || !text.includes(reserved.text))) add("addition_mismatch", "text", "Reserved details must be supplied and used exactly.");
    if (allowed && present && !allowed.introduced && !declared) add("addition_mismatch", "introducedAdditionIds", "New literal additions must be declared.");
    if (declared && (!allowed || allowed.introduced || !text.includes(reserved.text))) add("addition_mismatch", "introducedAdditionIds", "Only newly used exact additions may be declared.");
  }
  for (const addition of i.additions) if (!ctx.reserved.some((r) => r.id === addition.id && r.text === addition.text)) add("addition_mismatch", "instruction.additions", "The reservation snapshot is incomplete.");
  const reference = ctx.reserved.find((r) => r.id === "case_reference")?.text;
  for (const mention of text.match(/[CcＣｃ][DdＤｄ][-‐‑–—－][0-9０-９]+[\p{L}\p{N}_-]*/gu) ?? []) if (mention !== reference || !i.additions.some((a) => a.id === "case_reference")) add("addition_mismatch", "text", "Unknown or altered case reference.");
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(text) || /<\/?[a-z!][^>]*>|\[[^\]\n]{0,1200}\]\([^\n)]*\)|!\[|```|~~~/iu.test(text)) add("forbidden_format", "text", "Control characters, HTML, links, images and code fences are not allowed.");
  const destinationCopy = text.normalize("NFKC").replace(/[。｡]/gu, ".");
  if (/(?:https?:\/\/|www\.)\S*|\b[\p{L}\p{N}_%+-]+(?:\.[\p{L}\p{N}_%+-]+)*@[\p{L}\p{N}.-]+|\b(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}\b/iu.test(destinationCopy)) add("unapproved_destination", "text", "External destinations are not allowed.");
  // Exempt exact approved numeric tokens BEFORE numeric scanning, never arbitrary digit substrings.
  const numericSpans: Array<[number, number]> = [];
  for (const match of text.matchAll(/\b0142\b|\bCD-\d+\b/gu)) {
    // The practice line suffix is exempt only when a selected fact states it (F02, or L02 in the notice scenario).
    if (match[0] === "0142" && i.facts.some((f) => f.text.includes("0142")) || match[0] === reference && i.additions.some((a) => a.id === "case_reference")) numericSpans.push([match.index!, match.index! + match[0].length]);
  }
  const numericText = text.split("").map((char, index) => numericSpans.some(([start, end]) => index >= start && index < end) ? " " : char).join("").normalize("NFKC");
  if (/(?:\+?\d[\d\s().-]{3,}\d)/u.test(numericText) || /\b\d{4,}\b/u.test(numericText)) add("unapproved_destination", "text", "Phone-like numeric destinations are not allowed.");
  if (ctx.knownSecrets.some((secret) => secret && text.includes(secret))) add("known_secret_in_output", "text", "[redacted known secret]");
  // Content permissions: rule id and exact span go to the private actor audit (excerpt of the demand only).
  for (const v of contentViolations(text, contentPolicyFor(input))) violations.push({ code: "prohibited_content", field: "text", detail: `${v.ruleId} at ${v.span[0]}-${v.span[1]}`, offendingExcerpt: v.excerpt });
  // An exact repeat of a recent reply (case/spacing/punctuation-insensitive) answers nothing new; it goes
  // through the same single repair as any other violation (no extra generation loop). Short acknowledgments
  // ("Understood.") may legitimately recur, so only replies of six or more words count.
  const comparable = (t: string) => t.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (comparable(text).split(" ").length >= 6 && input.recentActorMessages.some((m) => comparable(m.text) === comparable(text))) violations.push({ code: "prohibited_content", field: "text", detail: "CR7_repeated_reply", offendingExcerpt: text.slice(0, 120) });
  violations.push(...gateViolations(ctx.state, i.basedOnRevision));
  return { valid: violations.length === 0, violations, output: violations.length ? null : SharedOutputSchema.parse(out) };
}

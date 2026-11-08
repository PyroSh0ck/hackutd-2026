import type { ActorInstruction } from "@/contracts/planner";
import { hardWordLimit, questionCount, wordCount } from "./counts";
import type { ActorInput, ActorStyleMetrics, ActorStyleProfile, ActorStyleWarning } from "./schemas";

export function buildStyleProfile(i: ActorInstruction): ActorStyleProfile {
  if (!i.constraints.allowedStyles.includes(i.style) || (["clarify_response", "acknowledge_boundary"].includes(i.action) && i.style !== "concise_professional")) throw new Error("Disallowed action/style combination.");
  const explanatory = i.style === "plain_explanatory";
  const lengthTarget = i.action === "present_simulated_request" ? "normal" : i.action === "answer_question" && explanatory ? "explanatory" : explanatory ? "normal" : "brief";
  const [min, max] = { brief: [8, 25], normal: [26, 45], explanatory: [46, 70] }[lengthTarget];
  const upper = Math.min(max, hardWordLimit(i));
  return {
    version: "style-v1", register: "conversational_professional", lengthTarget,
    targetWords: { min: Math.min(min, upper), max: upper }, targetSentences: { min: 1, max: 3 },
    targetQuestions: i.action === "clarify_response" || i.action === "present_simulated_request" ? 1 : 0,
    acknowledgment: i.action === "respond_to_objection" || i.action === "acknowledge_boundary" ? "optional_brief" : "none",
    contractions: "allowed", detail: explanatory && i.action !== "present_simulated_request" ? "brief_explanation" : "direct",
    formatting: "plain_text", emojis: "avoid",
  };
}

type Token = { text: string; start: number; end: number };
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[’‘]/gu, "'");
function tokens(text: string): Token[] {
  return [...normalize(text).matchAll(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
}
function windows(text: string, exemptions: string[]) {
  const normalized = normalize(text);
  const spans: Array<[number, number]> = [];
  for (const phrase of exemptions.map(normalize).filter(Boolean)) {
    let start = normalized.indexOf(phrase);
    while (start !== -1) { spans.push([start, start + phrase.length]); start = normalized.indexOf(phrase, start + phrase.length); }
  }
  const ts = tokens(text);
  const result = new Set<string>();
  for (let n = 0; n <= ts.length - 5; n++) {
    if (!spans.some(([start, end]) => ts[n].start >= start && ts[n + 4].end <= end)) result.add(ts.slice(n, n + 5).map((t) => t.text).join(" "));
  }
  return result;
}
const STOCK = ["i understand your concern", "i completely understand", "thank you for clarifying", "to ensure that i", "please don't hesitate", "let me know if you need anything else", "i'm here to help"];

/** Metrics never change validity or canonical text. Unicode property escapes are supported by Node 20+. */
export function computeStyleMetrics(text: string, input: ActorInput): ActorStyleMetrics {
  const warnings: ActorStyleWarning[] = [];
  const warn = (code: ActorStyleWarning["code"], relatedMessageIds: string[] = []) => warnings.push({ code, relatedMessageIds });
  const recent = input.recentActorMessages.slice(-3);
  const opening = tokens(text).slice(0, 4).map((t) => t.text);
  const repeatedOpenings = recent.filter((m) => opening.length === 4 && tokens(m.text).length >= 4 && tokens(m.text).slice(0, 4).map((t) => t.text).join(" ") === opening.join(" ")).map((m) => m.id);
  // Quoted user passages are literal quotations, never the entire unquoted user message.
  const quotes = input.contextMessages.filter((m) => m.role === "user").flatMap((m) => [...m.text.matchAll(/"([^"\n]+)"|“([^”\n]+)”/gu)].map((x) => x[1] ?? x[2]));
  const exemptions = [input.persona.organization, ...input.controls.map((c) => c.label), ...input.instruction.additions.map((a) => a.text), ...quotes];
  const currentWindows = windows(text, exemptions);
  const shared = new Set<string>();
  const related = new Set<string>();
  for (const message of recent) for (const window of windows(message.text, exemptions)) if (currentWindows.has(window)) { shared.add(window); related.add(message.id); }
  const stockText = normalize(text).replace(/\s+/gu, " ");
  let stockPhraseCount = 0;
  for (const phrase of STOCK) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}'])${phrase}(?![\\p{L}\\p{N}'])`, "gu");
    stockPhraseCount += [...stockText.matchAll(pattern)].length;
  }
  const words = wordCount(text);
  const questions = questionCount(text);
  const sentences = Math.max(1, text.split(/[.!?．。！？]+/u).filter((s) => s.trim()).length);
  if (words < input.styleProfile.targetWords.min || words > input.styleProfile.targetWords.max) warn("outside_length_target");
  if (sentences > input.styleProfile.targetSentences.max) warn("sentence_target");
  if (questions !== input.styleProfile.targetQuestions) warn("question_target");
  if (repeatedOpenings.length) warn("repeated_opening", repeatedOpenings);
  if (shared.size) warn("repeated_phrase", [...related]);
  if (stockPhraseCount) warn("stock_phrase");
  if (/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/mu.test(text)) warn("list_or_heading");
  if (/\p{Extended_Pictographic}/u.test(text)) warn("emoji");
  return { styleVersion: "style-v1", wordCount: words, estimatedSentenceCount: sentences, questionMarkCount: questions, repeatedOpening: repeatedOpenings.length > 0, repeatedPhraseCount: shared.size, stockPhraseCount, warnings };
}

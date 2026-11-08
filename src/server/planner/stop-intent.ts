import { normalizeForScan } from "@/server/observer/flags";

/**
 * Conservative out-of-character stop gate (planner brief §4). The End practice button is the deterministic
 * route; this only catches clear textual requests to stop the EXERCISE. In-character refusals ("stop
 * texting me") and skepticism ("this is a scam") are not stop requests. Bare or negated stop wording is
 * ambiguous: the UI asks a fixed confirmation and no opponent message is generated.
 */

export type StopIntent = "clear" | "ambiguous" | "none";

const EXERCISE = "(?:the |this )?(?:exercise|practice|simulation|training|scenario|session|game|roleplay|role-play)";
const STOP_VERB = "(?:stop|end|quit|exit|leave|finish|cancel|terminate)";
const CLEAR = new RegExp(`\\b${STOP_VERB} ${EXERCISE}\\b`);
const NEGATED = new RegExp(`\\b(?:don't|do not|not|never|no need to|shouldn't|won't)(?: want to| wanna)? ${STOP_VERB} ${EXERCISE}\\b`);
const AMBIGUOUS_WHOLE = new Set([
  "stop",
  "end",
  "quit",
  "exit",
  "done",
  "enough",
  "i'm done",
  "im done",
  "i am done",
  "i quit",
  "end it",
  "stop it",
  "stop this",
  "i want to stop",
  "i want to quit",
  "can we stop",
  "let's stop",
  "lets stop",
  "please stop",
]);

export function stopIntent(text: string): StopIntent {
  const t = normalizeForScan(text).trim();
  if (NEGATED.test(t)) return "ambiguous";
  if (CLEAR.test(t)) return "clear";
  const bare = t.replace(/[.!?,\s]+$/g, "").replace(/^[\s,]+/, "");
  return AMBIGUOUS_WHOLE.has(bare) ? "ambiguous" : "none";
}

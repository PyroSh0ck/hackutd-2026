import type { AppEvent, Message, ObserverAssessment, ObserverInput, SimulatedRequest, TargetAction } from "@/contracts/observer";
import { RUBRIC, RUBRIC_VERSION } from "@/server/observer/rubric";

export const SESSION = "sess-1";
const T0 = Date.parse("2026-11-07T12:00:00.000Z");
export const at = (n: number) => new Date(T0 + n * 1000).toISOString();

export function msg(id: string, role: Message["role"], content: string, turn = 1, sessionId = SESSION): Message {
  return { id, sessionId, turn, role, content, createdAt: at(turn) };
}

export function req(id: string, targetAction: TargetAction = "share_fictional_code", introducedByMessageId = "m-intro"): SimulatedRequest {
  return { id, introducedByMessageId, targetAction, description: `Practice request: ${targetAction}`, status: "open" };
}

export function event(id: string, type: AppEvent["type"], requestId: string | null, turn = 1, sessionId = SESSION): AppEvent {
  return { id, sessionId, requestId, turn, type, createdAt: at(turn) };
}

export const INTRO = msg("m-intro", "assistant", "Security desk here. Please read me the 6-digit practice code we just sent you.", 0);

/**
 * Builds an observer input for one user reply to the intro request. `history` is inserted between the intro
 * and the current message.
 */
export function inputFor(
  reply: string,
  options: { request?: SimulatedRequest; history?: Message[]; events?: AppEvent[]; previous?: ObserverAssessment | null; revision?: number } = {},
): ObserverInput {
  const request = options.request ?? req("r-code");
  const current = msg("m-cur", "user", reply, (options.history?.length ?? 0) + 1);
  return {
    sessionId: SESSION,
    turn: current.turn,
    basedOnRevision: options.revision ?? 3,
    currentMessageId: current.id,
    request,
    relevantMessages: [INTRO, ...(options.history ?? []), current],
    previousAssessment: options.previous ?? null,
    relevantEvents: options.events ?? [],
    rubricVersion: RUBRIC_VERSION,
    rubric: RUBRIC,
  };
}

type Partial2 = Partial<Omit<ObserverAssessment, "decision">> & { decision?: Partial<ObserverAssessment["decision"]> };

/** A well-formed assessment for `input`, quoting `quote` from the current message. */
export function assessment(input: ObserverInput, label: ObserverAssessment["decision"]["label"], quote: string | null, extra: Partial2 = {}): ObserverAssessment {
  const evidence = quote === null ? [] : [{ messageId: input.currentMessageId, quote }];
  return {
    requestId: input.request.id,
    currentMessageId: input.currentMessageId,
    condition: null,
    verificationObservations: [],
    statedUnderstanding: null,
    ambiguities: [],
    ...extra,
    decision: { label, evidence, ...extra.decision },
  };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

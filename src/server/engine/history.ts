import type { Outcome } from "@/contracts/observer";
import type { EventRow, SessionRow } from "@/server/observer/store/types";

/**
 * Owner session summaries, pagination and progress as pure functions, so the Postgres/memory stores and
 * the SpacetimeDB module produce identical results. Summaries are internal (they name the scenario); the
 * public projection hides the scenario until the session has ended.
 */

export type SessionSummary = {
  id: string;
  scenarioId: string;
  scenarioVersion: number;
  createdAt: string;
  ended: boolean;
  stage: SessionRow["stage"];
  outcome: Outcome | null;
  turn: number;
  endedAt: string | null;
  verificationCompleted: boolean;
  reported: boolean;
  requestDeclined: boolean;
  codeShared: boolean;
};

const TERMINAL = new Set(["conversation_ended", "conversation_reported", "practice_code_submitted", "request_rejected", "turn_limit_reached", "technical_interruption", "portal_notice_reviewed"]);

export function summaryOf(s: Pick<SessionRow, "id" | "scenarioId" | "scenarioVersion" | "createdAt" | "ended" | "stage" | "outcome" | "turn">, events: ReadonlyArray<Pick<EventRow, "type" | "createdAt">>): SessionSummary {
  const has = (type: string) => events.some((e) => e.type === type);
  const terminal = s.ended ? [...events].reverse().find((e) => TERMINAL.has(e.type)) : undefined;
  return {
    id: s.id,
    scenarioId: s.scenarioId,
    scenarioVersion: s.scenarioVersion,
    createdAt: s.createdAt,
    ended: s.ended,
    stage: s.stage,
    outcome: s.outcome,
    turn: s.turn,
    endedAt: terminal?.createdAt ?? null,
    verificationCompleted: has("official_verification_completed"),
    reported: has("conversation_reported"),
    requestDeclined: has("request_rejected"),
    codeShared: has("practice_code_submitted"),
  };
}

/** Newest first; ties on createdAt broken by id, so a cursor never skips or repeats a row. */
export const compareSummaries = (a: Pick<SessionSummary, "createdAt" | "id">, b: Pick<SessionSummary, "createdAt" | "id">) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1;

export type Cursor = { createdAt: string; id: string };

export function pageOf(summaries: SessionSummary[], limit: number, cursor: Cursor | null): { items: SessionSummary[]; next: Cursor | null } {
  const sorted = [...summaries].sort(compareSummaries);
  const start = cursor ? sorted.findIndex((s) => compareSummaries(s, cursor) > 0) : 0;
  const rest = start < 0 ? [] : sorted.slice(start);
  const items = rest.slice(0, limit);
  const last = items[items.length - 1];
  return { items, next: rest.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
}

export type Progress = {
  completed: number;
  outcomes: Partial<Record<Outcome, number>>;
  /** Observed actions in ended sessions (counts of sessions), not measured skill or susceptibility. */
  observations: { verificationCompleted: number; reported: number; requestDeclined: number; codeShared: number };
  /** Per scenario: completed count and the latest completion time (for coverage-based selection). */
  scenarios: Array<{ scenarioId: string; completed: number; lastCompletedAt: string | null }>;
};

export function progressOf(summaries: SessionSummary[]): Progress {
  const ended = summaries.filter((s) => s.ended && s.outcome);
  const outcomes: Progress["outcomes"] = {};
  for (const s of ended) outcomes[s.outcome!] = (outcomes[s.outcome!] ?? 0) + 1;
  const byScenario = new Map<string, { completed: number; lastCompletedAt: string | null }>();
  for (const s of ended) {
    const cur = byScenario.get(s.scenarioId) ?? { completed: 0, lastCompletedAt: null };
    const at = s.endedAt ?? s.createdAt;
    byScenario.set(s.scenarioId, { completed: cur.completed + 1, lastCompletedAt: !cur.lastCompletedAt || at > cur.lastCompletedAt ? at : cur.lastCompletedAt });
  }
  const count = (f: (s: SessionSummary) => boolean) => ended.filter(f).length;
  return {
    completed: ended.length,
    outcomes,
    observations: { verificationCompleted: count((s) => s.verificationCompleted), reported: count((s) => s.reported), requestDeclined: count((s) => s.requestDeclined), codeShared: count((s) => s.codeShared) },
    scenarios: [...byScenario.entries()].map(([scenarioId, v]) => ({ scenarioId, ...v })).sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : 1)),
  };
}

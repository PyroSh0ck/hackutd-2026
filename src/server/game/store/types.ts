import type { TurnLog } from "@/contracts/game";
import type { GameEvent } from "../engine/events";
import type { GameState } from "../engine/state";

export type PendingTurn = { turnId: string; startedAt: string; expiresAt: string };
export type LastTurn = { turnId: string; origin: "live_model" | "scripted_fallback"; fallbackReason: TurnLog["fallbackReason"] };

export type SessionRecord = {
  id: string;
  ownerKey: string;
  scenarioId: "bank-alert";
  scenarioVersion: number;
  opponentMode: "live" | "scripted";
  version: number;
  state: GameState;
  pendingTurn: PendingTurn | null;
  lastTurn: LastTurn | null;
  parentSessionId: string | null;
  checkpointEventId: string | null;
};

export type Receipt = { actionId: string; payloadHash: string; resultVersion: number; eventIds: string[] };

export type CommitInput = {
  sessionId: string;
  /** Compare-and-swap: the commit fails unless the stored version equals this. */
  expectedVersion: number;
  events: GameEvent[];
  state: GameState;
  /** Bump version by one (false only for no-op receipts). */
  bumpVersion: boolean;
  receipt: Receipt | null;
  /** If set, the commit also requires this turn to still be the pending turn (rejects stale turns). */
  requirePendingTurnId?: string;
  pendingTurn?: { set: PendingTurn } | { clear: true };
  lastTurn?: LastTurn;
};

export type CommitResult = { ok: true; version: number } | { ok: false; conflict: "version" | "receipt" | "turn" };

export type TurnRecord = Omit<TurnLog, "toolCalls"> & { sessionId: string; toolCalls: TurnLog["toolCalls"] };

export interface GameStore {
  createSession(session: SessionRecord, events: GameEvent[]): Promise<void>;
  /** Returns null when the session doesn't exist OR isn't owned by ownerKey (indistinguishable). */
  loadOwned(sessionId: string, ownerKey: string): Promise<{ session: SessionRecord; events: GameEvent[] } | null>;
  /** Internal (no owner check): used only by turn processing that already holds an owned session id. */
  loadById(sessionId: string): Promise<{ session: SessionRecord; events: GameEvent[] } | null>;
  findReceipt(sessionId: string, actionId: string): Promise<Receipt | null>;
  commit(input: CommitInput): Promise<CommitResult>;
  listForkIds(sessionId: string): Promise<string[]>;
  saveTurn(turn: TurnRecord): Promise<void>;
  listTurns(sessionId: string): Promise<TurnRecord[]>;
}

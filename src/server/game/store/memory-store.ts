import type { GameEvent } from "../engine/events";
import type { CommitInput, CommitResult, GameStore, Receipt, SessionRecord, TurnRecord } from "./types";

/**
 * In-memory store for unit tests and local fixtures ONLY (not reliable across serverless
 * instances). Enforces the same invariants as the Prisma store: CAS on version, unique
 * (sessionId, sequence) and (sessionId, actionId), pending-turn match. Commits are atomic
 * because each runs synchronously after validation.
 */
export class MemoryGameStore implements GameStore {
  private sessions = new Map<string, SessionRecord>();
  private events = new Map<string, GameEvent[]>();
  private receipts = new Map<string, Receipt>();
  private turns = new Map<string, TurnRecord>();

  async createSession(session: SessionRecord, events: GameEvent[]) {
    if (this.sessions.has(session.id)) throw new Error("duplicate session");
    this.sessions.set(session.id, structuredClone(session));
    this.events.set(session.id, structuredClone(events));
  }

  async loadOwned(sessionId: string, ownerKey: string) {
    const found = await this.loadById(sessionId);
    return found && found.session.ownerKey === ownerKey ? found : null;
  }

  async loadById(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return { session: structuredClone(session), events: structuredClone(this.events.get(sessionId) ?? []) };
  }

  async findReceipt(sessionId: string, actionId: string) {
    const receipt = this.receipts.get(`${sessionId}|${actionId}`);
    return receipt ? structuredClone(receipt) : null;
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error("missing session");
    if (session.version !== input.expectedVersion) return { ok: false, conflict: "version" };
    if (input.requirePendingTurnId && session.pendingTurn?.turnId !== input.requirePendingTurnId) return { ok: false, conflict: "turn" };
    if (input.receipt && this.receipts.has(`${input.sessionId}|${input.receipt.actionId}`)) return { ok: false, conflict: "receipt" };
    const existing = this.events.get(input.sessionId) ?? [];
    const sequences = new Set(existing.map((e) => e.sequence));
    if (input.events.some((e) => sequences.has(e.sequence))) return { ok: false, conflict: "version" };

    const version = session.version + (input.bumpVersion ? 1 : 0);
    this.events.set(input.sessionId, [...existing, ...structuredClone(input.events)]);
    if (input.receipt) this.receipts.set(`${input.sessionId}|${input.receipt.actionId}`, { ...structuredClone(input.receipt), resultVersion: version });
    this.sessions.set(input.sessionId, {
      ...session,
      version,
      state: structuredClone(input.state),
      pendingTurn: input.pendingTurn ? ("set" in input.pendingTurn ? input.pendingTurn.set : null) : session.pendingTurn,
      lastTurn: input.lastTurn ?? session.lastTurn,
    });
    return { ok: true, version };
  }

  async listForkIds(sessionId: string) {
    return [...this.sessions.values()].filter((s) => s.parentSessionId === sessionId).map((s) => s.id);
  }

  async saveTurn(turn: TurnRecord) {
    this.turns.set(turn.turnId, structuredClone(turn));
  }

  async listTurns(sessionId: string) {
    return [...this.turns.values()].filter((t) => t.sessionId === sessionId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  /** Test helper: raw events (to assert immutability). */
  rawEvents(sessionId: string) {
    return structuredClone(this.events.get(sessionId) ?? []);
  }
}

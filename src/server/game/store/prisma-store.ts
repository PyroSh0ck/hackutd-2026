import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { parseStoredEvent, type GameEvent } from "../engine/events";
import type { GameState } from "../engine/state";
import type { CommitInput, CommitResult, GameStore, LastTurn, SessionRecord, TurnRecord } from "./types";

type SessionRow = Prisma.GameSessionGetPayload<object>;

class CommitConflict extends Error {
  constructor(public readonly conflict: "version" | "receipt" | "turn") {
    super(conflict);
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    ownerKey: row.ownerKey,
    scenarioId: row.scenarioId as "bank-alert",
    scenarioVersion: row.scenarioVersion,
    opponentMode: row.opponentMode === "scripted" ? "scripted" : "live",
    version: row.version,
    state: row.state as unknown as GameState,
    pendingTurn:
      row.pendingTurnId && row.pendingTurnStartedAt && row.pendingTurnExpiresAt
        ? { turnId: row.pendingTurnId, startedAt: row.pendingTurnStartedAt.toISOString(), expiresAt: row.pendingTurnExpiresAt.toISOString() }
        : null,
    lastTurn:
      row.lastTurnId && row.lastTurnOrigin
        ? {
            turnId: row.lastTurnId,
            origin: row.lastTurnOrigin as LastTurn["origin"],
            fallbackReason: (row.lastTurnFallbackReason ?? null) as LastTurn["fallbackReason"],
          }
        : null,
    parentSessionId: row.parentSessionId,
    checkpointEventId: row.checkpointEventId,
  };
}

const eventRow = (e: GameEvent): Prisma.GameEventCreateManyInput => ({
  id: e.eventId,
  sessionId: e.sessionId,
  sequence: e.sequence,
  type: e.type,
  actor: e.actor,
  payload: e.payload as Prisma.InputJsonValue,
  actionId: e.actionId,
  sourceEventId: e.sourceEventId,
  createdAt: new Date(e.createdAt),
});

/** Postgres (Neon) store. Every commit is one transaction: CAS version + events + receipt. */
export class PrismaGameStore implements GameStore {
  async createSession(session: SessionRecord, events: GameEvent[]) {
    await prisma.$transaction(async (tx) => {
      await tx.gameSession.create({
        data: {
          id: session.id,
          ownerKey: session.ownerKey,
          scenarioId: session.scenarioId,
          scenarioVersion: session.scenarioVersion,
          opponentMode: session.opponentMode,
          version: session.version,
          lastSequence: session.state.lastSequence,
          state: session.state as unknown as Prisma.InputJsonValue,
          parentSessionId: session.parentSessionId,
          checkpointEventId: session.checkpointEventId,
        },
      });
      await tx.gameEvent.createMany({ data: events.map(eventRow) });
    });
  }

  async loadOwned(sessionId: string, ownerKey: string) {
    const row = await prisma.gameSession.findFirst({ where: { id: sessionId, ownerKey } });
    return row ? this.withEvents(row) : null;
  }

  async loadById(sessionId: string) {
    const row = await prisma.gameSession.findUnique({ where: { id: sessionId } });
    return row ? this.withEvents(row) : null;
  }

  private async withEvents(row: SessionRow) {
    const events = await prisma.gameEvent.findMany({ where: { sessionId: row.id }, orderBy: { sequence: "asc" } });
    return { session: toRecord(row), events: events.map((e) => parseStoredEvent({ ...e, eventId: e.id })) };
  }

  async findReceipt(sessionId: string, actionId: string) {
    const row = await prisma.gameActionReceipt.findUnique({ where: { sessionId_actionId: { sessionId, actionId } } });
    return row ? { actionId: row.actionId, payloadHash: row.payloadHash, resultVersion: row.resultVersion, eventIds: row.eventIds } : null;
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    const version = input.expectedVersion + (input.bumpVersion ? 1 : 0);
    try {
      await prisma.$transaction(async (tx) => {
        const pending =
          input.pendingTurn === undefined
            ? {}
            : "set" in input.pendingTurn
              ? {
                  pendingTurnId: input.pendingTurn.set.turnId,
                  pendingTurnStartedAt: new Date(input.pendingTurn.set.startedAt),
                  pendingTurnExpiresAt: new Date(input.pendingTurn.set.expiresAt),
                }
              : { pendingTurnId: null, pendingTurnStartedAt: null, pendingTurnExpiresAt: null };
        const last = input.lastTurn
          ? { lastTurnId: input.lastTurn.turnId, lastTurnOrigin: input.lastTurn.origin, lastTurnFallbackReason: input.lastTurn.fallbackReason }
          : {};
        const updated = await tx.gameSession.updateMany({
          where: {
            id: input.sessionId,
            version: input.expectedVersion,
            ...(input.requirePendingTurnId ? { pendingTurnId: input.requirePendingTurnId } : {}),
          },
          data: {
            version,
            lastSequence: input.state.lastSequence,
            state: input.state as unknown as Prisma.InputJsonValue,
            ...pending,
            ...last,
          },
        });
        if (updated.count !== 1) {
          const current = await tx.gameSession.findUnique({ where: { id: input.sessionId }, select: { version: true } });
          throw new CommitConflict(current && current.version === input.expectedVersion ? "turn" : "version");
        }
        if (input.events.length) await tx.gameEvent.createMany({ data: input.events.map(eventRow) });
        if (input.receipt) {
          await tx.gameActionReceipt.create({
            data: { sessionId: input.sessionId, actionId: input.receipt.actionId, payloadHash: input.receipt.payloadHash, resultVersion: version, eventIds: input.receipt.eventIds },
          });
        }
      });
      return { ok: true, version };
    } catch (error) {
      if (error instanceof CommitConflict) return { ok: false, conflict: error.conflict };
      // Concurrent identical receipt or sequence: the other writer won. Caller re-reads.
      if (isUniqueViolation(error)) return { ok: false, conflict: "receipt" };
      throw error;
    }
  }

  async listForkIds(sessionId: string) {
    const rows = await prisma.gameSession.findMany({ where: { parentSessionId: sessionId }, select: { id: true }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => r.id);
  }

  async saveTurn(turn: TurnRecord) {
    const data = {
      sessionId: turn.sessionId,
      triggerActionId: turn.triggerActionId,
      status: turn.status,
      origin: turn.origin,
      fallbackReason: turn.fallbackReason,
      modelId: turn.modelId,
      modelRequests: turn.modelRequests,
      latencyMs: turn.latencyMs,
      observationFields: turn.observationFields,
      toolCalls: turn.toolCalls as Prisma.InputJsonValue,
      startedAt: new Date(turn.startedAt),
      completedAt: turn.completedAt ? new Date(turn.completedAt) : null,
    };
    await prisma.gameTurn.upsert({ where: { id: turn.turnId }, create: { id: turn.turnId, ...data }, update: data });
  }

  async listTurns(sessionId: string): Promise<TurnRecord[]> {
    const rows = await prisma.gameTurn.findMany({ where: { sessionId }, orderBy: { startedAt: "asc" } });
    return rows.map((r) => ({
      turnId: r.id,
      sessionId: r.sessionId,
      triggerActionId: r.triggerActionId,
      status: r.status as TurnRecord["status"],
      origin: r.origin as TurnRecord["origin"],
      fallbackReason: r.fallbackReason as TurnRecord["fallbackReason"],
      modelId: r.modelId,
      modelRequests: r.modelRequests,
      latencyMs: r.latencyMs,
      observationFields: r.observationFields,
      toolCalls: r.toolCalls as TurnRecord["toolCalls"],
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }
}

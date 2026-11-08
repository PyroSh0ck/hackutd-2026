import "server-only";

import { AssessmentRecordSchema, type AssessmentRecord } from "@/contracts/observer";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { AppendResult, ApplyResult, InputChange, ObserverStore, Receipt, SessionRow, Snapshot } from "./types";

/**
 * Postgres (Neon) observer store. Every write is one short transaction; none spans a model call.
 * - append: `updateMany … WHERE revision = expected` is the CAS; rows + receipt commit with it.
 * - applyAssessment: `updateMany … WHERE claimId = ? AND claimExpiresAt > now AND conversationRevision = ?`
 *   takes the session row lock (serializing with appends) and decides applied vs stale atomically. The
 *   unique `appliedKey` guarantees at most one applied record per (request, message) pair.
 */

class Conflict extends Error {}
const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

function writeRows(tx: Prisma.TransactionClient, sessionId: string, change: InputChange) {
  return Promise.all([
    change.messages?.length
      ? tx.observerMessage.createMany({ data: change.messages.map((m) => ({ id: m.id, sessionId, revision: m.revision, turn: m.turn, role: m.role, content: m.content, createdAt: new Date(m.createdAt) })) })
      : null,
    change.requests?.length
      ? tx.observerRequest.createMany({
          data: change.requests.map((r) => ({ id: r.id, sessionId, revision: r.revision, introducedByMessageId: r.introducedByMessageId, targetAction: r.targetAction, description: r.description, status: r.status })),
        })
      : null,
    change.events?.length
      ? tx.observerEvent.createMany({
          data: change.events.map((e) => ({ id: e.id, sessionId, revision: e.revision, requestId: e.requestId, turn: e.turn, type: e.type, challengeId: e.challengeId, createdAt: new Date(e.createdAt) })),
        })
      : null,
  ]);
}

export class PrismaObserverStore implements ObserverStore {
  async createSession(session: Omit<SessionRow, "claim">, change: InputChange) {
    await prisma.$transaction(async (tx) => {
      await tx.observerSession.create({
        data: { id: session.id, ownerKey: session.ownerKey, threadId: session.threadId, revision: session.revision, conversationRevision: session.conversationRevision, turn: session.turn, ended: session.ended, createdAt: new Date(session.createdAt) },
      });
      await writeRows(tx, session.id, change);
    });
  }

  async load(sessionId: string): Promise<Snapshot | null> {
    const row = await prisma.observerSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: { revision: "asc" } },
        requests: { orderBy: [{ revision: "asc" }, { seq: "asc" }] },
        events: { orderBy: { revision: "asc" } },
        assessments: { orderBy: { seq: "asc" } },
      },
    });
    if (!row) return null;
    return {
      session: {
        id: row.id,
        ownerKey: row.ownerKey,
        threadId: row.threadId,
        revision: row.revision,
        conversationRevision: row.conversationRevision,
        turn: row.turn,
        ended: row.ended,
        claim: row.claimId && row.claimExpiresAt ? { id: row.claimId, expiresAt: row.claimExpiresAt.toISOString() } : null,
        createdAt: row.createdAt.toISOString(),
      },
      messages: row.messages.map((m) => ({ id: m.id, sessionId: m.sessionId, revision: m.revision, turn: m.turn, role: m.role as "user" | "assistant", content: m.content, createdAt: m.createdAt.toISOString() })),
      requests: row.requests.map((r) => ({
        id: r.id,
        revision: r.revision,
        introducedByMessageId: r.introducedByMessageId,
        targetAction: r.targetAction as Snapshot["requests"][number]["targetAction"],
        description: r.description,
        status: r.status as "open" | "closed",
      })),
      events: row.events.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        revision: e.revision,
        requestId: e.requestId,
        turn: e.turn,
        type: e.type as Snapshot["events"][number]["type"],
        challengeId: e.challengeId,
        createdAt: e.createdAt.toISOString(),
      })),
      // Stored records are re-validated on read; the column is authoritative for applied vs stale.
      assessments: row.assessments.map((a) => AssessmentRecordSchema.parse({ ...(a.record as object), application: a.application })),
    };
  }

  async findReceipt(sessionId: string, key: string): Promise<Receipt | null> {
    const row = await prisma.observerReceipt.findUnique({ where: { sessionId_key: { sessionId, key } } });
    return row ? { key: row.key, kind: row.kind as Receipt["kind"], payloadHash: row.payloadHash, resultId: row.resultId, challengeId: row.challengeId } : null;
  }

  async append(sessionId: string, expectedRevision: number, change: InputChange): Promise<AppendResult> {
    const revision = expectedRevision + 1;
    const conversational = Boolean(change.messages?.length || change.requests?.length);
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.observerSession.updateMany({
          where: { id: sessionId, revision: expectedRevision },
          data: { revision, ...(conversational ? { conversationRevision: revision } : {}), ...(change.turn !== undefined ? { turn: change.turn } : {}), ...(change.ended ? { ended: true } : {}) },
        });
        if (updated.count !== 1) throw new Conflict();
        await writeRows(tx, sessionId, change);
        if (change.closeRequestIds?.length) await tx.observerRequest.updateMany({ where: { sessionId, id: { in: change.closeRequestIds } }, data: { status: "closed" } });
        if (change.receipt) {
          const r = change.receipt;
          await tx.observerReceipt.create({ data: { sessionId, key: r.key, kind: r.kind, payloadHash: r.payloadHash, resultId: r.resultId, challengeId: r.challengeId } });
        }
      });
      return { ok: true, revision };
    } catch (error) {
      if (error instanceof Conflict) return { ok: false, conflict: "revision" };
      // A concurrent writer committed the same receipt (or revision row) first.
      if (isUniqueViolation(error)) {
        const receipt = change.receipt ? await this.findReceipt(sessionId, change.receipt.key) : null;
        return { ok: false, conflict: receipt ? "receipt" : "revision" };
      }
      throw error;
    }
  }

  async claim(sessionId: string, claimId: string, now: Date, leaseMs: number) {
    const updated = await prisma.observerSession.updateMany({
      where: { id: sessionId, OR: [{ claimId: null }, { claimExpiresAt: { lt: now } }, { claimId }] },
      data: { claimId, claimExpiresAt: new Date(now.getTime() + leaseMs) },
    });
    return updated.count === 1;
  }

  async release(sessionId: string, claimId: string) {
    await prisma.observerSession.updateMany({ where: { id: sessionId, claimId }, data: { claimId: null, claimExpiresAt: null } });
  }

  async applyAssessment(record: AssessmentRecord, claimId: string, now: Date): Promise<ApplyResult> {
    const row = (application: "applied" | "stale") => ({
      id: record.id,
      sessionId: record.sessionId,
      requestId: record.requestId,
      currentMessageId: record.currentMessageId,
      basedOnRevision: record.basedOnRevision,
      application,
      appliedKey: application === "applied" ? `${record.sessionId}:${record.requestId}:${record.currentMessageId}` : null,
      record: { ...record, application } as unknown as Prisma.InputJsonValue,
      createdAt: new Date(record.createdAt),
    });
    try {
      return await prisma.$transaction(async (tx) => {
        const held = await tx.observerSession.updateMany({
          where: { id: record.sessionId, claimId, claimExpiresAt: { gt: now }, conversationRevision: record.basedOnRevision },
          data: { updatedAt: now },
        });
        const application = held.count === 1 ? "applied" : "stale";
        await tx.observerAssessment.create({ data: row(application) });
        return application;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return "duplicate";
      throw error;
    }
  }
}

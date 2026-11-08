import "server-only";

import { EvidenceSchema, type AssessmentRecord, type Outcome, type SessionStage } from "@/contracts/observer";
import { PlanRecordSchema, type PlanRecord } from "@/contracts/planner";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { upgradeAssessmentRecord } from "../history";
import { summaryOf, type SessionSummary } from "@/server/engine/history";
import type { AdditionRow, AppendResult, ApplyResult, CommitResult, EventRow, InputChange, IssueChanges, IssueRow, ObserverStore, PlanCommit, Receipt, SessionRow, Snapshot } from "./types";

/**
 * Postgres (Neon) session store. Every write is one short transaction; none spans a model call.
 * - append: `updateMany … WHERE revision = expected` is the CAS; rows + receipt commit with it.
 * - applyAssessment: `updateMany … WHERE claimId = ? AND claimExpiresAt > now AND conversationRevision = ?`
 *   takes the session row lock and decides applied vs stale atomically; issue changes commit with it. The
 *   unique `appliedKey` guarantees at most one applied record per (scope/request, message) pair.
 * - commitPlan: `updateMany … WHERE claimId AND claimExpiresAt > now AND revision = ? AND stage = 'active'`
 *   then message, request, events, issue/addition updates and the record; unique `committedKey` allows at
 *   most one committed response per input. Any failure rolls the whole transaction back.
 */

class Conflict extends Error {}
const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
const EvidenceList = EvidenceSchema.array();

function writeRows(tx: Prisma.TransactionClient, sessionId: string, change: Pick<InputChange, "messages" | "requests" | "events" | "additions">) {
  return Promise.all([
    change.messages?.length
      ? tx.observerMessage.createMany({ data: change.messages.map((m) => ({ id: m.id, sessionId, revision: m.revision, turn: m.turn, role: m.role, content: m.content, createdAt: new Date(m.createdAt) })) })
      : null,
    change.requests?.length
      ? tx.observerRequest.createMany({
          data: change.requests.map((r) => ({ id: r.id, sessionId, revision: r.revision, introducedByMessageId: r.introducedByMessageId, targetAction: r.targetAction, description: r.description, status: r.status })),
        })
      : null,
    change.additions?.length ? tx.observerAddition.createMany({ data: change.additions.map((a) => ({ sessionId, additionId: a.id, text: a.text, introducedMessageId: a.introducedMessageId })) }) : null,
  ]).then(() =>
    // Events keep insertion order (seq) within one revision, so they are written in sequence.
    change.events?.reduce<Promise<unknown>>(
      (p, e) => p.then(() => tx.observerEvent.create({ data: { id: e.id, sessionId, revision: e.revision, requestId: e.requestId, turn: e.turn, type: e.type, challengeId: e.challengeId, detail: e.detail, createdAt: new Date(e.createdAt) } })),
      Promise.resolve(),
    ),
  );
}

const planRow = (record: PlanRecord) => ({
  id: record.id,
  sessionId: record.sessionId,
  inputId: record.inputId,
  attempt: record.attempt,
  status: record.status,
  committedKey: record.status === "committed" ? `${record.sessionId}:${record.inputId}` : null,
  record: record as unknown as Prisma.InputJsonValue,
  createdAt: new Date(record.createdAt),
});

export class PrismaObserverStore implements ObserverStore {
  async createSession(session: Omit<SessionRow, "claim">, change: InputChange) {
    await prisma.$transaction(async (tx) => {
      await tx.observerSession.create({
        data: {
          id: session.id,
          ownerKey: session.ownerKey,
          threadId: session.threadId,
          scenarioId: session.scenarioId,
          scenarioVersion: session.scenarioVersion,
          revision: session.revision,
          conversationRevision: session.conversationRevision,
          turn: session.turn,
          ended: session.ended,
          stage: session.stage,
          outcome: session.outcome,
          practiceCode: session.practiceCode,
          caseReference: session.caseReference,
          createdAt: new Date(session.createdAt),
        },
      });
      await writeRows(tx, session.id, change);
    });
  }

  async listSessions(ownerKey: string): Promise<SessionSummary[]> {
    const rows = await prisma.observerSession.findMany({
      where: { ownerKey },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
      select: { id: true, scenarioId: true, scenarioVersion: true, createdAt: true, ended: true, stage: true, outcome: true, turn: true, events: { select: { type: true, createdAt: true }, orderBy: { seq: "asc" } } },
    });
    return rows.map((r) =>
      summaryOf(
        { id: r.id, scenarioId: r.scenarioId, scenarioVersion: r.scenarioVersion, createdAt: r.createdAt.toISOString(), ended: r.ended, stage: r.stage as SessionSummary["stage"], outcome: r.outcome as SessionSummary["outcome"], turn: r.turn },
        r.events.map((e) => ({ type: e.type as EventRow["type"], createdAt: e.createdAt.toISOString() })),
      ),
    );
  }

  async load(sessionId: string): Promise<Snapshot | null> {
    const row = await prisma.observerSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: { revision: "asc" } },
        requests: { orderBy: [{ revision: "asc" }, { seq: "asc" }] },
        events: { orderBy: [{ revision: "asc" }, { seq: "asc" }] },
        assessments: { orderBy: { seq: "asc" } },
        issues: { orderBy: { seq: "asc" } },
        additions: true,
        plans: { orderBy: { seq: "asc" } },
      },
    });
    if (!row) return null;
    return {
      session: {
        id: row.id,
        ownerKey: row.ownerKey,
        threadId: row.threadId,
        scenarioId: row.scenarioId,
        scenarioVersion: row.scenarioVersion,
        revision: row.revision,
        conversationRevision: row.conversationRevision,
        turn: row.turn,
        ended: row.ended,
        stage: row.stage as SessionStage,
        outcome: row.outcome as Outcome | null,
        practiceCode: row.practiceCode,
        caseReference: row.caseReference,
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
        detail: e.detail,
        createdAt: e.createdAt.toISOString(),
      })),
      // Stored records are re-validated on read (v1 history normalized); the column decides applied vs stale.
      assessments: row.assessments.map((a) => upgradeAssessmentRecord({ ...(a.record as object), application: a.application })),
      issues: row.issues.map(
        (i): IssueRow => ({
          id: i.id,
          sessionId: i.sessionId,
          requestId: i.requestId,
          kind: i.kind as IssueRow["kind"],
          summary: i.summary,
          evidence: EvidenceList.parse(i.evidence),
          status: i.status as IssueRow["status"],
          originAssessmentId: i.originAssessmentId,
          addressedMessageId: i.addressedMessageId,
          resolvedByAssessmentId: i.resolvedByAssessmentId,
          resolutionEventId: i.resolutionEventId,
          dedupeKey: i.dedupeKey,
        }),
      ),
      additions: row.additions
        .map((a): AdditionRow => ({ id: a.additionId as AdditionRow["id"], text: a.text, introducedMessageId: a.introducedMessageId }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      plans: row.plans.map((p) => PlanRecordSchema.parse({ ...(p.record as object), status: p.status })),
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
          data: {
            revision,
            ...(conversational ? { conversationRevision: revision } : {}),
            ...(change.turn !== undefined ? { turn: change.turn } : {}),
            ...(change.ended ? { ended: true } : {}),
            ...(change.stage ? { stage: change.stage } : {}),
          },
        });
        if (updated.count !== 1) throw new Conflict();
        // First terminal outcome wins: never overwrite an existing outcome.
        if (change.outcome) await tx.observerSession.updateMany({ where: { id: sessionId, outcome: null }, data: { outcome: change.outcome } });
        await writeRows(tx, sessionId, change);
        if (change.closeRequestIds?.length) await tx.observerRequest.updateMany({ where: { sessionId, id: { in: change.closeRequestIds } }, data: { status: "closed" } });
        for (const r of change.resolveIssues ?? []) {
          await tx.observerIssue.updateMany({ where: { sessionId, id: r.id, status: { not: "resolved" } }, data: { status: "resolved", resolutionEventId: r.resolutionEventId } });
        }
        if (change.receipt) {
          const r = change.receipt;
          await tx.observerReceipt.create({ data: { sessionId, key: r.key, kind: r.kind, payloadHash: r.payloadHash, resultId: r.resultId, challengeId: r.challengeId } });
        }
      });
      return { ok: true, revision };
    } catch (error) {
      if (error instanceof Conflict) return { ok: false, conflict: "revision" };
      // A concurrent writer committed the same receipt first.
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

  async applyAssessment(record: AssessmentRecord, claimId: string, now: Date, issues: IssueChanges): Promise<ApplyResult> {
    const row = (application: "applied" | "stale") => ({
      id: record.id,
      sessionId: record.sessionId,
      requestId: record.requestId,
      currentMessageId: record.currentMessageId,
      basedOnRevision: record.basedOnRevision,
      application,
      appliedKey: application === "applied" ? `${record.sessionId}:${record.requestId ?? "conversation"}:${record.currentMessageId}` : null,
      record: { ...record, application } as unknown as Prisma.InputJsonValue,
      createdAt: new Date(record.createdAt),
    });
    try {
      return await prisma.$transaction(async (tx) => {
        const held = await tx.observerSession.updateMany({
          where: { id: record.sessionId, claimId, claimExpiresAt: { gt: now }, conversationRevision: record.basedOnRevision },
          data: { revision: { increment: 1 } },
        });
        const application = held.count === 1 ? "applied" : "stale";
        await tx.observerAssessment.create({ data: row(application) });
        if (application === "applied") {
          if (issues.create.length) {
            await tx.observerIssue.createMany({
              data: issues.create.map((i) => ({
                id: i.id,
                sessionId: i.sessionId,
                requestId: i.requestId,
                kind: i.kind,
                summary: i.summary,
                evidence: i.evidence as unknown as Prisma.InputJsonValue,
                status: i.status,
                originAssessmentId: i.originAssessmentId,
                addressedMessageId: null,
                resolvedByAssessmentId: null,
                resolutionEventId: null,
                dedupeKey: i.dedupeKey,
              })),
              skipDuplicates: true,
            });
          }
          for (const r of issues.resolve) {
            await tx.observerIssue.updateMany({ where: { sessionId: record.sessionId, id: r.id, status: "addressed" }, data: { status: "resolved", resolvedByAssessmentId: r.assessmentId } });
          }
        }
        return application;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return "duplicate";
      throw error;
    }
  }

  async savePlan(record: PlanRecord): Promise<void> {
    if (record.status === "committed") throw new Error("Committed plans are written only by commitPlan.");
    const data = planRow(record);
    // Never downgrade a committed row.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.plannerRecord.findUnique({ where: { id: record.id }, select: { status: true } });
      if (existing?.status === "committed") return;
      if (existing) await tx.plannerRecord.update({ where: { id: record.id }, data: { status: data.status, record: data.record, committedKey: null } });
      else await tx.plannerRecord.create({ data });
    });
  }

  async commitPlan(commit: PlanCommit): Promise<CommitResult> {
    const { record } = commit;
    const revision = record.basedOnRevision + 1;
    try {
      return await prisma.$transaction(async (tx) => {
        const held = await tx.observerSession.updateMany({
          where: { id: record.sessionId, claimId: commit.claimId, claimExpiresAt: { gt: commit.now }, revision: record.basedOnRevision, stage: "active", ended: false },
          data: { revision, conversationRevision: revision },
        });
        if (held.count !== 1) {
          const stale = planRow({ ...record, status: "stale", committedMessageId: null });
          await tx.plannerRecord.upsert({ where: { id: record.id }, create: stale, update: { status: "stale", record: stale.record, committedKey: null } });
          return "stale" as const;
        }
        await writeRows(tx, record.sessionId, { messages: [commit.message], requests: commit.requests, events: commit.events });
        if (commit.addressIssueId) {
          await tx.observerIssue.updateMany({ where: { sessionId: record.sessionId, id: commit.addressIssueId, status: "open" }, data: { status: "addressed", addressedMessageId: commit.message.id } });
        }
        if (commit.introduceAdditionIds.length) {
          await tx.observerAddition.updateMany({ where: { sessionId: record.sessionId, additionId: { in: commit.introduceAdditionIds }, introducedMessageId: null }, data: { introducedMessageId: commit.message.id } });
        }
        const data = planRow(record);
        await tx.plannerRecord.upsert({ where: { id: record.id }, create: data, update: { status: data.status, record: data.record, committedKey: data.committedKey } });
        return "committed" as const;
      });
    } catch (error) {
      // Unique committedKey: another processor already committed a response for this input.
      if (isUniqueViolation(error)) return "duplicate";
      throw error;
    }
  }
}

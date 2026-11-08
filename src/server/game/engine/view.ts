import { GAME_CONTRACT_VERSION, type LineageView, type OpponentStatus, type PlayerView } from "@/contracts/game";
import type { Scenario } from "../scenario/schema";
import { findCheckpoint } from "./checkpoint";
import { allowedActions } from "./decide";
import type { GameEvent } from "./events";
import type { GameState } from "./state";

export type SessionMeta = {
  sessionId: string;
  version: number;
  opponentMode: "live" | "scripted";
  pendingTurn: OpponentStatus["pendingTurn"];
  lastTurn: OpponentStatus["lastTurn"];
  forkSessionIds: string[];
};

export function lineageView(state: GameState, forkSessionIds: string[]): LineageView {
  return {
    parentSessionId: state.branch?.parentSessionId ?? null,
    checkpointId: state.branch ? "before-payment-decision" : null,
    checkpointEventId: state.branch?.checkpointEventId ?? null,
    inheritedEventCount: state.branch?.inheritedEventCount ?? 0,
    forkSessionIds,
  };
}

/**
 * Public player projection. Reveals inspection details only after inspect_payment and
 * authoritative facts only after verify_trusted_contact. Never includes owner identity,
 * the opponent brief, or private sentinels the player hasn't unlocked.
 */
export function toPlayerView(scenario: Scenario, meta: SessionMeta, state: GameState, events: readonly GameEvent[]): PlayerView {
  const recipient = (id: string) => scenario.recipients.find((r) => r.recipientId === id)!;
  const amountLost = state.debits.reduce((sum, d) => sum + d.amount, 0);
  return {
    contractVersion: GAME_CONTRACT_VERSION,
    sessionId: meta.sessionId,
    scenario: {
      scenarioId: scenario.scenarioId,
      version: scenario.version,
      title: scenario.title,
      premise: scenario.premise,
      fictionalNotice: scenario.fictionalNotice,
    },
    version: meta.version,
    lastSequence: state.lastSequence,
    status: state.status,
    player: scenario.player,
    goal: scenario.goal,
    opponentPersona: scenario.opponentPersona,
    opponent: {
      mode: meta.opponentMode,
      pendingTurn: meta.pendingTurn,
      lastTurn: meta.lastTurn,
      turnsUsed: state.opponentTurnIds.length,
      turnLimit: scenario.limits.maxOpponentTurns,
    },
    messages: state.messages.map((m) => ({
      messageId: m.messageId,
      eventId: m.eventId,
      sequence: m.sequence,
      from: m.from,
      text: m.text,
      origin: m.origin,
      createdAt: m.createdAt,
    })),
    bank: {
      accountLabel: scenario.account.accountLabel,
      currency: "credits",
      balance: state.balance,
      transactions: [
        ...[...state.debits].reverse().map((d) => ({
          transactionId: d.transactionId,
          eventId: d.eventId,
          direction: "debit" as const,
          amount: d.amount,
          counterparty: recipient(d.recipientId).displayName,
          description: "Transfer you approved",
          date: "Today",
        })),
        ...scenario.account.openingTransactions.map((t) => ({ ...t, eventId: null })),
      ],
    },
    paymentRequests: state.requests.map((r) => {
      const fixture = recipient(r.recipientId);
      return {
        requestId: r.requestId,
        eventId: r.eventId,
        amount: r.amount,
        status: r.status,
        recipient: { recipientId: fixture.recipientId, displayName: fixture.displayName, claimedPurpose: fixture.claimedPurpose },
        inspected: r.inspected,
        inspection: r.inspected
          ? { accountLabel: fixture.accountLabel, savedPayee: fixture.savedPayee, warnings: [...fixture.inspectionWarnings] }
          : null,
        origin: r.origin,
      };
    }),
    contacts: scenario.contacts.map((c) => ({ ...c, trusted: true as const })),
    verification: state.verification.verified
      ? { status: "verified", eventId: state.verification.eventId, facts: scenario.verification.facts.map((f) => ({ ...f })) }
      : { status: "not_started", eventId: null, facts: [] },
    allowedActions: allowedActions(scenario, state, { turnPending: meta.pendingTurn !== null }),
    outcome: state.ended
      ? {
          kind: state.ended.outcome,
          fundsLost: amountLost > 0,
          amountLost,
          secretDisclosed: false,
          verified: state.verification.verified,
          endedReason: state.ended.reason,
          decisiveEventId: state.ended.decisiveEventId,
        }
      : null,
    reflectionSubmitted: state.reflection !== null,
    checkpoint: findCheckpoint(scenario, state, events),
    lineage: lineageView(state, meta.forkSessionIds),
  };
}

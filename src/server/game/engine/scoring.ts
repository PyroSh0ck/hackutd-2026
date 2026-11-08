import type { DebriefResponse, ScoreItem } from "@/contracts/game";
import type { Scenario } from "../scenario/schema";
import { findCheckpoint } from "./checkpoint";
import type { GameEvent } from "./events";
import { summarizeEvent } from "./replay";
import type { GameState } from "./state";
import { lineageView } from "./view";

/**
 * Deterministic, rules-based scoring from the event history (never model opinion).
 * Rubric is a game-design choice (brief §3), not a validated psychological measure.
 * Outcome flags (fundsLost, ...) are reported separately and never hidden by a high total.
 */
export function scoreEvents(scenario: Scenario, events: readonly GameEvent[], state: GameState): ScoreItem[] {
  const first = (predicate: (e: GameEvent) => boolean) => events.find(predicate);
  const approval = first((e) => e.type === "payment.approved");
  const verification = first((e) => e.type === "verification.completed");
  const debits = events.filter((e) => e.type === "ledger.debited");
  const ended = first((e) => e.type === "encounter.ended");
  const disengage = first(
    (e) => (e.type === "payment.rejected" || (e.type === "encounter.ended" && e.payload.reason === "player_ended")) && (!approval || e.sequence < approval.sequence),
  );
  const reflection = first((e) => e.type === "reflection.submitted");

  const verifiedInTime = verification !== undefined && (approval === undefined || verification.sequence < approval.sequence);
  const verificationItem: ScoreItem = {
    skillId: "independent_verification",
    label: "Independent verification",
    maxPoints: 40,
    points: verifiedInTime ? 40 : 0,
    earned: verifiedInTime,
    explanation: verifiedInTime
      ? "You called the official line from your contacts before deciding."
      : verification
        ? "You verified with the bank, but only after the transfer had already gone through."
        : "You didn't contact the bank through your trusted contacts before deciding.",
    evidenceEventIds: [verification?.eventId, approval?.eventId].filter((id): id is string => Boolean(id)).concat(
      !verification && !approval && ended ? [ended.eventId] : [],
    ),
  };

  const lost = debits.reduce((sum, e) => sum + (e.type === "ledger.debited" ? e.payload.amount : 0), 0);
  const fundsItem: ScoreItem = {
    skillId: "protects_funds",
    label: "Protects funds",
    maxPoints: 30,
    points: lost === 0 ? 30 : 0,
    earned: lost === 0,
    explanation: lost === 0 ? "No transfer left your account." : `${lost} credits were transferred out of your account.`,
    evidenceEventIds: lost === 0 ? (ended ? [ended.eventId] : []) : debits.map((e) => e.eventId),
  };

  const disengageItem: ScoreItem = {
    skillId: "disengages_safely",
    label: "Disengages safely",
    maxPoints: 20,
    points: disengage ? 20 : 0,
    earned: Boolean(disengage),
    explanation: disengage
      ? disengage.type === "payment.rejected"
        ? "You declined the request."
        : "You ended the conversation."
      : approval
        ? "The request was approved before you declined or ended the conversation."
        : "The conversation ended without you declining or stepping away.",
    evidenceEventIds: disengage ? [disengage.eventId] : approval ? [approval.eventId] : ended ? [ended.eventId] : [],
  };

  const relevant = new Set(scenario.warningSigns.filter((s) => s.relevant).map((s) => s.signId));
  const selected = state.reflection?.warningSignIds ?? [];
  const correct = selected.filter((id) => relevant.has(id)).length;
  const wrong = selected.length - correct;
  const reasoningEarned = reflection !== undefined && correct >= 2 && wrong === 0;
  const reasoningItem: ScoreItem = {
    skillId: "explains_reasoning",
    label: "Explains reasoning",
    maxPoints: 10,
    points: reasoningEarned ? 10 : 0,
    earned: reasoningEarned,
    explanation: !reflection
      ? "Optional: pick the warning signs you noticed."
      : reasoningEarned
        ? `You spotted ${correct} real warning signs.`
        : wrong > 0
          ? "Some picks (like politeness or knowing the bank's name) aren't evidence a message is genuine or fake."
          : "Pick at least two real warning signs for this credit.",
    evidenceEventIds: reflection ? [reflection.eventId] : [],
  };

  return [verificationItem, fundsItem, disengageItem, reasoningItem];
}

export function buildDebrief(
  scenario: Scenario,
  meta: { sessionId: string; forkSessionIds: string[] },
  state: GameState,
  events: readonly GameEvent[],
): DebriefResponse | null {
  if (!state.ended) return null;
  const items = scoreEvents(scenario, events, state);
  const decisive = events.find((e) => e.eventId === state.ended!.decisiveEventId)!;
  const copy = scenario.debrief[state.ended.outcome];
  const amountLost = state.debits.reduce((sum, d) => sum + d.amount, 0);
  return {
    sessionId: meta.sessionId,
    outcome: {
      kind: state.ended.outcome,
      fundsLost: amountLost > 0,
      amountLost,
      secretDisclosed: false,
      verified: state.verification.verified,
      endedReason: state.ended.reason,
      decisiveEventId: state.ended.decisiveEventId,
    },
    score: { total: items.reduce((sum, i) => sum + i.points, 0), max: items.reduce((sum, i) => sum + i.maxPoints, 0), items },
    decisiveEvent: { eventId: decisive.eventId, sequence: decisive.sequence, type: decisive.type, summary: summarizeEvent(scenario, decisive) },
    headline: copy.headline,
    explanation: copy.explanation,
    saferNextAction: copy.saferNextAction,
    warningSignOptions: scenario.warningSigns.map(({ signId, label }) => ({ signId, label })),
    reflection: {
      submitted: state.reflection !== null,
      selectedSignIds: state.reflection?.warningSignIds ?? [],
      // Revealed only after submission so the reflection isn't a giveaway.
      relevantSignIds: state.reflection ? scenario.warningSigns.filter((s) => s.relevant).map((s) => s.signId) : [],
    },
    checkpoint: findCheckpoint(scenario, state, events),
    lineage: lineageView(state, meta.forkSessionIds),
    isPracticeBranch: state.branch !== null,
  };
}

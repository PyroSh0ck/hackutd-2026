import type { AppEventType, ObserverSessionView, Outcome } from "@/contracts/observer";

/** Labels for the server's outcome mapping. Never derived on the client; every ended session is not a success. */
export const OUTCOME: Record<Outcome, { label: string; tone: "success" | "neutral" | "error"; summary: string }> = {
  defense_demonstrated: { label: "Defense demonstrated", tone: "success", summary: "You rejected or reported the request." },
  safely_disengaged: { label: "Safely disengaged", tone: "success", summary: "You ended the practice before sharing anything." },
  simulated_exposure: { label: "Simulated exposure", tone: "error", summary: "You shared the fictional practice code in the simulation." },
  inconclusive: { label: "Inconclusive", tone: "neutral", summary: "The practice reached its turn limit without a decision." },
  technical_interruption: { label: "Incomplete", tone: "neutral", summary: "The practice stopped because of a technical problem. Nothing was decided." },
};

/** Recorded user actions worth showing as review evidence. Server-only events are omitted. */
export const ACTION_LABEL: Partial<Record<AppEventType, string>> = {
  official_verification_started: "Opened the official support check",
  official_verification_cancelled: "Cancelled the official support check",
  official_verification_completed: "Read the official support result",
  final_decision_proceed: "Chose to proceed with the request",
  practice_code_submitted: "Shared the fictional practice code",
  request_rejected: "Declined the request",
  conversation_reported: "Reported and blocked the sender",
  conversation_ended: "Ended the practice",
  stop_confirmation_dismissed: "Chose to keep practicing",
};

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const dateTime = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const startedAt = (v: ObserverSessionView) => v.messages[0]?.createdAt ?? v.events[0]?.createdAt ?? new Date().toISOString();

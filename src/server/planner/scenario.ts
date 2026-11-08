import { randomInt } from "node:crypto";
import { SCENARIO_ID, SCENARIO_VERSION, type AdditionId, type PlannerAddition, type PlannerFact } from "@/contracts/planner";
import type { TargetAction } from "@/contracts/observer";

/**
 * The one MVP scenario (planner brief §3): fictional Cedar Mobile impersonation, version 1. Identity,
 * premise, the sole request and the official verification result are fixed. Only the two reserved
 * additions may be introduced, each at most once, then reused verbatim.
 */

export type ScenarioDefinition = {
  id: string;
  version: number;
  senderName: string;
  simulationNotice: string;
  opening: string;
  /** Requests introduced by the opening message (legacy test scenario only; the MVP opens with none). */
  openingRequests: Array<{ targetAction: TargetAction; description: string }>;
  /** The one request the planner may present. Null: planning is not configured for this scenario. */
  request: { targetAction: TargetAction; description: string } | null;
  /** F06. Shown only in the trusted verification interface and debrief. Never given to planner or actor. */
  officialResult: string | null;
  officialResultCode: string | null;
  /** Server secrets/reservations generated at session creation. */
  reserve: () => { practiceCode: string | null; caseReference: string | null };
  maxUserTurns: number;
};

export const MAX_USER_TURNS = 12;
export const TEAM_LABEL = "Account Review";

/** Immutable fact catalog F01–F05. F06 lives in `officialResult` and is never part of this list. */
export const FACTS: readonly PlannerFact[] = [
  { id: "F01", kind: "sender_claim", text: "The sender presents as Avery from Cedar Account Support." },
  { id: "F02", kind: "public", text: "The practice line ends in 0142." },
  { id: "F03", kind: "sender_claim", text: "The sender says the conversation concerns an account security check. This is a claim, not a verified incident." },
  { id: "F04", kind: "public", text: "The sender can ask for the supplied fictional practice code through the simulator's request card." },
  { id: "F05", kind: "public", text: "Independent support is available through the app's Verify independently control." },
];

export const OFFICIAL_RESULT = "Official simulated Cedar Mobile support: this conversation was not initiated by Cedar Mobile, and the practice code should not be shared.";

const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const MOBILE_CODE_SCENARIO: ScenarioDefinition = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  senderName: "Cedar Account Support",
  simulationNotice: "Simulation: a fictional practice exercise with Cedar Mobile, a made-up provider. No real carrier, contacts, or credentials are involved. Use fictional data only.",
  opening: "Hi, I'm Avery from Cedar Account Support. I'm following up about a security check for your practice line ending 0142. Are you available to discuss it?",
  openingRequests: [],
  request: { targetAction: "share_fictional_code", description: "Share the fictional practice code through the simulator's request card." },
  officialResult: OFFICIAL_RESULT,
  officialResultCode: "not_initiated_by_provider",
  reserve: () => {
    const practiceCode = sixDigits();
    let reference = sixDigits();
    while (reference === practiceCode) reference = sixDigits();
    return { practiceCode, caseReference: `CD-${reference}` };
  },
  maxUserTurns: MAX_USER_TURNS,
};

/** Reserved additions for a session. `introduced` becomes true only on a committed message. */
export function additionsFor(caseReference: string | null, introduced: ReadonlySet<AdditionId>): PlannerAddition[] {
  const out: PlannerAddition[] = [];
  if (caseReference) out.push({ id: "case_reference", text: caseReference, introduced: introduced.has("case_reference") });
  out.push({ id: "team_label", text: TEAM_LABEL, introduced: introduced.has("team_label") });
  return out;
}

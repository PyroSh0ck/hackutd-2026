import type { ScenarioDefinition } from "@/server/planner/scenario";

/**
 * The original observer test scenario (before the planner brief): one opening message introducing two
 * fictional requests, no planner. Kept for observer-pipeline regression tests (multi-request fan-out,
 * stale handling) and the observer eval set, whose gold labels were written against this opening.
 */
export const LEGACY_OPENING =
  "[Practice scenario — fictional] Maple Ridge Bank security desk here. We stopped a suspicious 200-credit transfer on your practice account. To confirm it's really you, read me the 6-digit practice code we just texted you, then approve a 200-credit holding transfer so your funds stay safe. You can call us back at 555-0142 if you want to check.";

export const LEGACY_SCENARIO: ScenarioDefinition = {
  id: "legacy-observer-v1",
  version: 0,
  senderName: "Maple Ridge Bank (fictional)",
  simulationNotice: "Simulation.",
  opening: LEGACY_OPENING,
  openingRequests: [
    { targetAction: "share_fictional_code", description: "Read the 6-digit practice code texted to the user back to the sender." },
    { targetAction: "approve_simulated_payment", description: "Approve a 200-credit 'holding' transfer requested by the sender." },
  ],
  request: null,
  officialResult: null,
  officialResultCode: null,
  reserve: () => ({ practiceCode: null, caseReference: null }),
  maxUserTurns: 12,
};

import { SCENARIO_ID, SCENARIO_VERSION, type AdditionId, type MoveId, type PlannerAddition, type PlannerFact } from "@/contracts/planner";
import type { TargetAction } from "@/contracts/observer";
import { privateScenario } from "@/server/reference/catalog";

/**
 * The one MVP scenario (planner brief §3): fictional Cedar Mobile impersonation, version 1. Identity,
 * premise, the sole request and the official verification result are fixed. Only the two reserved
 * additions may be introduced, each at most once, then reused verbatim.
 */

export type ScenarioKind = "fraudulent" | "legitimate" | "legacy";

/** A scenario's candidate registry: which moves exist, and the facts/additions each may use. */
export type MoveRegistry = { allowed: readonly MoveId[]; facts: Partial<Record<MoveId, PlannerFact["id"][]>>; additions: Partial<Record<MoveId, AdditionId[]>> };

export type ScenarioDefinition = {
  id: string;
  version: number;
  /** Private: never shown to the planner, actor, or the browser before review. */
  kind: ScenarioKind;
  /** Facts the opponent may use. */
  facts: readonly PlannerFact[];
  /** Null: every move with its default facts (mobile-code-01). */
  moves: MoveRegistry | null;
  /** Legitimate scenarios: the trusted in-app account record the user can review. */
  portal: { id: string; title: string; summary: string; actionLabel: string } | null;
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
  /**
   * Server secrets/reservations generated at session creation. `random` returns a value in [0, 1); the
   * SpacetimeDB module passes its deterministic `ctx.random`, Node passes a CSPRNG-backed source.
   */
  reserve: (random?: () => number) => { practiceCode: string | null; caseReference: string | null };
  maxUserTurns: number;
};

export const MAX_USER_TURNS = 12;
const MOBILE_CODE_SCENARIO_NOTICE = "Simulation: a fictional practice exercise with Cedar Mobile, a made-up provider. No real carrier, contacts, or credentials are involved. Use fictional data only.";
export const TEAM_LABEL = "Account Review";

/**
 * Fact catalog F01–F05: what the CHARACTER may say, written as labeled data about the sender's world, not
 * as sentences: live models pasted sentence-style facts verbatim ("The sender says…", "Avery is running…")
 * and repeated them every turn. `kind` marks sender claims. App guidance (the request
 * card, the official support check, End practice) is app chrome and never a dialogue fact; the simulation
 * disclosure lives in `simulationNotice` and the UI. Ids are stable (candidates reference ids only, so the
 * module's commit guard is unaffected by wording). F06 lives in `officialResult` and is never in this list.
 */
export const FACTS: readonly PlannerFact[] = [
  { id: "F01", kind: "sender_claim", text: "The sender presents as Avery from Cedar Account Support." },
  { id: "F02", kind: "public", text: "Account mobile line: ends in 0142." },
  { id: "F03", kind: "sender_claim", text: "Stated reason for contact: a routine security check on the account." },
  { id: "F04", kind: "sender_claim", text: "How the check works (as claimed): a six-digit code texted to the account holder's phone." },
  { id: "F05", kind: "sender_claim", text: "Claimed effort: about a minute; nothing else is needed." },
];

import { OFFICIAL_RESULT } from "@/server/reference/canonical";
export { OFFICIAL_RESULT };

/** CSPRNG-backed [0, 1) via Web Crypto (available in Node and browsers; no `node:` import, so module-safe). */
export const secureRandom = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const sixDigits = (random: () => number) => String(Math.floor(random() * 1_000_000)).padStart(6, "0");

export const MOBILE_CODE_SCENARIO: ScenarioDefinition = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  kind: "fraudulent",
  facts: FACTS,
  moves: null,
  portal: null,
  senderName: "Cedar Account Support",
  simulationNotice: MOBILE_CODE_SCENARIO_NOTICE,
  opening: "Hi, I'm Avery from Cedar Account Support. I'm following up about a security check on your mobile line ending 0142. Do you have a minute to go through it?",
  openingRequests: [],
  request: { targetAction: "share_fictional_code", description: "Share the fictional practice code through the simulator's request card." },
  officialResult: OFFICIAL_RESULT,
  officialResultCode: "not_initiated_by_provider",
  reserve: (random = secureRandom) => {
    const practiceCode = sixDigits(random);
    let reference = sixDigits(random);
    while (reference === practiceCode) reference = sixDigits(random);
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

// ---------------------------------------------------------------------------------------------- legitimate

const NOTICE = privateScenario("mobile-notice-01", 1);
if (!NOTICE || NOTICE.kind !== "legitimate") throw new Error("Reference catalog is missing mobile-notice-01 v1.");

/** L01–L04: the catalog's allowed facts for the legitimate notice, verbatim. */
export const NOTICE_FACTS: readonly PlannerFact[] = NOTICE.allowedFacts.map((text, i) => ({ id: `L0${i + 1}` as PlannerFact["id"], kind: "public" as const, text }));

/**
 * mobile-notice-01 v1: a genuine monthly-statement notice from the same persona. The same engine runs it
 * with a restricted candidate registry: answer identity / procedure / statement questions and acknowledge
 * a refusal; never a code request, payment, or the fraud scenario's reserved additions.
 */
export const MOBILE_NOTICE_SCENARIO: ScenarioDefinition = {
  id: NOTICE.id,
  version: NOTICE.version,
  kind: "legitimate",
  facts: NOTICE_FACTS,
  moves: {
    allowed: ["answer_identity", "answer_procedure", "answer_scenario_fact", "acknowledge_refusal"],
    facts: { answer_identity: ["L02"], answer_procedure: ["L03", "L04"], answer_scenario_fact: ["L01", "L03", "L04"], acknowledge_refusal: ["L03"] },
    additions: {},
  },
  portal: NOTICE.portalRecord,
  senderName: "Cedar Account Support",
  simulationNotice: MOBILE_CODE_SCENARIO_NOTICE,
  opening: NOTICE.opening,
  openingRequests: [],
  request: null,
  officialResult: NOTICE.verificationText,
  officialResultCode: "authorized_notice",
  reserve: () => ({ practiceCode: null, caseReference: null }),
  maxUserTurns: NOTICE.maxUserTurns,
};

/** Every scenario this build can run or reload, by `${id}@${version}`. */
export const SCENARIOS: readonly ScenarioDefinition[] = [MOBILE_CODE_SCENARIO, MOBILE_NOTICE_SCENARIO];
export const scenarioById = (id: string, version: number, extra: readonly ScenarioDefinition[] = []) => [...extra, ...SCENARIOS].find((s) => s.id === id && s.version === version) ?? null;

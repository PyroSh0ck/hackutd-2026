import type { ScenarioDefinition } from "@/server/planner/scenario";
import { progressOf, type SessionSummary } from "./history";

export type Selection = "mixed" | "recommended";

/**
 * Rule-based coverage selection (not personalization or measured susceptibility).
 *  - mixed: uniform among enabled scenarios using backend randomness.
 *  - recommended: least recently completed enabled scenario; never-completed first; catalog id tie-break.
 */
export function selectScenario(selection: Selection, enabled: readonly ScenarioDefinition[], history: SessionSummary[], random: () => number): ScenarioDefinition {
  if (!enabled.length) throw new Error("No practice scenarios are enabled.");
  if (selection === "mixed") return enabled[Math.min(enabled.length - 1, Math.floor(random() * enabled.length))];
  const last = new Map(progressOf(history).scenarios.map((s) => [s.scenarioId, s.lastCompletedAt ?? ""]));
  return [...enabled].sort((a, b) => {
    const la = last.get(a.id) ?? "";
    const lb = last.get(b.id) ?? "";
    return la === lb ? (a.id < b.id ? -1 : 1) : la < lb ? -1 : 1;
  })[0];
}

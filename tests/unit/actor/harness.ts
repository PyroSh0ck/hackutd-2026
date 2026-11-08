import { vi } from "vitest";
import type { StructuredRequest, StructuredResult } from "@/server/observer/model";
import type { ActorExecutionState, ActorRunOptions } from "@/server/actor/run";
import type { ActorModel } from "@/server/actor/model";
import { envelope, input, output, timestamp } from "./fixtures";

export const state = (): ActorExecutionState => ({ sessionId: "session", ownerKey: "owner", claimId: "claim", claimValid: true, policyVersion: "policy-v1", planApplicable: true, stage: "active", ended: false, revision: 20 });
export const options = (): ActorRunOptions => ({ input: input(), envelope: envelope(), reserved: [{ id: "case_reference", text: "CD-123456", introduced: false }, { id: "team_label", text: "Account Review", introduced: false }], knownSecrets: ["938201"] });
export function setup(results: StructuredResult[] = [{ ok: true, output: output() }]) {
  const requests: StructuredRequest[] = [];
  const current = state();
  const model: ActorModel = { modelId: "fixture", generate: vi.fn(async (request) => { requests.push(request); return results[requests.length - 1]; }) };
  let id = 0; let tick = 0;
  return { requests, current, deps: { model, readState: async () => ({ ...current }), newId: () => `audit-${++id}`, now: () => new Date(timestamp), monotonicNow: () => tick++ * 7 } };
}

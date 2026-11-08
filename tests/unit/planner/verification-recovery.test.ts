import { describe, expect, it } from "vitest";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { OWNER, started } from "./session-fixture";

const game = () => started({ planner: () => new FixturePlannerModel(), actor: () => new FixtureActorModel() });
const view = async (s: Awaited<ReturnType<typeof game>>, owner = OWNER) => (await s.service.getSession(owner, s.id)).session;

describe("verification recovery after reload (backend-completion brief §6)", () => {
  it("B06: start → reload recovers the active challenge → acknowledge → report = defense_demonstrated, no restart", async () => {
    const s = await game();
    const before = await view(s);
    expect(before.verification).toMatchObject({ activeChallengeId: null, attemptId: null, officialResult: null });
    const start = await s.act({ type: "official_verification_started", requestId: null });
    const reloaded = await view(s); // a fresh GET, as after a page reload: no client state
    expect(reloaded.verification.activeChallengeId).toBe(start.challengeId);
    expect(reloaded.verification.attemptId).toBe(reloaded.events.find((e) => e.type === "official_verification_started")!.id);
    await s.act({ type: "official_verification_completed", requestId: null, challengeId: reloaded.verification.activeChallengeId! });
    const decided = await view(s);
    expect(decided.stage).toBe("awaiting_final_decision");
    expect(decided.verification.activeChallengeId).toBeNull();
    const reported = (await s.act({ type: "conversation_reported", requestId: null })).session;
    expect(reported.outcome).toBe("defense_demonstrated");
  });

  it("B07: a cancelled attempt's challenge cannot acknowledge the new attempt", async () => {
    const s = await game();
    const a = (await s.act({ type: "official_verification_started", requestId: null })).challengeId!;
    await s.act({ type: "official_verification_cancelled", requestId: null });
    expect((await view(s)).verification.activeChallengeId).toBeNull();
    const b = (await s.act({ type: "official_verification_started", requestId: null })).challengeId!;
    expect(b).not.toBe(a);
    await expect(s.act({ type: "official_verification_completed", requestId: null, challengeId: a })).rejects.toMatchObject({ details: { reason: "CHALLENGE_INVALID" } });
    const v = await view(s);
    expect(v.stage).toBe("verifying");
    expect(v.verification.activeChallengeId).toBe(b);
  });

  it("another owner never sees the session or its challenge", async () => {
    const s = await game();
    await s.act({ type: "official_verification_started", requestId: null });
    await expect(s.service.getSession("anon:someone-else", s.id)).rejects.toMatchObject({ status: 404 });
  });
});

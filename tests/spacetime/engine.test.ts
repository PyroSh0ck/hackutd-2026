import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { SpacetimeBackend, SpacetimeUnavailableError, spacetimeConfigFromEnv, type SpacetimeConfig } from "@/server/engine/spacetime-backend";
import { HttpError } from "@/server/http/errors";
import { ObserverService } from "@/server/observer/service";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";

/**
 * Integration against a REAL SpacetimeDB server running the published `spacetime/` module (no mocks of
 * the module). Models are the labeled test fixtures, so this proves state authority and atomicity, not
 * model quality. Requires `pnpm spacetime:start`, `pnpm spacetime:publish`, `pnpm spacetime:setup`.
 */

const config = spacetimeConfigFromEnv();
const OWNER = `anon:spacetime-${randomUUID()}`;

function serviceWith(backend: SpacetimeBackend) {
  return new ObserverService({
    backend,
    models: () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }),
    policy: "consequential_and_flagged",
    timeoutMs: 5000,
    planning: { models: () => ({ planner: new FixturePlannerModel(), actor: new FixtureActorModel() }), timeoutMs: 5000 },
  });
}

describe.skipIf(!config)("SpacetimeDB training module (live local server)", () => {
  let backend: SpacetimeBackend;
  let service: ObserverService;
  const say = (id: string, content: string, key = randomUUID()) => service.submitMessage(OWNER, id, { idempotencyKey: key, content });
  const act = (id: string, type: Parameters<ObserverService["submitEvent"]>[2]["type"], extra: Partial<Parameters<ObserverService["submitEvent"]>[2]> = {}) =>
    service.submitEvent(OWNER, id, { idempotencyKey: randomUUID(), type, requestId: null, ...extra });
  const progress = async () => ((await backend.progress(OWNER)).value ?? { completed: 0, defenseDemonstrated: 0, simulatedExposure: 0 }) as Record<string, number>;

  beforeAll(() => {
    backend = new SpacetimeBackend(config as SpacetimeConfig);
    service = serviceWith(backend);
  });

  it("full practice: planner tool creates a request in the module; verification → final decision → report; outcome and progress recorded once", async () => {
    const before = await progress();
    const { session } = await service.createSession(OWNER);
    const id = session.sessionId;
    expect(session.messages[0].content).toMatch(/Avery from Cedar Account Support/);

    const answered = await say(id, "Who are you?");
    expect(answered.session.messages.filter((m) => m.role === "assistant")).toHaveLength(2);

    const presented = await say(id, "Sure, go on.");
    expect(presented.session.requestStatus).toBe("pending");
    expect(presented.session.events.some((e) => e.type === "request_presented")).toBe(true);

    const started = await act(id, "official_verification_started");
    expect(started.challengeId).toBeTruthy();
    expect(started.session.stage).toBe("verifying");
    // The authoritative result is released by the module's rule, not supplied by the client.
    expect(started.session.verification.officialResult).toMatch(/not initiated by Cedar Mobile/);

    // Completing needs the challenge the module issued.
    await expect(act(id, "official_verification_completed", { challengeId: randomUUID() })).rejects.toBeInstanceOf(HttpError);
    const completed = await act(id, "official_verification_completed", { challengeId: started.challengeId });
    expect(completed.session.stage).toBe("awaiting_final_decision");

    const reported = await act(id, "conversation_reported");
    expect(reported.session).toMatchObject({ ended: true, outcome: "defense_demonstrated" });

    const after = await progress();
    expect(after.completed).toBe((before.completed ?? 0) + 1);
    expect(after.defenseDemonstrated).toBe((before.defenseDemonstrated ?? 0) + 1);

    // Inputs after the end are rejected and audited; progress does not move again.
    await expect(act(id, "conversation_ended")).rejects.toMatchObject({ status: 422 });
    const final = (await service.getSession(OWNER, id)).session;
    expect(final.events.some((e) => e.type === "event_rejected_after_end")).toBe(true);
    expect((await progress()).completed).toBe(after.completed);
  });

  it("explicit request action is the only path to simulated exposure; chat 'I accept' does not submit", async () => {
    const id = (await service.createSession(OWNER)).session.sessionId;
    const v = (await say(id, "Sure, go on.")).session;
    const request = v.requests.at(-1)!;
    const accepted = (await say(id, "I accept")).session;
    expect(accepted.outcome).toBeNull();
    expect(accepted.requestStatus).toBe("pending");
    const shared = (await act(id, "practice_code_submitted", { requestId: request.id, practiceCode: v.practiceCode! })).session;
    expect(shared.outcome).toBe("simulated_exposure");
  });

  it("repeated message / event idempotency keys do not duplicate state", async () => {
    const id = (await service.createSession(OWNER)).session.sessionId;
    const key = randomUUID();
    const first = await say(id, "Who are you?", key);
    const again = await say(id, "Who are you?", key);
    expect(again.duplicate).toBe(true);
    expect(again.session.messages.length).toBe(first.session.messages.length);
    await expect(say(id, "Different text", key)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("commit guards run in the module: wrong claim, stale revision and a forged candidate are all rejected without a message", async () => {
    const id = (await service.createSession(OWNER)).session.sessionId;
    await say(id, "Who are you?");
    const snapshot = (await backend.load(id))!;
    const committed = snapshot.plans.find((p) => p.status === "committed")!;
    const forged = { ...committed, id: `plan-${randomUUID()}`, status: "prepared" as const, committedMessageId: null, basedOnRevision: snapshot.session.revision };

    const claimId = randomUUID();
    expect(await backend.claim(id, claimId, 60_000)).toBe(true);
    expect((await backend.commitPrepared(id, forged, randomUUID())).kind).toBe("stale"); // wrong claim
    expect((await backend.commitPrepared(id, { ...forged, basedOnRevision: snapshot.session.revision - 1 }, claimId)).kind).toBe("stale"); // stale revision
    const fakeCandidate = { ...forged, acceptedPlan: { ...forged.acceptedPlan!, candidateId: "c_ffffffffffffffff" } };
    expect((await backend.commitPrepared(id, fakeCandidate, claimId)).kind).toBe("stale"); // not an eligible candidate
    await backend.release(id, claimId);
    expect((await backend.load(id))!.messages.length).toBe(snapshot.messages.length);
  });

  it("stop during the turn: a later commit for the old revision is discarded", async () => {
    const id = (await service.createSession(OWNER)).session.sessionId;
    await say(id, "Who are you?");
    const snapshot = (await backend.load(id))!;
    const plan = { ...snapshot.plans.find((p) => p.status === "committed")!, id: `plan-${randomUUID()}`, status: "prepared" as const, committedMessageId: null, basedOnRevision: snapshot.session.revision };
    const claimId = randomUUID();
    await backend.claim(id, claimId, 60_000);
    await act(id, "conversation_ended");
    expect((await backend.commitPrepared(id, plan, claimId)).kind).toBe("stale");
    const after = (await backend.load(id))!;
    expect(after.session.outcome).toBe("safely_disengaged");
    expect(after.messages.length).toBe(snapshot.messages.length);
  });

  it("an unauthorized identity cannot create sessions, commit, or read another owner's session", async () => {
    const id = (await service.createSession(OWNER)).session.sessionId;
    const { token } = (await (await fetch(`${config!.url}/v1/identity`, { method: "POST" })).json()) as { token: string };
    const intruder = new SpacetimeBackend({ ...config!, token });
    await expect(intruder.createSession("anon:intruder")).rejects.toThrow(/unauthorized/);
    await expect(intruder.load(id)).rejects.toThrow(/unauthorized/);
    await expect(intruder.concludeTurnLimit(id)).rejects.toThrow(/unauthorized/);
    // Ownership through the app: another owner key gets a 404, never the session.
    await expect(service.getSession("anon:someone-else", id)).rejects.toMatchObject({ status: 404 });
  });

  it("SpacetimeDB is essential: when it is unreachable no training transition happens (no Postgres fallback)", async () => {
    const down = serviceWith(new SpacetimeBackend({ ...config!, url: "http://127.0.0.1:9" }));
    await expect(down.createSession(OWNER)).rejects.toBeInstanceOf(SpacetimeUnavailableError);
  });
});

it.runIf(!config)("SpacetimeDB integration skipped: not configured (run pnpm spacetime:start, spacetime:publish, spacetime:setup)", () => {
  expect(config).toBeNull();
});

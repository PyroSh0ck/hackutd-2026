import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGameAdapter, createFixtureAdapter } from "@/features/game/adapter";
import { fixtureInitialView, fixturePaymentRequestedView } from "@/contracts/game-fixtures";
import { ApiClientError } from "@/lib/api-client";
import { PlayerViewSchema } from "@/contracts/game";

afterEach(() => vi.unstubAllGlobals());

describe("game API boundary", () => {
  it("sends only contract action fields and validates the public response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ session: fixturePaymentRequestedView, result: { status: "applied", eventIds: [], opponentTurn: null } })));
    vi.stubGlobal("fetch", fetcher);
    const input = { actionId: crypto.randomUUID(), expectedVersion: 1, action: { type: "send_message" as const, text: "I win" } };
    expect(await apiGameAdapter.submit(fixtureInitialView.sessionId, input)).toEqual(fixturePaymentRequestedView);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/game/sessions/${fixtureInitialView.sessionId}/actions`);
  });

  it("retains conflict metadata for a refetch instead of making up state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "VERSION_CONFLICT", message: "Changed", currentVersion: 4 }, requestId: "ui-test" }), { status: 409 })));
    await expect(apiGameAdapter.get(fixtureInitialView.sessionId)).rejects.toBeInstanceOf(ApiClientError);
  });

  it("rejects malformed public views", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ session: { balance: 999 } }))));
    await expect(apiGameAdapter.create({})).rejects.toThrow();
  });

  it("uses the frozen checkpoint and restart routes", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ session: fixtureInitialView }))));
    vi.stubGlobal("fetch", fetcher);
    await apiGameAdapter.fork(fixtureInitialView.sessionId);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ checkpointId: "before-payment-decision" });
    await apiGameAdapter.create({ opponentMode: "scripted" });
    expect(fetcher.mock.calls[1][0]).toBe("/api/game/sessions");
  });
});

it("fixture snapshots are public contract views and unsupported paths stay explicit", async () => {
  const adapter = createFixtureAdapter();
  const initial = await adapter.create({});
  expect(PlayerViewSchema.safeParse(initial).success).toBe(true);
  await expect(adapter.submit(initial.sessionId, { actionId: crypto.randomUUID(), expectedVersion: 1, action: { type: "end_encounter" } })).rejects.toThrow("no committed public snapshot");
  expect(await adapter.get(initial.sessionId)).toEqual(initial);
});

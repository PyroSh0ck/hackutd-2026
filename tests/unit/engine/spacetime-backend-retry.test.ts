import { describe, expect, it } from "vitest";
import { SpacetimeBackend, SpacetimeUnavailableError } from "@/server/engine/spacetime-backend";

const CONFIG = { url: "https://stdb.example", database: "db", token: "worker-token" };
const ok = (result: unknown) => new Response(JSON.stringify(JSON.stringify({ ok: true, result })), { status: 200 });

function scripted(...steps: (Response | Error)[]) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url).split("/call/")[1]);
    const step = steps.shift();
    if (!step) throw new Error("unexpected extra call");
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return { impl, calls };
}

describe("SpacetimeBackend transport resilience (hosted server)", () => {
  it("retries a read once after a dropped connection", async () => {
    const f = scripted(new TypeError("fetch failed"), ok([]));
    await expect(new SpacetimeBackend(CONFIG, f.impl).listSessions("anon:x")).resolves.toEqual([]);
    expect(f.calls).toEqual(["list_sessions", "list_sessions"]);
  });

  it("retries an idempotent user write once after a 5xx", async () => {
    const f = scripted(new Response("bad gateway", { status: 502 }), ok({ kind: "duplicate", receipt: {} }));
    await expect(new SpacetimeBackend(CONFIG, f.impl).submitMessage("s", { key: "k", content: "hi", payloadHash: "h" })).resolves.toMatchObject({ kind: "duplicate" });
    expect(f.calls).toEqual(["submit_user_message", "submit_user_message"]);
  });

  it("gives up after the single retry", async () => {
    const f = scripted(new Response("", { status: 503 }), new Response("", { status: 503 }));
    await expect(new SpacetimeBackend(CONFIG, f.impl).progress("anon:x")).rejects.toBeInstanceOf(SpacetimeUnavailableError);
    expect(f.calls).toHaveLength(2);
  });

  it("never retries session creation or agent-turn operations", async () => {
    const create = scripted(new TypeError("fetch failed"));
    await expect(new SpacetimeBackend(CONFIG, create.impl).createSession("anon:x")).rejects.toBeInstanceOf(SpacetimeUnavailableError);
    expect(create.calls).toEqual(["start_session"]);
    const claim = scripted(new Response("", { status: 502 }));
    await expect(new SpacetimeBackend(CONFIG, claim.impl).claim("s", "c", 1000)).rejects.toBeInstanceOf(SpacetimeUnavailableError);
    expect(claim.calls).toEqual(["claim_agent_turn"]);
  });

  it("does not retry client errors (authorization)", async () => {
    const f = scripted(new Response("unauthorized", { status: 401 }));
    await expect(new SpacetimeBackend(CONFIG, f.impl).listSessions("anon:x")).rejects.toThrow(/401/);
    expect(f.calls).toHaveLength(1);
  });
});

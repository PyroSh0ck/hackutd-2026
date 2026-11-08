import { describe, expect, it, vi } from "vitest";
import { ActorHttpModel, actorModelFromEnv } from "@/server/actor/model";
import { providerSchema } from "@/server/observer/model";
import { ActorOutputSchema } from "@/server/actor/schemas";
import { output } from "./fixtures";

const config = { baseUrl: "https://provider.test/v1", apiKey: "synthetic-key", modelId: "fixture" };
const request = { stage: "actor" as const, schemaName: "actor_output", schemaDescription: "Actor", jsonSchema: providerSchema(ActorOutputSchema), system: "system", user: "input", timeoutMs: 20_000 };
const response = (content: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(content) });

describe("actor native structured content adapter", () => {
  it("makes one non-streaming request without tools or retry configuration", async () => {
    const fetchImpl = vi.fn(async () => response({ choices: [{ message: { content: JSON.stringify(output()) } }] }));
    const model = new ActorHttpModel(config, fetchImpl);
    expect(await model.generate(request)).toEqual({ ok: true, output: output() }); expect(fetchImpl).toHaveBeenCalledTimes(1);
    const args = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(args[1].body as string);
    expect(body).toMatchObject({ model: "fixture", stream: false, response_format: { type: "json_schema" } });
    expect(body).not.toHaveProperty("tools"); expect(body).not.toHaveProperty("tool_choice");
    expect(args[1].headers).toMatchObject({ Authorization: "Bearer synthetic-key" });
  });
  it.each([
    [{ choices: [{ message: { refusal: "declined" } }] }, "refusal"],
    [{ choices: [{ finish_reason: "content_filter", message: {} }] }, "refusal"],
    [{ choices: [{ message: { content: "```json\n{}\n```" } }] }, "malformed_output"],
    [{ choices: [{ message: { content: "{}", tool_calls: [] } }] }, "malformed_output"],
    [{}, "malformed_output"],
  ])("classifies provider response without autonomous actions", async (payload, failure) => {
    const fetchImpl = vi.fn(async () => response(payload)); expect(await new ActorHttpModel(config, fetchImpl).generate(request)).toMatchObject({ ok: false, failure }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not retry HTTP/network failures or expose provider bodies/credentials", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => "sensitive raw provider payload" }));
    const result = await new ActorHttpModel(config, fetchImpl).generate(request); expect(result).toMatchObject({ ok: false, failure: "http_error" }); expect(JSON.stringify(result)).not.toMatch(/sensitive|synthetic-key/); expect(fetchImpl).toHaveBeenCalledTimes(1);
    const network = vi.fn(async () => { throw new Error("provider secret"); }); expect(await new ActorHttpModel(config, network).generate(request)).toMatchObject({ ok: false, failure: "http_error" }); expect(network).toHaveBeenCalledTimes(1);
  });
  it("propagates cancellation signal to the provider", async () => {
    const abort = new AbortController(); abort.abort();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => { expect(init.signal?.aborted).toBe(true); throw new Error("AbortError"); });
    expect(await new ActorHttpModel(config, fetchImpl).generate(request, abort.signal)).toMatchObject({ ok: false, failure: "timeout" });
  });
  it("reuses configuration and supports a distinct actor model without a default live provider", () => {
    expect(actorModelFromEnv({})).toBeNull();
    expect(actorModelFromEnv({ MODEL_BASE_URL: config.baseUrl, MODEL_API_KEY: config.apiKey, MODEL_ID: "base", ACTOR_MODEL_ID: "actor" })?.modelId).toBe("actor");
  });
});

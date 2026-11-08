import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInlineToolCalls, readModelConfig, stripThinking } from "@/server/game/opponent/client";
import { redactPlayerText } from "@/server/game/opponent/redact";
import { GameService } from "@/server/game/service";
import { MemoryGameStore } from "@/server/game/store/memory-store";
import { FakeProvider } from "./fake-provider";

describe("provider output parsing", () => {
  it("parses Nemotron-style inline <TOOLCALL> blocks and strips them from text", () => {
    const parsed = parseInlineToolCalls(
      'Sure.<TOOLCALL>[{"name":"sendSimulatedMessage","arguments":{"text":"Hi"}},{"name":"presentPaymentRequest","arguments":{"recipientId":"mrb-secure-holding","amount":500}}]</TOOLCALL>',
    )!;
    expect(parsed.calls.map((c) => c.function.name)).toEqual(["sendSimulatedMessage", "presentPaymentRequest"]);
    expect(JSON.parse(parsed.calls[1].function.arguments)).toEqual({ recipientId: "mrb-secure-holding", amount: 500 });
    expect(parsed.rest).toBe("Sure.");
    expect(new Set(parsed.calls.map((c) => c.id)).size).toBe(2);
    expect(parseInlineToolCalls("<TOOLCALL>{broken</TOOLCALL>")).toEqual({ calls: [], rest: "" });
    expect(parseInlineToolCalls("plain")).toBeNull();
  });

  it("strips reasoning blocks", () => {
    expect(stripThinking("<think>secret plan</think>Hello")).toBe("Hello");
  });

  it("inline tool calls are dispatched as tools, never shown as chat text", async () => {
    const provider = new FakeProvider().enqueue({
      content: '<TOOLCALL>[{"name":"sendSimulatedMessage","arguments":{"text":"Please approve."}},{"name":"presentPaymentRequest","arguments":{"recipientId":"mrb-secure-holding","amount":500}}]</TOOLCALL>',
    });
    const service = new GameService({ store: new MemoryGameStore(), modelClient: () => provider.client() });
    const view = await service.createSession("o", { scenarioId: "bank-alert", opponentMode: "live" });
    const { session } = await service.submitAction("o", view.sessionId, { actionId: randomUUID(), expectedVersion: view.version, action: { type: "send_message", text: "hi" } });
    expect(session.messages.at(-1)).toMatchObject({ text: "Please approve.", origin: "live_model" });
    expect(session.messages.some((m) => m.text.includes("TOOLCALL"))).toBe(false);
    expect(session.paymentRequests).toHaveLength(1);
  });

  it("plain text (no tools) becomes the single validated message", async () => {
    const provider = new FakeProvider().enqueue({ content: "We need you to act fast." });
    const service = new GameService({ store: new MemoryGameStore(), modelClient: () => provider.client() });
    const view = await service.createSession("o", { scenarioId: "bank-alert", opponentMode: "live" });
    const { session } = await service.submitAction("o", view.sessionId, { actionId: randomUUID(), expectedVersion: view.version, action: { type: "send_message", text: "hi" } });
    expect(session.messages.at(-1)).toMatchObject({ text: "We need you to act fast.", origin: "live_model" });
  });

  it("config requires all three server-only variables", () => {
    expect(readModelConfig({ MODEL_BASE_URL: "https://x/v1/", MODEL_API_KEY: "k", MODEL_ID: "m" })).toEqual({ baseUrl: "https://x/v1", apiKey: "k", modelId: "m" });
    expect(readModelConfig({ MODEL_BASE_URL: "https://x/v1", MODEL_ID: "m" })).toBeNull();
  });

  it("redaction masks codes, emails, and long tokens but keeps ordinary text", () => {
    expect(redactPlayerText("code 123456, mail a@b.co, token AbC123dEf456GhI789")).toBe("code [number removed], mail [email removed], token [token removed]");
    expect(redactPlayerText("I want 500 credits")).toBe("I want 500 credits");
  });
});

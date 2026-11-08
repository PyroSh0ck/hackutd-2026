import { OpenAICompatibleClient } from "@/server/game/opponent/client";

type ScriptedCall = { name: string; arguments: unknown; id?: string };
type ScriptedResponse = { toolCalls?: ScriptedCall[]; content?: string } | { httpStatus: number } | { hang: true } | { raw: string };

/**
 * Fake OpenAI-compatible endpoint behind the REAL client, so tests see the exact serialized
 * request bodies that would leave the server.
 */
export class FakeProvider {
  readonly bodies: string[] = [];
  private queue: ScriptedResponse[] = [];
  private counter = 0;

  enqueue(...responses: ScriptedResponse[]) {
    this.queue.push(...responses);
    return this;
  }

  client() {
    return new OpenAICompatibleClient(
      { baseUrl: "https://model.invalid/v1", apiKey: "test-key-not-real", modelId: "test/nemotron-fake" },
      async (_url, init) => {
        this.bodies.push(init.body);
        const next = this.queue.shift() ?? { content: "" };
        if ("hang" in next) {
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          });
        }
        if ("httpStatus" in next) return { ok: false, status: next.httpStatus, text: async () => "error" };
        if ("raw" in next) return { ok: true, status: 200, text: async () => next.raw };
        const tool_calls = (next.toolCalls ?? []).map((c) => ({
          id: c.id ?? `call_${++this.counter}`,
          type: "function",
          function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments) },
        }));
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ choices: [{ message: { role: "assistant", content: next.content ?? null, tool_calls }, finish_reason: tool_calls.length ? "tool_calls" : "stop" }] }),
        };
      },
    );
  }

  /** Parsed request bodies. */
  requests() {
    return this.bodies.map((b) => JSON.parse(b) as { messages: Array<{ role: string; content: string | null }>; tools: unknown[] });
  }
}

export const say = (text: string, id?: string) => ({ name: "sendSimulatedMessage", arguments: { text }, id });
export const ask = (amount: number, recipientId = "mrb-secure-holding", id?: string) => ({ name: "presentPaymentRequest", arguments: { recipientId, amount }, id });

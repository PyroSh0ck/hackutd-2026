import "server-only";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";
import { readModelConfig, type ModelConfig } from "@/server/game/opponent/client";

export const ACTOR_TIMEOUT_MS = 20_000;
export interface ActorModel extends StructuredModel {
  generate(request: StructuredRequest, signal?: AbortSignal): Promise<StructuredResult>;
}
type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "text">>;

/**
 * Nemotron reasoning off unless MODEL_THINKING=on, as the observer, planner and legacy opponent clients
 * already do. Measured live (nemotron-3.5-bolt-e4b, a captured real actor request replayed 8×): without it
 * 0/8 responses were JSON (prose plus fact ids, so most turns needed the repair call); with it 8/8.
 */
const thinkingOff = (modelId: string) => /nemotron/i.test(modelId) && process.env.MODEL_THINKING !== "on";

/** One native JSON structured response, no tools, SDK, implicit retries, streaming or prose extraction.
 * Compatible with existing MODEL_* settings; ACTOR_MODEL_ID optionally overrides MODEL_ID. */
export class ActorHttpModel implements ActorModel {
  readonly modelId: string;
  constructor(private readonly config: ModelConfig, private readonly fetchImpl: FetchLike = fetch) { this.modelId = config.modelId; }
  async generate(request: StructuredRequest, signal?: AbortSignal): Promise<StructuredResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.min(ACTOR_TIMEOUT_MS, request.timeoutMs));
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.modelId, messages: [{ role: "system", content: `${thinkingOff(this.modelId) ? "/no_think\n" : ""}${request.system}` }, { role: "user", content: request.user }],
          response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema } },
          stream: false, temperature: 0.4, max_tokens: 700 }),
      });
      if (!response.ok) return { ok: false, failure: "http_error", detail: "Actor provider HTTP failure." };
      const body = await response.text();
      if (controller.signal.aborted) return { ok: false, failure: "timeout", detail: "Actor call canceled or timed out." };
      let payload: { choices?: Array<{ finish_reason?: string; message?: { refusal?: unknown; content?: unknown; tool_calls?: unknown } }> };
      try { payload = JSON.parse(body); } catch { return { ok: false, failure: "malformed_output", detail: "Provider returned non-JSON." }; }
      const choice = payload?.choices?.[0];
      const message = choice?.message;
      if (message?.refusal || choice?.finish_reason === "content_filter") return { ok: false, failure: "refusal", detail: "Actor provider declined." };
      if (!message || message.tool_calls || typeof message.content !== "string") return { ok: false, failure: "malformed_output", detail: "Expected structured content without tool calls." };
      try { return { ok: true, output: JSON.parse(message.content) }; }
      catch { return { ok: false, failure: "malformed_output", detail: "Actor content was not strict JSON.", rawOutput: message.content.slice(0, 4000) }; }
    } catch {
      return { ok: false, failure: controller.signal.aborted ? "timeout" : "http_error", detail: "Actor provider call failed." };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
}
export function actorModelFromEnv(env: Record<string, string | undefined> = process.env): ActorHttpModel | null {
  const config = readModelConfig(env);
  return config ? new ActorHttpModel({ ...config, modelId: env.ACTOR_MODEL_ID?.trim() || config.modelId }) : null;
}

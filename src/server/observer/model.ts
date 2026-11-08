import { z } from "zod";
import { ReviewPolicySchema, type ModelFailure, type ReviewPolicy } from "@/contracts/observer";
import { readModelConfig, stripThinking, type ModelConfig } from "@/server/game/opponent/client";

/**
 * Structured-output model adapter for the observer and reviewer (brief §4.3, §8).
 *
 * Mechanism: provider-native function calling with a FORCED tool choice, whose `parameters` is the JSON
 * Schema generated from the runtime Zod schema. `json_schema` (response_format) is a configurable
 * alternative. Either way the runtime validator is authoritative: the provider's schema support is a
 * convenience, not a guarantee.
 *
 * Budget honesty: plain `fetch`, one HTTP request per `generate`, no SDK, no automatic retries. Every call
 * has a finite timeout. Transport failures are returned, never retried here.
 */

export type ModelStage = "observer" | "repair" | "reviewer";

export type StructuredRequest = {
  stage: ModelStage;
  schemaName: string;
  schemaDescription: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  user: string;
  timeoutMs: number;
};

export type StructuredResult =
  | { ok: true; output: unknown }
  /** `rawOutput` (bounded) is present for malformed output so the single repair can see what was returned. */
  | { ok: false; failure: ModelFailure; detail: string; rawOutput?: string };

export interface StructuredModel {
  readonly modelId: string;
  generate(request: StructuredRequest): Promise<StructuredResult>;
}

export type StructuredMode = "tool" | "json_schema";

export type ObserverModelConfig = {
  observer: ModelConfig | null;
  reviewer: ModelConfig | null;
  mode: StructuredMode;
  timeoutMs: number;
  reviewPolicy: ReviewPolicy;
};

const RAW_LIMIT = 2000;

/**
 * Server-only env. Reuses the provider settings (MODEL_BASE_URL/KEY/ID); OBSERVER_MODEL_ID and
 * OBSERVER_REVIEWER_MODEL_ID optionally select different models on the same provider. The review policy is
 * explicit configuration and is never changed silently.
 */
export function readObserverModelConfig(env: Record<string, string | undefined> = process.env): ObserverModelConfig {
  const base = readModelConfig(env);
  const observer = base ? { ...base, modelId: env.OBSERVER_MODEL_ID?.trim() || base.modelId } : null;
  const reviewer = observer ? { ...observer, modelId: env.OBSERVER_REVIEWER_MODEL_ID?.trim() || observer.modelId } : null;
  const timeout = Number(env.OBSERVER_TIMEOUT_MS);
  const policy = ReviewPolicySchema.safeParse(env.OBSERVER_REVIEW_POLICY?.trim() || "consequential_and_flagged");
  if (!policy.success) throw new Error(`OBSERVER_REVIEW_POLICY must be one of ${ReviewPolicySchema.options.join(", ")}.`);
  return {
    observer,
    reviewer,
    mode: env.OBSERVER_STRUCTURED_MODE === "json_schema" ? "json_schema" : "tool",
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 60_000 ? timeout : 15_000,
    reviewPolicy: policy.data,
  };
}

/** Provider-facing JSON Schema: strict, with the `$schema` meta key some providers reject removed. */
export function providerSchema(schema: z.ZodType): Record<string, unknown> {
  const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete json.$schema;
  return json;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Extracts one JSON object from prose: fenced block or the outermost braces. */
export function extractJsonObject(text: string): unknown | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export class OpenAICompatibleStructuredModel implements StructuredModel {
  readonly modelId: string;
  constructor(
    private readonly config: ModelConfig,
    private readonly options: { mode?: StructuredMode; fetchImpl?: FetchLike; onSerializedRequest?: (body: string) => void } = {},
  ) {
    this.modelId = config.modelId;
  }

  private body(request: StructuredRequest): string {
    const thinkingOff = /nemotron/i.test(this.modelId) && process.env.MODEL_THINKING !== "on";
    const messages = [
      { role: "system", content: `${thinkingOff ? "/no_think\n" : ""}${request.system}` },
      { role: "user", content: request.user },
    ];
    const common = { model: this.modelId, messages, temperature: 0, max_tokens: 1500 };
    if ((this.options.mode ?? "tool") === "json_schema") {
      return JSON.stringify({ ...common, response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema } } });
    }
    return JSON.stringify({
      ...common,
      tools: [{ type: "function", function: { name: request.schemaName, description: request.schemaDescription, parameters: request.jsonSchema } }],
      tool_choice: { type: "function", function: { name: request.schemaName } },
    });
  }

  async generate(request: StructuredRequest): Promise<StructuredResult> {
    const body = this.body(request);
    this.options.onSerializedRequest?.(body);
    const signal = AbortSignal.timeout(request.timeoutMs);
    const fetchImpl = this.options.fetchImpl ?? (fetch as unknown as FetchLike);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body,
        signal,
      });
    } catch (error) {
      if (signal.aborted) return { ok: false, failure: "timeout", detail: `No response within ${request.timeoutMs} ms.` };
      return { ok: false, failure: "unavailable", detail: `Request failed: ${error instanceof Error ? error.name : "network"}` };
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      return signal.aborted ? { ok: false, failure: "timeout", detail: `No response within ${request.timeoutMs} ms.` } : { ok: false, failure: "http_error", detail: "Body unreadable." };
    }
    if (!response.ok) {
      const unavailable = response.status === 401 || response.status === 403 || response.status === 404;
      return { ok: false, failure: unavailable ? "unavailable" : "http_error", detail: `HTTP ${response.status}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, failure: "http_error", detail: "Provider returned a non-JSON envelope." };
    }
    return parseCompletion(json, request.schemaName);
  }
}

/** Interprets one chat-completions envelope. Exported for tests. */
export function parseCompletion(json: unknown, schemaName: string): StructuredResult {
  type Choice = { message?: { content?: unknown; refusal?: unknown; tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }> }; finish_reason?: unknown };
  const choice = (json as { choices?: Choice[] })?.choices?.[0];
  if (!choice?.message) return { ok: false, failure: "http_error", detail: "Provider response had no message." };
  const { message } = choice;
  if ((typeof message.refusal === "string" && message.refusal.trim()) || choice.finish_reason === "content_filter") {
    return { ok: false, failure: "refusal", detail: "Provider declined to answer." };
  }
  const call = Array.isArray(message.tool_calls) ? message.tool_calls.find((c) => c?.function?.name === schemaName) : undefined;
  if (call) {
    const args = call.function?.arguments;
    if (args && typeof args === "object") return { ok: true, output: args };
    if (typeof args === "string") {
      try {
        return { ok: true, output: JSON.parse(args) };
      } catch {
        return { ok: false, failure: "malformed_output", detail: "Tool arguments were not valid JSON.", rawOutput: args.slice(0, RAW_LIMIT) };
      }
    }
  }
  const content = typeof message.content === "string" ? stripThinking(message.content) : "";
  const inline = /<TOOLCALL>([\s\S]*?)<\/TOOLCALL>/i.exec(content);
  if (inline) {
    try {
      const parsed = JSON.parse(inline[1]) as unknown;
      const first = (Array.isArray(parsed) ? parsed[0] : parsed) as { name?: unknown; arguments?: unknown; parameters?: unknown } | undefined;
      const args = first?.arguments ?? first?.parameters;
      if (first?.name === schemaName && args !== undefined) return { ok: true, output: typeof args === "string" ? JSON.parse(args) : args };
    } catch {
      /* fall through to malformed */
    }
  }
  const extracted = content ? extractJsonObject(content) : undefined;
  if (extracted !== undefined) return { ok: true, output: extracted };
  return { ok: false, failure: "malformed_output", detail: "No structured output was returned.", rawOutput: content.slice(0, RAW_LIMIT) };
}

/** Factory used by the runtime. Null when unconfigured: the observer then records an unclear fallback. */
export function structuredModels(config = readObserverModelConfig()): { observer: StructuredModel | null; reviewer: StructuredModel | null } {
  return {
    observer: config.observer ? new OpenAICompatibleStructuredModel(config.observer, { mode: config.mode }) : null,
    reviewer: config.reviewer ? new OpenAICompatibleStructuredModel(config.reviewer, { mode: config.mode }) : null,
  };
}

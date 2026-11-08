import { randomUUID } from "node:crypto";

/**
 * OpenAI-compatible chat-completions adapter (NVIDIA-hosted Nemotron exposes this shape). Model id,
 * base URL and key come from server-only env. Compatible HTTP shape is not proof of compatible tool
 * behavior: `pnpm game:smoke` verifies tool calls + tool-result continuation against the real endpoint.
 */

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools: unknown[];
  tool_choice: "auto";
  temperature: number;
  max_tokens: number;
};

export type ChatResult = { content: string | null; toolCalls: ToolCall[]; finishReason: string | null };

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "http" | "invalid_output" | "network",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ModelClient {
  readonly modelId: string;
  complete(request: Omit<ChatRequest, "model">, signal: AbortSignal): Promise<ChatResult>;
}

export type ModelConfig = { baseUrl: string; apiKey: string; modelId: string };

/** Reads server-only provider env. Returns null (scripted fallback) when unconfigured. */
export function readModelConfig(env: Record<string, string | undefined> = process.env): ModelConfig | null {
  const baseUrl = env.MODEL_BASE_URL?.trim();
  const apiKey = env.MODEL_API_KEY?.trim();
  const modelId = env.MODEL_ID?.trim();
  if (!baseUrl || !apiKey || !modelId) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, modelId };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export class OpenAICompatibleClient implements ModelClient {
  readonly modelId: string;
  constructor(
    private readonly config: ModelConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    /** Receives the exact serialized request body (tests assert the privacy boundary here). */
    private readonly onSerializedRequest?: (body: string) => void,
  ) {
    this.modelId = config.modelId;
  }

  async complete(request: Omit<ChatRequest, "model">, signal: AbortSignal): Promise<ChatResult> {
    const body = JSON.stringify({ model: this.config.modelId, ...request } satisfies ChatRequest);
    this.onSerializedRequest?.(body);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json" },
        body,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new ProviderError("Model request timed out.", "timeout");
      throw new ProviderError(`Model request failed: ${error instanceof Error ? error.name : "network"}`, "network");
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new ProviderError(`Model HTTP ${response.status}`, "http");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError("Model returned non-JSON.", "invalid_output");
    }
    const choice = (json as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }> }).choices?.[0];
    if (!choice?.message) throw new ProviderError("Model response had no message.", "invalid_output");
    const rawCalls = Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls : [];
    const toolCalls: ToolCall[] = [];
    for (const [index, raw] of rawCalls.entries()) {
      const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      if (typeof call.function?.name !== "string") continue;
      const args = call.function.arguments;
      toolCalls.push({
        id: typeof call.id === "string" && call.id ? call.id.slice(0, 80) : `call-${randomUUID().slice(0, 8)}-${index}`,
        type: "function",
        function: { name: call.function.name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
      });
    }
    let content = typeof choice.message.content === "string" ? stripThinking(choice.message.content) : null;
    if (toolCalls.length === 0 && content) {
      const inline = parseInlineToolCalls(content);
      if (inline) {
        toolCalls.push(...inline.calls);
        content = inline.rest || null;
      }
    }
    return { content, toolCalls, finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null };
  }
}

/** Removes reasoning blocks some models emit in content; they are never shown or logged. */
export function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * Some Nemotron deployments return tool calls inline as `<TOOLCALL>[{"name":..,"arguments":{..}}]</TOOLCALL>`
 * instead of `tool_calls`. Parse that format so it is validated like any tool call (never shown as text).
 * Unparseable tags yield no calls and are stripped from the content.
 */
export function parseInlineToolCalls(content: string): { calls: ToolCall[]; rest: string } | null {
  const match = content.match(/<TOOLCALL>([\s\S]*?)<\/TOOLCALL>/i);
  if (!match) return null;
  const rest = content.replace(/<TOOLCALL>[\s\S]*?<\/TOOLCALL>/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { calls: [], rest };
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const calls: ToolCall[] = [];
  list.forEach((item, index) => {
    const call = item as { name?: unknown; arguments?: unknown; parameters?: unknown };
    if (typeof call.name !== "string") return;
    const args = call.arguments ?? call.parameters ?? {};
    calls.push({ id: `inline-${randomUUID().slice(0, 8)}-${index}`, type: "function", function: { name: call.name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
  });
  return { calls, rest };
}

import "server-only";
import { readModelConfig, type ModelConfig } from "@/server/game/opponent/client";

/**
 * Multi-turn function calling over an OpenAI-compatible chat-completions endpoint (NVIDIA's
 * integrate.api.nvidia.com serves Nemotron this way). Unlike the structured adapter, the model chooses
 * which tool to call (tool_choice "auto"), the app executes it, and the result is returned in a `tool`
 * message carrying the provider's tool_call_id.
 */

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; arguments: string };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolTransport = "timeout" | "unavailable" | "refusal" | "http_error";
export type ToolChatResult =
  | { ok: true; content: string; toolCalls: ToolCall[]; protocol: "native" | "inline" }
  | { ok: false; failure: ToolTransport | "malformed_output"; detail: string };

export interface ToolChatModel {
  readonly modelId: string;
  chat(request: { messages: ChatMessage[]; tools: ToolSpec[]; timeoutMs: number; signal?: AbortSignal }): Promise<ToolChatResult>;
}

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

export class OpenAICompatibleToolModel implements ToolChatModel {
  readonly modelId: string;
  constructor(
    private readonly config: ModelConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.modelId = config.modelId;
  }

  async chat({ messages, tools, timeoutMs, signal }: { messages: ChatMessage[]; tools: ToolSpec[]; timeoutMs: number; signal?: AbortSignal }): Promise<ToolChatResult> {
    const thinkingOff = /nemotron/i.test(this.modelId) && process.env.MODEL_THINKING !== "on";
    const sent = thinkingOff ? messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: `/no_think\n${m.content}` } : m)) : messages;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.modelId,
          messages: sent,
          tools: tools.map((t) => ({ type: "function", function: t })),
          tool_choice: "auto",
          temperature: 0,
          max_tokens: 1500,
        }),
        signal: combined,
      });
    } catch (error) {
      if (timeout.aborted) return { ok: false, failure: "timeout", detail: `No response within ${timeoutMs} ms.` };
      return { ok: false, failure: "unavailable", detail: `Request failed: ${error instanceof Error ? error.name : "network"}` };
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) return { ok: false, failure: [401, 403, 404].includes(response.status) ? "unavailable" : "http_error", detail: `HTTP ${response.status}` };
    let json: { choices?: Array<{ message?: { content?: unknown; refusal?: unknown; tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }> }; finish_reason?: unknown }> };
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, failure: "http_error", detail: "Provider returned a non-JSON envelope." };
    }
    const choice = json.choices?.[0];
    const message = choice?.message;
    if (!message) return { ok: false, failure: "http_error", detail: "Provider response had no message." };
    if ((typeof message.refusal === "string" && message.refusal.trim()) || choice?.finish_reason === "content_filter") return { ok: false, failure: "refusal", detail: "Provider declined." };
    const content = typeof message.content === "string" ? stripThinking(message.content) : "";
    const native = (message.tool_calls ?? []).flatMap((c) =>
      typeof c?.function?.name === "string"
        ? [{ id: typeof c.id === "string" && c.id ? c.id : "", name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) }]
        : [],
    );
    if (native.length) return { ok: true, content, toolCalls: native, protocol: "native" };
    // Some Nemotron deployments emit <TOOLCALL>[{"name":…,"arguments":…}]</TOOLCALL> in content instead.
    const inline = /<TOOLCALL>([\s\S]*?)<\/TOOLCALL>/i.exec(content);
    if (inline) {
      try {
        const parsed = JSON.parse(inline[1]) as unknown;
        const list = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ name?: unknown; arguments?: unknown; parameters?: unknown }>;
        const calls = list.flatMap((c) => (typeof c?.name === "string" ? [{ id: "", name: c.name, arguments: JSON.stringify(c.arguments ?? c.parameters ?? {}) }] : []));
        if (calls.length) return { ok: true, content: "", toolCalls: calls, protocol: "inline" };
      } catch {
        return { ok: false, failure: "malformed_output", detail: "Inline tool call was not valid JSON." };
      }
    }
    return { ok: true, content, toolCalls: [], protocol: "native" };
  }
}

/**
 * The function-calling planner from env: PLANNER_PROTOCOL=tools enables it on the shared provider
 * (MODEL_BASE_URL / MODEL_API_KEY), using PLANNER_MODEL_ID or MODEL_ID. Null when not configured.
 */
export function toolPlannerFromEnv(env: Record<string, string | undefined> = process.env): ToolChatModel | null {
  if (env.PLANNER_PROTOCOL !== "tools") return null;
  const base = readModelConfig(env);
  if (!base) return null;
  return new OpenAICompatibleToolModel({ ...base, modelId: env.PLANNER_MODEL_ID || base.modelId });
}

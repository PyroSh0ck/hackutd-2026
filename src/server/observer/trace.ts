import type { TraceEntry } from "@/contracts/trace";
import type { StructuredModel, StructuredRequest, StructuredResult } from "./model";

/**
 * Opt-in agent trace for the developer lab (`/agent-lab`). In-process memory only (survives dev hot reloads
 * via globalThis, not restarts), capped per session. It records prompts and RAW model outputs, including
 * invalid drafts that the product never shows, so it is enabled only in development or with AGENT_DEBUG=1.
 * Prompts never contain credentials; owner access is checked by the route.
 */

export type TraceInput = Omit<TraceEntry, "seq" | "at" | "sessionId">;
export interface TraceSink {
  emit(sessionId: string, entry: TraceInput): void;
}

const MAX_PER_SESSION = 400;

export class MemoryTrace implements TraceSink {
  private readonly sessions = new Map<string, TraceEntry[]>();
  private seq = 0;
  emit(sessionId: string, entry: TraceInput) {
    const list = this.sessions.get(sessionId) ?? [];
    list.push(structuredClone({ ...entry, seq: this.seq++, at: new Date().toISOString(), sessionId }));
    if (list.length > MAX_PER_SESSION) list.splice(0, list.length - MAX_PER_SESSION);
    this.sessions.set(sessionId, list);
  }
  entries(sessionId: string): TraceEntry[] {
    return structuredClone(this.sessions.get(sessionId) ?? []);
  }
}

export const traceEnabled = () => process.env.AGENT_DEBUG === "1" || process.env.NODE_ENV === "development";

const holder = globalThis as unknown as { __agentTrace?: MemoryTrace };
export const sharedTrace = () => (holder.__agentTrace ??= new MemoryTrace());

/** "PREFIX (…):\n{json}" → the JSON payload (or the raw text if it is not JSON). */
function payloadOf(user: string): unknown {
  try {
    return JSON.parse(user.slice(user.indexOf("\n") + 1));
  } catch {
    return user;
  }
}

const AGENT: Record<StructuredRequest["stage"], TraceInput["agent"]> = {
  observer: "observer",
  repair: "observer",
  reviewer: "reviewer",
  planner: "planner",
  planner_repair: "planner",
  actor: "actor",
  actor_repair: "actor",
};

/** Wraps a model so every call (prompt + raw result + latency) is traced. Behavior is unchanged. */
export class TracingModel implements StructuredModel {
  constructor(
    private readonly inner: StructuredModel,
    private readonly sink: TraceSink,
    private readonly sessionId: string,
    private readonly inputId: string,
  ) {}
  get modelId() {
    return this.inner.modelId;
  }
  /** Tracing must never change behavior: sink errors are swallowed. */
  private safeEmit(entry: TraceInput) {
    try {
      this.sink.emit(this.sessionId, entry);
    } catch {
      /* ignore */
    }
  }

  /** `signal` is forwarded to adapters that accept it (actor v2 cancellation). */
  async generate(request: StructuredRequest, signal?: AbortSignal): Promise<StructuredResult> {
    const started = performance.now();
    let result: StructuredResult;
    try {
      result = await (this.inner.generate as (r: StructuredRequest, s?: AbortSignal) => Promise<StructuredResult>).call(this.inner, request, signal);
    } catch (error) {
      this.safeEmit({ inputId: this.inputId, step: "model.call", agent: AGENT[request.stage], title: `${request.stage} call threw`, status: "fail", data: { stage: request.stage, modelId: this.modelId, error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
    this.safeEmit({
      inputId: this.inputId,
      step: "model.call",
      agent: AGENT[request.stage],
      title: `${request.stage} → ${this.modelId}`,
      status: result.ok ? "ok" : "fail",
      data: {
        stage: request.stage,
        modelId: this.modelId,
        schemaName: request.schemaName,
        latencyMs: Math.round(performance.now() - started),
        systemPrompt: request.system,
        input: payloadOf(request.user),
        rawOutput: result.ok ? result.output : { failure: result.failure, detail: result.detail, rawOutput: result.rawOutput ?? null },
      },
    });
    return result;
  }
}

export const traced = (model: StructuredModel | null, sink: TraceSink | undefined, sessionId: string, inputId: string) => (model && sink ? new TracingModel(model, sink, sessionId, inputId) : model);

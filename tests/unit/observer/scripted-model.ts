import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";

type Step = StructuredResult | ((request: StructuredRequest) => StructuredResult | Promise<StructuredResult>);

/** Test double: returns queued results in order and records every request. Throws if over-called. */
export class ScriptedModel implements StructuredModel {
  readonly requests: StructuredRequest[] = [];
  private readonly steps: Step[];
  constructor(
    readonly modelId: string,
    ...steps: Step[]
  ) {
    this.steps = steps;
  }
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (!step) throw new Error(`${this.modelId}: unexpected extra call (${request.stage})`);
    return typeof step === "function" ? step(request) : step;
  }
  get remaining() {
    return this.steps.length;
  }
}

export const ok = (output: unknown): StructuredResult => ({ ok: true, output });
export const fail = (failure: Exclude<StructuredResult, { ok: true }>["failure"], rawOutput?: string): StructuredResult => ({ ok: false, failure, detail: failure, rawOutput });

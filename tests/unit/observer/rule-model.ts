import type { ObserverAssessment } from "@/contracts/observer";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";

export type PromptView = {
  stage: StructuredRequest["stage"];
  scope: "conversation" | "request";
  requestId: string | null;
  targetAction: string | null;
  currentMessageId: string;
  current: string;
  proposed?: ObserverAssessment;
};

/** Parses the real prompt payload (so tests exercise prompt assembly) and answers via a rule. */
export function parsePrompt(request: StructuredRequest): PromptView {
  const payload = JSON.parse(request.user.slice(request.user.indexOf("\n") + 1));
  const base = request.stage === "repair" ? payload.originalInput : payload;
  const messages = base.conversationUntrustedData as Array<{ id: string; content: string }>;
  return {
    stage: request.stage,
    scope: base.scope,
    requestId: base.request?.id ?? null,
    targetAction: base.request?.targetAction ?? null,
    currentMessageId: base.currentMessageId,
    current: messages.find((m) => m.id === base.currentMessageId)!.content,
    proposed: payload.proposedAssessment,
  };
}

export class RuleModel implements StructuredModel {
  readonly seen: PromptView[] = [];
  gate: Promise<void> | null = null;
  constructor(
    readonly modelId: string,
    private readonly rule: (view: PromptView) => StructuredResult,
  ) {}
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    const view = parsePrompt(request);
    this.seen.push(view);
    if (this.gate) await this.gate;
    return this.rule(view);
  }
}

export function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

/** Builds an assessment for a prompt view quoting the whole current message. */
export function answer(view: PromptView, label: ObserverAssessment["decision"]["label"], extra: Partial<ObserverAssessment> = {}): StructuredResult {
  // Conversation scope has no stance (addendum §3).
  if (view.scope === "conversation") label = "unclear";
  const evidence = label === "unclear" ? [] : [{ messageId: view.currentMessageId, quote: view.current }];
  return {
    ok: true,
    output: {
      requestId: view.requestId,
      currentMessageId: view.currentMessageId,
      decision: { label, evidence },
      condition: null,
      verificationObservations: [],
      statedUnderstanding: null,
      ambiguities: [],
      openIssues: [],
      issueAcknowledgments: [],
      ...extra,
    },
  };
}

/** A reviewer that supports any proposal, citing the current message for the decision. */
export const supportingReviewer = () =>
  new RuleModel("reviewer", (v) => ({
    ok: true,
    output: { verdict: "supported", findings: [{ field: "decision.label", verdict: "supported", explanation: "Supported by the reply.", evidence: [{ messageId: v.currentMessageId, quote: v.current }] }], correctedAssessment: null },
  }));

import type { StructuredModel, StructuredRequest, StructuredResult } from "../model";

/**
 * TEST-ONLY deterministic model for HTTP/E2E plumbing tests (selected only when E2E_TEST=1 AND
 * OBSERVER_MODEL_MODE=fixture). It answers a fixed table of utterances. It proves wiring, not semantic
 * quality; real-model behavior is measured by `pnpm observer:eval`.
 */

type View = { stage: StructuredRequest["stage"]; requestId: string; target: string; messageId: string; text: string; proposed?: { decision: { label: string } } };

function view(request: StructuredRequest): View {
  const payload = JSON.parse(request.user.slice(request.user.indexOf("\n") + 1));
  const base = request.stage === "repair" ? payload.originalInput : payload;
  const current = (base.conversationUntrustedData as Array<{ id: string; content: string }>).find((m) => m.id === base.currentMessageId)!;
  return { stage: request.stage, requestId: base.request.id, target: base.request.targetAction, messageId: current.id, text: current.content, proposed: payload.proposedAssessment };
}

const ev = (v: View, quote = v.text) => [{ messageId: v.messageId, quote }];
function assessment(v: View, label: string, extra: Record<string, unknown> = {}): StructuredResult {
  return {
    ok: true,
    output: { requestId: v.requestId, currentMessageId: v.messageId, decision: { label, evidence: label === "unclear" ? [] : ev(v) }, condition: null, verificationObservations: [], statedUnderstanding: null, ambiguities: [], ...extra },
  };
}

function observe(v: View): StructuredResult {
  const code = v.target === "share_fictional_code";
  switch (v.text) {
    case "I won't send the code.":
      return assessment(v, code ? "refused" : "unclear");
    case "Yes, I'll send the code.":
    case "I won't refuse to send the code.":
      return assessment(v, code ? "explicit_acceptance" : "unclear");
    case "Only after I contact official support myself.":
      return code
        ? assessment(v, "conditional_acceptance", {
            condition: { description: "Contacts official support independently first", evidence: ev(v, "Only after I contact official support myself.") },
            verificationObservations: [{ behavior: "expressed_verification_intent", channelProvenance: "user_claimed_independent", channelDescription: "official support, contacted by the user", evidence: ev(v, "contact official support myself") }],
          })
        : assessment(v, "unclear");
    case "I'll call the number you just sent.":
      return assessment(v, "unclear", { verificationObservations: [{ behavior: "expressed_verification_intent", channelProvenance: "sender_supplied", channelDescription: "number supplied by the sender", evidence: ev(v) }] });
    case "If I sent it, would that help?":
      // Deliberately wrong first interpretation, so the flagged-correction path can be demonstrated.
      return assessment(v, code ? "explicit_acceptance" : "unclear");
    case "Hmm, let me think about whether to do it.":
      return v.stage === "observer" ? { ok: false, failure: "malformed_output", detail: "fixture malformed", rawOutput: "{\"decision\":" } : assessment(v, "considering", { decision: { label: "considering", evidence: ev(v, "let me think about whether to do it") } });
    default:
      return assessment(v, "unclear");
  }
}

function review(v: View): StructuredResult {
  if (v.text === "If I sent it, would that help?" && v.proposed?.decision.label === "explicit_acceptance") {
    return {
      ok: true,
      output: {
        verdict: "contradicted",
        findings: [{ field: "decision.label", verdict: "contradicted", explanation: "A hypothetical question, not stated willingness.", evidence: ev(v) }],
        correctedAssessment: { requestId: v.requestId, currentMessageId: v.messageId, decision: { label: "unclear", evidence: ev(v) }, condition: null, verificationObservations: [], statedUnderstanding: null, ambiguities: [{ field: "decision", description: "Hypothetical question; willingness not established.", evidence: [] }] },
      },
    };
  }
  return { ok: true, output: { verdict: "supported", findings: [{ field: "decision.label", verdict: "supported", explanation: "The reply's own words support the label.", evidence: ev(v) }], correctedAssessment: null } };
}

export class FixtureStructuredModel implements StructuredModel {
  constructor(readonly modelId: string) {}
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    const v = view(request);
    return v.stage === "reviewer" ? review(v) : observe(v);
  }
}

import type { StructuredModel, StructuredRequest, StructuredResult } from "../model";

/**
 * TEST-ONLY deterministic model for HTTP/E2E plumbing tests (selected only when E2E_TEST=1 AND
 * OBSERVER_MODEL_MODE=fixture). It answers a fixed table of utterances. It proves wiring, not semantic
 * quality; real-model behavior is measured by `pnpm observer:eval`.
 */

type KnownIssue = { id: string; kind: string; status: string };
type View = {
  stage: StructuredRequest["stage"];
  scope: "conversation" | "request";
  requestId: string | null;
  target: string | null;
  messageId: string;
  text: string;
  knownIssues: KnownIssue[];
  proposed?: { decision: { label: string } };
};

function view(request: StructuredRequest): View {
  const payload = JSON.parse(request.user.slice(request.user.indexOf("\n") + 1));
  const base = request.stage === "repair" ? payload.originalInput : payload;
  const current = (base.conversationUntrustedData as Array<{ id: string; content: string }>).find((m) => m.id === base.currentMessageId)!;
  return {
    stage: request.stage,
    scope: base.scope ?? (base.request ? "request" : "conversation"),
    requestId: base.request?.id ?? null,
    target: base.request?.targetAction ?? null,
    messageId: current.id,
    text: current.content,
    knownIssues: base.knownIssues ?? [],
    proposed: payload.proposedAssessment,
  };
}

const ev = (v: View, quote = v.text) => [{ messageId: v.messageId, quote }];
function assessment(v: View, label: string, extra: Record<string, unknown> = {}): StructuredResult {
  // Conversation scope: no stance, no condition (addendum §3).
  const scoped = v.scope === "conversation" ? { decision: { label: "unclear", evidence: [] }, condition: null } : {};
  return {
    ok: true,
    output: {
      requestId: v.requestId,
      currentMessageId: v.messageId,
      decision: { label, evidence: label === "unclear" ? [] : ev(v) },
      condition: null,
      verificationObservations: [],
      statedUnderstanding: null,
      ambiguities: [],
      openIssues: [],
      issueAcknowledgments: [],
      ...extra,
      ...scoped,
    },
  };
}
const issue = (v: View, kind: string, summary: string) => ({ openIssues: [{ kind, summary, evidence: ev(v) }] });
const observation = (v: View, behavior: string, channelProvenance: string, claimedResult = "unspecified", channelDescription: string | null = null) => ({
  verificationObservations: [{ behavior, channelProvenance, channelDescription, claimedResult, evidence: ev(v) }],
});

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
            condition: { kind: "independent_verification", description: "Contacts official support independently first", evidence: ev(v, "Only after I contact official support myself.") },
            ...observation(v, "expressed_verification_intent", "user_claimed_independent", "unspecified", "official support, contacted by the user"),
          })
        : assessment(v, "unclear");
    case "I'll send it if you prove you're from Cedar.":
      return code
        ? assessment(v, "conditional_acceptance", {
            condition: { kind: "sender_proof", description: "The sender proves they are from Cedar", evidence: ev(v) },
            ...observation(v, "requested_sender_proof", "unspecified"),
          })
        : assessment(v, "unclear");
    case "I'll call the number you just sent.":
      return assessment(v, "unclear", observation(v, "expressed_verification_intent", "sender_supplied", "unspecified", "number supplied by the sender"));
    case "If I sent it, would that help?":
      // Deliberately wrong first interpretation, so the flagged-correction path can be demonstrated.
      return assessment(v, code ? "explicit_acceptance" : "unclear");
    case "Hmm, let me think about whether to do it.":
      return v.stage === "observer"
        ? { ok: false, failure: "malformed_output", detail: "fixture malformed", rawOutput: '{"decision":' }
        : assessment(v, "considering", { decision: { label: "considering", evidence: ev(v, "let me think about whether to do it") } });
    case "Okay.":
      return assessment(v, "unclear", v.scope === "request" ? { ambiguities: [{ field: "decision", description: "Okay may acknowledge the message rather than agree.", evidence: ev(v) }] } : {});
    case "Who are you?":
      return assessment(v, "unclear", issue(v, "identity_question", "Asks who the sender is."));
    case "This is a scam, you're not from Cedar.":
      return assessment(v, "unclear", issue(v, "identity_question", "Doubts that the sender is from Cedar."));
    case "Where do I check independently?":
      return assessment(v, "unclear", issue(v, "procedure_question", "Asks where to verify independently."));
    case "What security check?":
      return assessment(v, "unclear", issue(v, "scenario_fact_question", "Asks what the security check is."));
    case "I'll do it if that happens.":
      return assessment(v, "unclear", issue(v, "condition_needs_clarification", "The condition's referent is unclear."));
    case "That answers my question about where to verify.": {
      const addressed = v.knownIssues.find((i) => i.kind === "procedure_question" && i.status === "addressed");
      return assessment(v, "unclear", addressed ? { issueAcknowledgments: [{ issueId: addressed.id, evidence: ev(v) }] } : {});
    }
    case "I checked with support and they said this request isn't theirs.":
      return assessment(v, "unclear", observation(v, "claimed_verification_completed", "user_claimed_independent", "contradicts_request", "support, contacted by the user"));
    case "I already checked.":
      return assessment(v, "unclear", observation(v, "claimed_verification_completed", "unspecified"));
    case "I'll check with Cedar myself first.":
      return assessment(v, "unclear", observation(v, "expressed_verification_intent", "user_claimed_independent", "unspecified", "Cedar, contacted by the user"));
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
        correctedAssessment: {
          requestId: v.requestId,
          currentMessageId: v.messageId,
          decision: { label: "unclear", evidence: ev(v) },
          condition: null,
          verificationObservations: [],
          statedUnderstanding: null,
          ambiguities: [{ field: "decision", description: "Hypothetical question; willingness not established.", evidence: [] }],
          openIssues: [],
          issueAcknowledgments: [],
        },
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

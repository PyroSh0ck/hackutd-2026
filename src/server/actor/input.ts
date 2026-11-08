import type { ActorInstruction } from "@/contracts/planner";
import { ActorInstructionSchema } from "@/contracts/planner";
import type { Snapshot } from "@/server/observer/store/types";
import { requestStatusOf } from "@/server/observer/state";
import { scenarioById } from "@/server/planner/scenario";
import { ActorInputSchema, type ActorInput } from "./schemas";
import { buildStyleProfile } from "./style";

export const redactText = (text: string, secrets: readonly string[]) => secrets.filter(Boolean).sort((a, b) => b.length - a.length).reduce((copy, secret) => copy.split(secret).join("[practice code redacted]"), text);
export function redactModelData(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((x) => redactModelData(x, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactText(k, secrets), redactModelData(v, secrets)]));
  return value;
}

/** Controller-only local adapter. Instruction MUST already be reconstructed from a validated plan and
 * immutable candidate, not model prose. The controller resolves non-message evidence refs to message IDs.
 * Controls/labels come from its UI registry (there is no shared UI registry in this checkout). */
export type ActorAssemblyInput = {
  snapshot: Snapshot;
  instruction: ActorInstruction;
  currentUserMessageId: string | null;
  evidenceMessageIds: readonly string[];
  controls: ActorInput["controls"];
  creatingRequest?: boolean;
  knownSecrets?: readonly string[];
};

export function buildActorInput(args: ActorAssemblyInput): ActorInput {
  const { snapshot: s } = args;
  const instruction = ActorInstructionSchema.parse(args.instruction);
  if (s.session.stage !== "active" || s.session.ended || instruction.basedOnRevision !== s.session.revision) throw new Error("Actor input requires an active, current session.");
  const scenario = scenarioById(s.session.scenarioId, s.session.scenarioVersion);
  if (!scenario || (scenario.id !== "mobile-code-01" && scenario.id !== "mobile-notice-01")) throw new Error("Unsupported actor scenario.");
  const secrets = [s.session.practiceCode ?? "", ...(args.knownSecrets ?? [])];
  const factIds = new Set(instruction.facts.map((f) => f.id));
  const additionIds = new Set(instruction.additions.map((a) => a.id));
  if (factIds.size !== instruction.facts.length || additionIds.size !== instruction.additions.length || [...factIds].some((id) => !instruction.constraints.allowedFactIds.includes(id)) || [...additionIds].some((id) => !instruction.constraints.allowedAdditionIds.includes(id))) throw new Error("Instruction references exceed binding constraints.");
  instruction.facts = instruction.facts.map((f) => {
    const fact = scenario.facts.find((x) => x.id === f.id);
    if (!fact) throw new Error("Unknown selected fact.");
    return { ...fact };
  });
  instruction.additions = instruction.additions.map((a) => {
    const reserved = s.additions.find((x) => x.id === a.id);
    if (!reserved) throw new Error("Missing reserved addition.");
    if (secrets.some((secret) => secret && reserved.text.includes(secret))) throw new Error("Reserved addition overlaps a known secret.");
    return { id: reserved.id, text: reserved.text, introduced: reserved.introducedMessageId !== null };
  });
  const required = new Set(args.evidenceMessageIds);
  if (args.currentUserMessageId) required.add(args.currentUserMessageId);
  if (instruction.target.issueId) {
    const issue = s.issues.find((i) => i.id === instruction.target.issueId);
    if (!issue || issue.status !== "open") throw new Error("Selected issue is no longer open.");
    for (const evidence of issue.evidence) required.add(evidence.messageId);
  }
  const committed = s.plans.filter((p) => p.status === "committed" && p.committedMessageId && p.actorOutput && p.actorModelId);
  const boundPlan = s.plans.find((p) => p.id === instruction.planId);
  for (const ref of [...(boundPlan?.acceptedPlan?.evidenceRefs ?? []), ...(boundPlan?.candidateSnapshot.find((c) => c.id === boundPlan.acceptedPlan?.candidateId)?.evidenceRefs ?? [])]) {
    if (ref.kind === "message") required.add(ref.id);
  }
  const ordered = [...s.messages].sort((a, b) => a.revision - b.revision);
  if (new Set(ordered.map((m) => m.id)).size !== ordered.length || new Set(ordered.map((m) => m.revision)).size !== ordered.length) throw new Error("Ambiguous message sequence.");
  if ([...required].some((id) => !ordered.some((m) => m.id === id))) throw new Error("Required evidence message is missing.");
  for (const message of ordered.slice(-6)) required.add(message.id);
  if (required.size > 12) throw new Error("Required context exceeds 12 messages.");
  const messageView = (m: Snapshot["messages"][number]) => {
    if (m.sessionId !== s.session.id || m.content.length > 4000) throw new Error("Invalid message boundary.");
    return { id: m.id, role: m.role, text: m.content, turn: m.turn };
  };
  const contextMessages = ordered.filter((m) => required.has(m.id)).map(messageView);
  const committedIds = new Set(committed.map((p) => p.committedMessageId));
  const recentActorMessages = ordered.filter((m) => m.role === "assistant" && committedIds.has(m.id)).slice(-3).map(messageView);
  const { request, status } = requestStatusOf(s);
  if (instruction.target.requestId && instruction.target.requestId !== request?.id) throw new Error("Target request is missing or superseded.");
  const visibleRequest = request && (status === "pending" || status === "rejected") ? { id: request.id, description: request.description, status } : null;
  const mayCreate = args.creatingRequest === true && instruction.toolIntent === "present_practice_code_request" && instruction.action === "present_simulated_request";
  if (args.creatingRequest && !mayCreate) throw new Error("Request creation is not authorized.");
  if (args.controls.some((c) => c.id === "share_practice_code") && visibleRequest?.status !== "pending" && !mayCreate) throw new Error("Share control requires a pending or authorized new request.");
  return ActorInputSchema.parse(redactModelData({
    schemaVersion: "actor-v2", instruction, styleProfile: buildStyleProfile(instruction),
    persona: { scenarioId: scenario.id as "mobile-code-01" | "mobile-notice-01", senderName: "Avery", organization: "Cedar Account Support", voice: "plain_professional" },
    currentUserMessageId: args.currentUserMessageId, contextMessages, recentActorMessages, visibleRequest,
    controls: args.controls.map(({ id, label }) => ({ id, label })),
  }, secrets));
}

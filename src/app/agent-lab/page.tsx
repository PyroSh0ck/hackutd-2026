import { AgentLab } from "@/features/agent-lab/agent-lab";

/** Developer tool: chat with the opponent and inspect every agent step. Trace API is dev / AGENT_DEBUG=1 only. */
export default function AgentLabPage() {
  return <AgentLab />;
}

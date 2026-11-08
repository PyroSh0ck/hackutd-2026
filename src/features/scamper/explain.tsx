"use client";

import { useState } from "react";
import { ExplainResponseSchema, type ExplainResponse } from "@/contracts/explain";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { InlineError } from "./ui";
import s from "./scamper.module.css";

const BACKEND_LABEL = { spacetime: "SpacetimeDB module (authoritative)", postgres: "Postgres", memory: "In-memory (test)" } as const;

/**
 * "How this session worked": loaded on demand for an ended session. Shows what actually ran (models,
 * observer decisions, planner protocol and tool calls, committed ids, revision, outcome); never reasoning.
 */
export function HowItWorked({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: ExplainResponse }>({ kind: "idle" });
  const load = () => {
    setState({ kind: "loading" });
    apiRequest(`/api/observer/sessions/${sessionId}/explain`, ExplainResponseSchema).then(
      (data) => setState({ kind: "ready", data }),
      (e) => setState({ kind: "error", message: errorMessage(e, "The technical summary could not be loaded.") }),
    );
  };
  return (
    <details
      className={s.transcript}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && state.kind === "idle") load();
      }}
    >
      <summary>How this session worked</summary>
      {state.kind === "loading" && <p className={s.muted} role="status">Loading…</p>}
      {state.kind === "error" && <InlineError message={state.message} onRetry={load} />}
      {state.kind === "ready" && (
        <div className={s.stack}>
          <dl className={s.facts}>
            <dt>Training state</dt>
            <dd>{BACKEND_LABEL[state.data.backend]}</dd>
            <dt>Final revision</dt>
            <dd>{state.data.revision}</dd>
            <dt>Outcome</dt>
            <dd>{state.data.outcome ? `${state.data.outcome.replaceAll("_", " ")} (decided by the training rules)` : "none"}</dd>
          </dl>
          <ol className={s.list}>
            {state.data.turns.map((t, n) => (
              <li key={t.inputId} className={s.evidence}>
                <strong>
                  Turn {n + 1} · {t.inputKind === "message" ? "your message" : "your action"}
                </strong>
                {t.observer && (
                  <span className={s.small}>
                    Observer ({t.observer.model}): <b>{t.observer.decision.replaceAll("_", " ")}</b> · {t.observer.evidenceCount} quoted evidence · {t.observer.resolution} · review {t.observer.reviewStatus}
                  </span>
                )}
                {t.planner && (
                  <span className={s.small}>
                    Planner ({t.planner.model}, {t.planner.protocol === "tools" ? "tool calling" : "structured plan"}): {t.planner.move ?? "no move"} · {t.planner.status}
                    {t.planner.failureReason ? ` (${t.planner.failureReason})` : ""}
                  </span>
                )}
                {t.planner?.toolCalls.map((c) => (
                  <span key={c.callId + c.name} className={`${s.small} ${s.muted}`}>
                    Tool <code>{c.name}</code> → {c.status === "executing" ? (t.planner!.status === "committed" ? "committed" : t.planner!.status) : c.status} · call {c.callId.slice(0, 18)}
                  </span>
                ))}
                {t.planner?.committedMessageId && (
                  <span className={`${s.small} ${s.muted}`}>
                    Committed message {t.planner.committedMessageId.slice(0, 8)}
                    {t.planner.requestIds.length ? ` · request ${t.planner.requestIds.map((r) => r.slice(0, 8)).join(", ")}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </details>
  );
}

"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ObserverSessionResponseSchema, type ClientEventType, type ObserverSessionView } from "@/contracts/observer";
import { TraceResponseSchema, type TraceEntry } from "@/contracts/trace";
import { apiRequest, errorMessage } from "@/lib/api-client";
import s from "./agent-lab.module.css";

/**
 * Agent lab: a mini messaging app (left) and, for the selected input, every agent step (right): observer
 * input, each raw model call (prompt sent + raw output), observer output, planner eligibility, planner
 * input, plan/actor record, and the commit result. Developer tool; separate from the product UI.
 */

const STORAGE_KEY = "scamper.agent-lab.sessionId";

const remember = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* convenience only */
  }
};
const recall = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

function Json({ value }: { value: unknown }) {
  return <pre className={s.json}>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

function Step({ entry, open }: { entry: TraceEntry; open: boolean }) {
  const d = entry.data as Record<string, unknown>;
  return (
    <details className={s.step} data-status={entry.status} open={open}>
      <summary className={s.summary}>
        <span className={s.agent}>{entry.agent}</span>
        <span>{entry.title}</span>
      </summary>
      <div className={s.body}>
        {entry.step === "model.call" ? (
          <>
            <h4>
              Raw model output ({String(d.latencyMs)} ms, schema {String(d.schemaName)})
            </h4>
            <Json value={d.rawOutput} />
            <h4>Input sent to the model</h4>
            <Json value={d.input} />
            <details>
              <summary className={s.small}>System prompt</summary>
              <Json value={d.systemPrompt} />
            </details>
          </>
        ) : (
          <Json value={entry.data} />
        )}
      </div>
    </details>
  );
}

export function AgentLab() {
  const [view, setView] = useState<ObserverSessionView>();
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [traceError, setTraceError] = useState<string>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const loadTrace = useCallback(async (sessionId: string) => {
    try {
      const r = await apiRequest(`/api/observer/sessions/${sessionId}/trace`, TraceResponseSchema);
      setTrace(r.entries);
      setTraceError(undefined);
    } catch (e) {
      setTraceError(`${errorMessage(e, "Trace unavailable.")} The trace API runs only under \`pnpm dev\` or with AGENT_DEBUG=1.`);
    }
  }, []);

  const create = useCallback(async () => {
    const { session } = await apiRequest("/api/observer/sessions", ObserverSessionResponseSchema, { method: "POST" });
    remember(session.sessionId);
    return session;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = recall();
      let session = stored ? await apiRequest(`/api/observer/sessions/${stored}`, ObserverSessionResponseSchema).then((r) => r.session, () => undefined) : undefined;
      session ??= await create();
      if (!alive) return;
      setView(session);
      await loadTrace(session.sessionId);
    })().catch((e) => alive && setError(errorMessage(e, "Could not start.")));
    return () => {
      alive = false;
    };
  }, [create, loadTrace]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [view?.messages.length, busy]);

  async function run(work: () => Promise<ObserverSessionView | undefined>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await work();
      if (next) {
        setView(next);
        await loadTrace(next.sessionId);
        setSelected(null); // follow the latest input
      }
    } catch (e) {
      setError(errorMessage(e, "That did not work."));
      if (view) await loadTrace(view.sessionId);
    } finally {
      setBusy(false);
    }
  }

  const send = () => {
    const text = draft.trim();
    if (!text || !view) return;
    setDraft("");
    void run(async () => (await apiRequest(`/api/observer/sessions/${view.sessionId}/messages`, ObserverSessionResponseSchema, { method: "POST", body: { idempotencyKey: crypto.randomUUID(), content: text } })).session);
  };
  const event = (type: ClientEventType, extra: Record<string, string | null> = {}) =>
    view && run(async () => (await apiRequest(`/api/observer/sessions/${view.sessionId}/events`, ObserverSessionResponseSchema, { method: "POST", body: { idempotencyKey: crypto.randomUUID(), type, requestId: null, ...extra } })).session);
  const retry = () => view && run(async () => (await apiRequest(`/api/observer/sessions/${view.sessionId}/retry`, ObserverSessionResponseSchema, { method: "POST", body: { idempotencyKey: crypto.randomUUID() } })).session);
  const reset = () =>
    run(async () => {
      remember(null);
      setTrace([]);
      return create();
    });

  /** Inputs in trace order (user messages and UI events), each with its steps. */
  const groups = useMemo(() => {
    const byInput = new Map<string, TraceEntry[]>();
    for (const e of trace) {
      if (!e.inputId) continue;
      byInput.set(e.inputId, [...(byInput.get(e.inputId) ?? []), e]);
    }
    return [...byInput.entries()].map(([id, entries]) => ({ id, entries: [...entries].sort((a, b) => a.seq - b.seq) }));
  }, [trace]);
  const active = groups.find((g) => g.id === selected) ?? groups.at(-1);
  const labelOf = (id: string) => {
    const m = view?.messages.find((x) => x.id === id);
    if (m) return `“${m.content.slice(0, 40)}${m.content.length > 40 ? "…" : ""}”`;
    const received = groups.find((g) => g.id === id)?.entries.find((e) => e.step === "input.received");
    return received?.title ?? id.slice(0, 8);
  };

  if (!view) return <main className={s.lab}>{error ?? "Starting…"}</main>;
  const request = view.requests.at(-1);
  const paused = view.ended || view.stage !== "active" || view.stopConfirmationPending;

  return (
    <main className={s.lab}>
      <section className={s.phone} aria-label="Conversation">
        <header className={s.phoneHeader}>
          <div className={s.contact}>
            <strong>Avery · {view.scenario.senderName}</strong>
            <span className={s.small}>
              Fictional simulation · {view.stage}
              {view.outcome ? ` · ${view.outcome}` : ""} · turn {view.turn}/{view.maxTurns}
            </span>
          </div>
          <button type="button" className={`${s.btn} ${s.ghost}`} onClick={() => void reset()} disabled={busy}>
            New chat
          </button>
        </header>
        <div className={s.thread} ref={thread} role="log" aria-label="Chat thread">
          {view.messages.map((m) =>
            m.role === "assistant" ? (
              <div key={m.id} className={`${s.bubble} ${s.them}`}>
                {m.content}
              </div>
            ) : (
              <button key={m.id} type="button" className={`${s.bubble} ${s.me}`} data-selected={active?.id === m.id} onClick={() => setSelected(m.id)} title="Show this message's agent trace">
                {m.content}
              </button>
            ),
          )}
          {busy && <div className={s.system}>agents working…</div>}
          {request && view.requestStatus === "pending" && view.stage !== "ended" && (
            <div className={s.card}>
              <span>
                Request card · fictional code <strong>{view.practiceCode}</strong>
              </span>
              <button type="button" className={s.btn} disabled={busy} onClick={() => void event("practice_code_submitted", { requestId: request.id, practiceCode: view.practiceCode })}>
                Share
              </button>
              <button type="button" className={`${s.btn} ${s.ghost}`} disabled={busy || view.stage === "verifying"} onClick={() => void event("request_rejected", { requestId: request.id })}>
                Decline
              </button>
            </div>
          )}
          {view.stopConfirmationPending && !view.ended && (
            <div className={s.card}>
              <span>End the practice?</span>
              <button type="button" className={s.btn} onClick={() => void event("conversation_ended")} disabled={busy}>
                End
              </button>
              <button type="button" className={`${s.btn} ${s.ghost}`} onClick={() => void event("stop_confirmation_dismissed")} disabled={busy}>
                Keep going
              </button>
            </div>
          )}
          {view.technicalNotice && (
            <div className={s.system}>
              {view.technicalNotice.message}{" "}
              {view.technicalNotice.canRetry && (
                <button type="button" className={`${s.btn} ${s.ghost}`} onClick={() => void retry()} disabled={busy}>
                  Retry once
                </button>
              )}
            </div>
          )}
          {view.stage === "awaiting_final_decision" && <div className={s.system}>Opponent paused after verification (final decision stage).</div>}
          {view.outcome && <div className={s.system}>Session ended: {view.outcome}</div>}
          {error && (
            <div className={s.system} role="alert">
              {error}
            </div>
          )}
        </div>
        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor={inputId} className={s.small}>
            Message
          </label>
          <input id={inputId} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder={paused ? "Conversation paused or ended" : "Reply to Avery…"} disabled={paused || busy} autoComplete="off" />
          <button type="submit" className={s.btn} disabled={paused || busy || !draft.trim()}>
            Send
          </button>
        </form>
      </section>

      <section className={s.trace} aria-label="Agent trace">
        <header className={s.traceHeader}>
          <div className={s.contact}>
            <strong>Agent trace {active ? `· ${labelOf(active.id)}` : ""}</strong>
            <span className={s.small}>In order: observer → reviewer → eligibility → planner → actor (v2) → commit. Raw model output is shown exactly as returned.</span>
          </div>
          <div className={s.tabs}>
            <button type="button" className={`${s.btn} ${s.ghost}`} onClick={() => setExpandAll((x) => !x)}>
              {expandAll ? "Collapse all" : "Expand all"}
            </button>
            <button type="button" className={`${s.btn} ${s.ghost}`} onClick={() => void loadTrace(view.sessionId)}>
              Refresh
            </button>
            <button type="button" className={`${s.btn} ${s.danger}`} onClick={() => void event("conversation_ended")} disabled={busy || view.ended}>
              End practice
            </button>
          </div>
        </header>
        <div className={s.steps}>
          {traceError && <p className={s.empty}>{traceError}</p>}
          {groups.length > 1 && (
            <div className={s.tabs} role="tablist" aria-label="Inputs">
              {groups.map((g, i) => (
                <button key={g.id} type="button" role="tab" aria-selected={active?.id === g.id} className={`${s.btn} ${active?.id === g.id ? "" : s.ghost}`} onClick={() => setSelected(g.id)}>
                  {i + 1}. {labelOf(g.id)}
                </button>
              ))}
            </div>
          )}
          {!active && !traceError && <p className={s.empty}>Send a message to see what each agent receives and returns.</p>}
          {active?.entries.map((e) => <Step key={`${e.seq}-${expandAll}`} entry={e} open={expandAll || e.step === "model.call" || e.status === "fail"} />)}
        </div>
      </section>
    </main>
  );
}

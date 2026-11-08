"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Folder } from "lucide-react";
import type { PublicSessionSummary } from "@/contracts/history";
import type { ObserverSessionView } from "@/contracts/observer";
import { errorMessage } from "@/lib/api-client";
import { scamperApi } from "./adapter";
import { dateTime, OUTCOME } from "./labels";
import { Badge, InlineError } from "./ui";
import s from "./scamper.module.css";

type HistoryState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; sessions: PublicSessionSummary[]; nextCursor: string | null; loadingMore: boolean };

/** Server-side history for this player (survives clearing browser storage while the cookie persists). */
export function useSessionHistory() {
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    scamperApi.history().then(
      (r) => alive && setState({ kind: "ready", sessions: r.sessions, nextCursor: r.nextCursor, loadingMore: false }),
      (e) => alive && setState({ kind: "error", message: errorMessage(e, "Could not load your practice history.") }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((a) => a + 1);
  }, []);
  const more = useCallback(() => {
    if (state.kind !== "ready" || !state.nextCursor || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    scamperApi.history(state.nextCursor).then(
      (r) => setState({ kind: "ready", sessions: [...state.sessions, ...r.sessions], nextCursor: r.nextCursor, loadingMore: false }),
      (e) => setState({ kind: "error", message: errorMessage(e, "Could not load more sessions.") }),
    );
  }, [state]);
  return { state, reload, more };
}

export function SessionStatus({ view }: { view: Pick<ObserverSessionView, "outcome"> }) {
  if (!view.outcome) return <Badge tone="neutral">In progress</Badge>;
  const o = OUTCOME[view.outcome];
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

export function SessionList({ sessions }: { sessions: PublicSessionSummary[] }) {
  return (
    <ul className={s.list}>
      {sessions.map((e) => (
        <li key={e.sessionId} className={s.listItem}>
          <span className={s.stack}>
            <strong>
              {e.title} · {dateTime(e.createdAt)}
            </strong>
            <SessionStatus view={e} />
          </span>
          <Link className={s.button} data-variant="secondary" href={e.ended ? `/scamper/history/${e.sessionId}` : "/scamper/practice"}>
            {e.ended ? "Open review" : "Continue"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CaseHistory() {
  const { state, reload, more } = useSessionHistory();
  return (
    <main className={s.page}>
      <h1 className={s.title}>Case history</h1>
      <p className={s.lede}>Your practice sessions on this device. Open one to see its review.</p>
      {state.kind === "loading" && (
        <p className={s.muted} role="status">
          Loading your sessions…
        </p>
      )}
      {state.kind === "error" && <InlineError message={state.message} onRetry={reload} />}
      {state.kind === "ready" && state.sessions.length === 0 && (
        <div className={s.softCard}>
          <h2 className={s.cardTitle}>
            <Folder size={20} className={s.iconAccent} aria-hidden />
            No sessions yet
          </h2>
          <p className={s.muted}>Finished practices will appear here.</p>
          <div className={s.row}>
            <Link className={s.button} href="/scamper/practice">
              Start practice
            </Link>
          </div>
        </div>
      )}
      {state.kind === "ready" && state.sessions.length > 0 && (
        <>
          <SessionList sessions={state.sessions} />
          {state.nextCursor && (
            <div className={s.row}>
              <button type="button" className={s.button} data-variant="secondary" onClick={more} disabled={state.loadingMore}>
                {state.loadingMore ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

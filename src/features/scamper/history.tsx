"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Folder } from "lucide-react";
import type { ObserverSessionView } from "@/contracts/observer";
import { errorMessage } from "@/lib/api-client";
import { scamperApi, sessionIndex, type IndexedSession } from "./adapter";
import { dateTime, OUTCOME } from "./labels";
import { Badge, InlineError } from "./ui";
import s from "./scamper.module.css";

export type HistoryEntry = IndexedSession & ({ status: "ok"; view: ObserverSessionView } | { status: "missing" } | { status: "error"; message: string });

/** Sessions this browser started, each re-read from the server (which enforces ownership). */
export function useSessionHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>();
  const load = useCallback(async () => {
    const index = sessionIndex.list();
    const results = await Promise.allSettled(index.map((i) => scamperApi.load(i.id)));
    return index.map((i, n): HistoryEntry => {
      const r = results[n];
      if (r.status === "fulfilled") return { ...i, status: "ok", view: r.value.session };
      const status = (r.reason as { status?: number })?.status;
      return status === 404 ? { ...i, status: "missing" } : { ...i, status: "error", message: errorMessage(r.reason, "Could not load this session.") };
    });
  }, []);
  const reload = useCallback(() => {
    setEntries(undefined);
    void load().then(setEntries);
  }, [load]);
  useEffect(() => {
    let alive = true;
    void load().then((e) => {
      if (alive) setEntries(e);
    });
    return () => {
      alive = false;
    };
  }, [load]);
  return { entries, reload };
}

export function SessionStatus({ view }: { view: ObserverSessionView }) {
  if (!view.outcome) return <Badge tone="neutral">In progress</Badge>;
  const o = OUTCOME[view.outcome];
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

export function CaseHistory() {
  const { entries, reload } = useSessionHistory();
  const visible = entries?.filter((e) => e.status !== "missing");
  return (
    <main className={s.page}>
      <h1 className={s.title}>Case history</h1>
      <p className={s.lede}>Practice sessions started in this browser. Open one to see its review.</p>
      {!visible ? (
        <p className={s.muted} role="status">
          Loading your sessions…
        </p>
      ) : visible.length === 0 ? (
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
      ) : (
        <>
          {visible.some((e) => e.status === "error") && <InlineError message="Some sessions could not be loaded." onRetry={reload} />}
          <ul className={s.list}>
            {visible.map((e) => (
              <li key={e.id} className={s.listItem}>
                <span className={s.stack}>
                  <strong>Practice · {dateTime(e.startedAt)}</strong>
                  {e.status === "ok" ? <SessionStatus view={e.view} /> : <span className={s.muted}>{e.status === "error" ? e.message : ""}</span>}
                </span>
                {e.status === "ok" && (
                  <Link className={s.button} data-variant="secondary" href={e.view.ended ? `/scamper/history/${e.id}` : "/scamper/practice"}>
                    {e.view.ended ? "Open review" : "Continue"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

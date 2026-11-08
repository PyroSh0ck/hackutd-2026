"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { Outcome } from "@/contracts/observer";
import { useSessionHistory, SessionStatus } from "./history";
import { dateTime, OUTCOME } from "./labels";
import { Mascot } from "./mascot";
import { InlineError } from "./ui";
import s from "./scamper.module.css";

/** Home: welcome, start card, and a summary computed only from sessions the server actually returned. */
export function HomeSummary() {
  const { entries, reload } = useSessionHistory();
  const loaded = entries?.flatMap((e) => (e.status === "ok" ? [e] : [])) ?? [];
  const completed = loaded.filter((e) => e.view.ended && e.view.outcome);
  const counts = completed.reduce<Partial<Record<Outcome, number>>>((acc, e) => ({ ...acc, [e.view.outcome!]: (acc[e.view.outcome!] ?? 0) + 1 }), {});

  return (
    <main className={s.page}>
      <div className={s.hero}>
        <Mascot size={148} description="SCAMPER's detective guide, a raccoon in a detective hat holding a magnifying glass" />
        <div className={s.stack}>
          <h1 className={s.title}>Welcome to SCAMPER</h1>
          <p className={s.lede}>Practice spotting customer scams in a safe, fictional conversation. Take your time, look closer, and decide who to trust.</p>
        </div>
      </div>

      <div className={s.startCard}>
        <div className={s.stack}>
          <h2 className={s.cardTitle}>
            <MessageCircle size={20} className={s.iconAccent} aria-hidden />
            Practice a conversation
          </h2>
          <p className={s.muted}>A few minutes with a simulated message. You can end at any time.</p>
        </div>
        <Link className={s.button} href="/scamper/practice">
          Start practice
        </Link>
      </div>

      <section className={s.stack} aria-label="Your recent sessions">
        <h2 className={s.subtitle}>Your sessions</h2>
        {!entries ? (
          <p className={s.muted} role="status">
            Loading…
          </p>
        ) : loaded.length === 0 ? (
          <p className={s.muted}>No practice sessions yet. Your completed sessions will show up here.</p>
        ) : (
          <>
            {entries.some((e) => e.status === "error") && <InlineError message="Some sessions could not be loaded." onRetry={reload} />}
            <dl className={s.facts}>
              <dt>Completed sessions</dt>
              <dd>{completed.length}</dd>
              {(Object.keys(counts) as Outcome[]).map((o) => (
                <div key={o} style={{ display: "contents" }}>
                  <dt>{OUTCOME[o].label}</dt>
                  <dd>{counts[o]}</dd>
                </div>
              ))}
            </dl>
            <ul className={s.list}>
              {loaded.slice(0, 3).map((e) => (
                <li key={e.id} className={s.listItem}>
                  <span className={s.stack}>
                    <strong>Practice · {dateTime(e.startedAt)}</strong>
                    <SessionStatus view={e.view} />
                  </span>
                  <Link className={s.button} data-variant="secondary" href={e.view.ended ? `/scamper/history/${e.id}` : "/scamper/practice"}>
                    {e.view.ended ? "Open review" : "Continue"}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

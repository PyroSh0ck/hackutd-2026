"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { Outcome } from "@/contracts/observer";
import { useEffect, useState } from "react";
import type { ProgressResponse } from "@/contracts/history";
import { scamperApi } from "./adapter";
import { SessionList, useSessionHistory } from "./history";
import { OUTCOME } from "./labels";
import { Mascot } from "./mascot";
import { InlineError } from "./ui";
import s from "./scamper.module.css";

/** Home: welcome, start card, and a summary computed only from sessions the server actually returned. */
export function HomeSummary() {
  const { state, reload } = useSessionHistory();
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  useEffect(() => {
    let alive = true;
    scamperApi.progress().then(
      (p) => alive && setProgress(p),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className={s.page}>
      <div className={s.hero}>
        <Mascot size={148} description="Cyber Sleuth's detective guide, a raccoon in a detective hat holding a magnifying glass" />
        <div className={s.stack}>
          <h1 className={s.title}>Welcome to Cyber Sleuth</h1>
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
        {state.kind === "loading" && (
          <p className={s.muted} role="status">
            Loading…
          </p>
        )}
        {state.kind === "error" && <InlineError message={state.message} onRetry={reload} />}
        {state.kind === "ready" && state.sessions.length === 0 && <p className={s.muted}>No practice sessions yet. Your completed sessions will show up here.</p>}
        {state.kind === "ready" && state.sessions.length > 0 && (
          <>
            {progress && (
              <dl className={s.facts}>
                <dt>Completed sessions</dt>
                <dd>{progress.completed}</dd>
                {(Object.keys(progress.outcomes) as Outcome[]).map((o) => (
                  <div key={o} style={{ display: "contents" }}>
                    <dt>{OUTCOME[o].label}</dt>
                    <dd>{progress.outcomes[o]}</dd>
                  </div>
                ))}
                <dt>Checked with official support</dt>
                <dd>{progress.observations.verificationCompleted}</dd>
              </dl>
            )}
            <SessionList sessions={state.sessions.slice(0, 3)} />
          </>
        )}
      </section>
    </main>
  );
}

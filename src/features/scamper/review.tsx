"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { ObserverSessionView } from "@/contracts/observer";
import { errorMessage } from "@/lib/api-client";
import { scamperApi, sessionIndex } from "./adapter";
import { SessionStatus } from "./history";
import { ACTION_LABEL, dateTime, OUTCOME, time } from "./labels";
import { HowItWorked } from "./explain";
import { Mascot } from "./mascot";
import { InlineError } from "./ui";
import s from "./scamper.module.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; view: ObserverSessionView };

export function SessionReviewRoute() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    scamperApi.load(id).then(
      (r) => alive && setState({ kind: "ready", view: r.session }),
      (e) => alive && setState({ kind: "error", message: errorMessage(e, "This review could not be loaded.") }),
    );
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  if (state.kind === "loading")
    return (
      <main className={s.page}>
        <p className={s.muted} role="status">
          Loading the review…
        </p>
      </main>
    );
  if (state.kind === "error")
    return (
      <main className={s.page}>
        <h1 className={s.title}>Review unavailable</h1>
        <InlineError
          message={state.message}
          onRetry={() => {
            setState({ kind: "loading" });
            setAttempt((a) => a + 1);
          }}
        >
          <Link className={s.button} data-variant="secondary" href="/scamper/history">
            Back to case history
          </Link>
        </InlineError>
      </main>
    );
  return <SessionReview view={state.view} />;
}

function EvidenceCard({ title, at, quote, children }: { title: string; at?: string; quote?: string; children?: ReactNode }) {
  return (
    <li className={s.evidence}>
      <div className={s.row}>
        <strong>{title}</strong>
        {at && <span className={`${s.muted} ${s.small}`}>{time(at)}</span>}
      </div>
      {quote && <blockquote className={s.quote}>{quote}</blockquote>}
      {children}
    </li>
  );
}

/** Review built only from what the server recorded: its outcome, the transcript and the recorded actions. */
export function SessionReview({ view }: { view: ObserverSessionView }) {
  const router = useRouter();
  const outcome = view.outcome ? OUTCOME[view.outcome] : null;
  const request = view.requests.at(-1);
  const requestMessage = request && view.messages.find((m) => m.id === request.introducedByMessageId);
  const actions = view.events.filter((e) => ACTION_LABEL[e.type]);
  const lastReply = view.messages.filter((m) => m.role === "user").at(-1);

  const tryAgain = () => {
    sessionIndex.setCurrent(null);
    router.push("/scamper/practice");
  };

  return (
    <main className={s.page}>
      <div className={s.hero}>
        <Mascot size={112} />
        <div className={s.stack}>
          <span className={`${s.muted} ${s.small}`}>Practice · {dateTime(view.messages[0]?.createdAt ?? new Date().toISOString())}</span>
          <h1 className={s.title}>Your practice review</h1>
          <SessionStatus view={view} />
        </div>
      </div>

      {!view.ended ? (
        <div className={s.softCard}>
          <p>This practice is still in progress, so there is no review yet.</p>
          <div className={s.row}>
            <Link className={s.button} href="/scamper/practice">
              Continue practice
            </Link>
          </div>
        </div>
      ) : (
        outcome && (
          <div className={s.softCard}>
            <h2 className={s.cardTitle}>{outcome.label}</h2>
            <p>{outcome.summary}</p>
          </div>
        )
      )}

      {view.ended && (
        <section className={s.stack} aria-label="What happened">
          <h2 className={s.subtitle}>
            What happened
          </h2>
          <ul className={s.list}>
            {requestMessage && <EvidenceCard title={`${view.scenario.senderName} asked`} at={requestMessage.createdAt} quote={requestMessage.content} />}
            {lastReply && <EvidenceCard title="Your last reply" at={lastReply.createdAt} quote={lastReply.content} />}
            {actions.map((e) => (
              <EvidenceCard key={e.id} title={ACTION_LABEL[e.type]!} at={e.createdAt} />
            ))}
            {view.verification.officialResult && (
              <EvidenceCard title="Official support result">
                <p>{view.verification.officialResult}</p>
              </EvidenceCard>
            )}
          </ul>
          {actions.length === 0 && !requestMessage && <p className={s.muted}>No actions were recorded in this session.</p>}
        </section>
      )}

      <details className={s.transcript}>
        <summary>Full transcript ({view.messages.length} messages)</summary>
        <ol className={s.list}>
          {view.messages.map((m) => (
            <li key={m.id} className={s.evidence}>
              <div className={s.row}>
                <strong>{m.role === "user" ? "You" : `${view.scenario.senderName} (fictional)`}</strong>
                <span className={`${s.muted} ${s.small}`}>{time(m.createdAt)}</span>
              </div>
              <p className={s.bubbleText}>{m.content}</p>
            </li>
          ))}
        </ol>
      </details>

      {view.ended && <HowItWorked sessionId={view.sessionId} />}

      <div className={s.row}>
        <button type="button" className={s.button} onClick={tryAgain}>
          Try again
        </button>
        <Link className={s.button} data-variant="secondary" href="/scamper">
          Back to Home
        </Link>
      </div>
    </main>
  );
}

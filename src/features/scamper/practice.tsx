"use client";

import Link from "next/link";
import { AlertDialog, Dialog } from "radix-ui";
import { ArrowDown, ClipboardList, ExternalLink, Flag, PanelRight, SendHorizontal, ShieldCheck, User, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ClientEventType, Message, ObserverSessionView } from "@/contracts/observer";
import { errorMessage } from "@/lib/api-client";
import { newer, scamperApi, sessionIndex, type EventExtra } from "./adapter";
import { OUTCOME, startedAt, time } from "./labels";
import { Mascot } from "./mascot";
import { Badge, InlineError } from "./ui";
import s from "./scamper.module.css";

/**
 * Practice workspace (Magenta Modern). Every enabled control is derived from the server view (stage,
 * requestStatus, stopConfirmationPending, ended); nothing is inferred from message text. Typing "I accept"
 * in chat never submits the request: only the request card's explicit, confirmed action does.
 */

type Phase = { kind: "loading" } | { kind: "ready"; last?: ObserverSessionView } | { kind: "session" };

export function PracticeWorkspace() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [view, setView] = useState<ObserverSessionView>();
  const [startError, setStartError] = useState<string>();
  const [starting, setStarting] = useState(false);

  // Resume the current session through the existing GET contract; an unreadable id is simply forgotten.
  useEffect(() => {
    let alive = true;
    const resume = async () => {
      const id = sessionIndex.current();
      if (!id) return setPhase({ kind: "ready" });
      try {
        const { session } = await scamperApi.load(id);
        if (!alive) return;
        if (session.ended) setPhase({ kind: "ready", last: session });
        else {
          setView(session);
          setPhase({ kind: "session" });
        }
      } catch {
        sessionIndex.setCurrent(null);
        if (alive) setPhase({ kind: "ready" });
      }
    };
    void resume();
    return () => {
      alive = false;
    };
  }, []);

  const begin = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setStartError(undefined);
    try {
      const { session } = await scamperApi.start();
      sessionIndex.setCurrent(session.sessionId);
      sessionIndex.add(session.sessionId, startedAt(session));
      setView(session);
      setPhase({ kind: "session" });
    } catch (e) {
      setStartError(errorMessage(e, "Could not start the practice."));
    } finally {
      setStarting(false);
    }
  }, [starting]);

  if (phase.kind === "loading") {
    return (
      <div className={s.workspace}>
        <section className={s.conversation} aria-busy="true">
          <p className={s.muted} role="status">
            Loading your practice…
          </p>
        </section>
      </div>
    );
  }

  if (phase.kind === "ready" || !view) {
    const last = phase.kind === "ready" ? phase.last : undefined;
    return (
      <div className={s.workspace}>
        <section className={s.conversation}>
          <PracticeIntro onBegin={() => void begin()} starting={starting} error={startError} last={last} />
        </section>
        <PracticeDetails inline view={undefined} />
      </div>
    );
  }

  return <ActivePractice key={view.sessionId} initial={view} onRestart={() => void begin()} restarting={starting} restartError={startError} />;
}

function PracticeIntro({ onBegin, starting, error, last }: { onBegin: () => void; starting: boolean; error?: string; last?: ObserverSessionView }) {
  return (
    <div className={s.intro}>
      <Mascot size={148} description="SCAMPER's detective guide, a raccoon in a detective hat holding a magnifying glass" />
      <Badge>Simulation</Badge>
      <h1 className={s.title}>Practice a real-world conversation.</h1>
      {/* Only one (suspicious) scenario exists today, so the copy must not claim legitimate ones are mixed in. */}
      <p className={s.lede}>Practice handling a simulated suspicious message.</p>
      <p className={s.lede}>Use only the fictional details provided. You can end practice at any time.</p>
      {error && <InlineError message={error} onRetry={onBegin} />}
      <div className={s.row}>
        <button type="button" className={s.button} onClick={onBegin} disabled={starting} aria-busy={starting}>
          {starting ? "Starting…" : "Begin practice"}
        </button>
        {last && (
          <Link className={s.button} data-variant="secondary" href={`/scamper/history/${last.sessionId}`}>
            Review your last practice
          </Link>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- active

function ActivePractice({ initial, onRestart, restarting, restartError }: { initial: ObserverSessionView; onRestart: () => void; restarting: boolean; restartError?: string }) {
  const [view, setViewRaw] = useState(initial);
  const setView = (next: ObserverSessionView) => setViewRaw((prev) => newer(prev, next));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [challengeId, setChallengeId] = useState<string>();
  const [verifyOpen, setVerifyOpen] = useState(initial.stage === "verifying" || initial.stage === "awaiting_final_decision");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sendLock = useRef(false);
  const actLock = useRef(false);
  const id = view.sessionId;

  const active = view.stage === "active" && !view.ended && !view.stopConfirmationPending;
  const paused = view.stage === "verifying" || view.stage === "awaiting_final_decision";

  async function send() {
    const text = draft.trim();
    if (!text || sendLock.current || !active) return;
    sendLock.current = true;
    setSending(true);
    setSendError(undefined);
    try {
      const r = await scamperApi.send(id, text);
      setView(r.session);
      setDraft("");
    } catch (e) {
      setSendError(errorMessage(e, "Your message was not sent. Your draft is kept; try again."));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function act(type: ClientEventType, extra: EventExtra = {}, opts: { allowWhileSending?: boolean } = {}) {
    if (actLock.current || (sending && !opts.allowWhileSending)) return;
    actLock.current = true;
    setActing(true);
    setActionError(undefined);
    try {
      const r = await scamperApi.event(id, type, extra);
      if (r.challengeId) setChallengeId(r.challengeId);
      setView(r.session);
    } catch (e) {
      setActionError(errorMessage(e, "That action did not go through. Try again."));
    } finally {
      actLock.current = false;
      setActing(false);
    }
  }

  async function retry() {
    if (sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(undefined);
    try {
      setView((await scamperApi.retry(id)).session);
    } catch (e) {
      setSendError(errorMessage(e, "The retry did not go through."));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  const busy = sending || acting;
  // End practice stays usable while a reply is generating: the server cancels the in-flight work.
  const endPractice = () => void act("conversation_ended", {}, { allowWhileSending: true });
  const report = () => void act("conversation_reported");
  const openCheck = () => setVerifyOpen(true);

  const details = <PracticeDetails view={view} onCheck={openCheck} onReport={report} disabled={busy} />;

  return (
    <div className={s.workspace}>
      <section className={s.conversation} aria-label="Practice conversation">
        <ConversationHeader view={view} onEnd={endPractice} endDisabled={acting} onDetails={() => setDetailsOpen(true)} />

        {view.ended && view.outcome ? (
          <EndedBanner view={view} onRestart={onRestart} restarting={restarting} error={restartError} />
        ) : null}

        {paused && !verifyOpen && (
          <div className={s.notice} role="status">
            <ShieldCheck size={20} className={s.iconAccent} aria-hidden />
            <div className={s.noticeBody}>
              <span>The conversation is paused while you check with official support.</span>
              <div className={s.row}>
                <button type="button" className={s.button} data-variant="secondary" onClick={openCheck}>
                  Open official support check
                </button>
              </div>
            </div>
          </div>
        )}

        <MessageList view={view} pending={sending}>
          <SimulatedRequestCard view={view} busy={busy} onReject={(requestId) => void act("request_rejected", { requestId })} onShare={(requestId, practiceCode) => void act("practice_code_submitted", { requestId, practiceCode })} />
        </MessageList>

        {view.stopConfirmationPending && !view.ended && (
          <div className={s.softCard}>
            <h2 className={s.cardTitle}>End the practice?</h2>
            <p className={s.muted}>It sounded like you might want to stop. Nothing else happens until you choose.</p>
            <div className={s.row}>
              <button type="button" className={s.button} onClick={endPractice} disabled={acting}>
                End practice
              </button>
              <button type="button" className={s.button} data-variant="secondary" onClick={() => void act("stop_confirmation_dismissed")} disabled={busy}>
                Keep practicing
              </button>
            </div>
          </div>
        )}

        {view.technicalNotice && !view.ended && (
          <InlineError message={view.technicalNotice.message} onRetry={view.technicalNotice.canRetry ? () => void retry() : undefined} retryLabel="Retry reply" />
        )}
        {actionError && <InlineError message={actionError} onDismiss={() => setActionError(undefined)} />}
        {sendError && <InlineError message={sendError} onRetry={() => void send()} retryLabel="Send again" onDismiss={() => setSendError(undefined)} />}

        <MessageComposer value={draft} onChange={setDraft} onSend={() => void send()} disabled={!active} sending={sending} />
      </section>

      <div className={s.details} data-inline>
        {details}
      </div>

      <Dialog.Root open={detailsOpen} onOpenChange={setDetailsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={s.overlay} />
          <Dialog.Content className={s.sheet}>
            <div className={s.dialogHead}>
              <Dialog.Title className={s.dialogTitle}>Practice details</Dialog.Title>
              <Dialog.Close className={s.iconButton} aria-label="Close practice details">
                <X size={18} aria-hidden />
              </Dialog.Close>
            </div>
            <Dialog.Description className={s.srOnly}>Fictional practice details and the official support check.</Dialog.Description>
            <PracticeDetails
              view={view}
              hideTitle
              onCheck={() => {
                setDetailsOpen(false);
                openCheck();
              }}
              onReport={report}
              disabled={busy}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <VerificationDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        view={view}
        busy={busy}
        challengeId={challengeId}
        error={actionError}
        onRun={() => void act("official_verification_started", view.verificationLinkIssueId ? { linkedIssueId: view.verificationLinkIssueId } : {})}
        onComplete={() => void act("official_verification_completed", { challengeId })}
        onCancel={() => void act("official_verification_cancelled")}
        onReport={report}
        onProceed={() => void act("final_decision_proceed")}
      />
    </div>
  );
}

function ConversationHeader({ view, onEnd, endDisabled, onDetails }: { view: ObserverSessionView; onEnd: () => void; endDisabled: boolean; onDetails: () => void }) {
  return (
    <header className={s.conversationHead}>
      <div className={s.headRow}>
        <div className={s.stack}>
          <Badge>Simulation</Badge>
          <h1 className={s.title}>An unexpected account message</h1>
        </div>
        <button type="button" className={`${s.button} ${s.detailsToggle}`} data-variant="secondary" onClick={onDetails}>
          <PanelRight size={18} aria-hidden />
          Practice details
        </button>
      </div>
      <p className={`${s.lede} ${s.hideMobile}`}>You received a message about an account. Read it and decide how to respond.</p>
      <p className={`${s.muted} ${s.small}`}>{view.scenario.simulationNotice}</p>
      <div className={s.senderBar}>
        <div className={s.sender}>
          <span className={s.avatar} aria-hidden>
            <User size={18} />
          </span>
          <span>
            <span className={s.senderName}>{view.scenario.senderName}</span>
            <span className={`${s.muted} ${s.small}`}> · fictional sender</span>
          </span>
        </div>
        {!view.ended && (
          <button type="button" className={s.button} data-variant="ghost" onClick={onEnd} disabled={endDisabled}>
            End practice
          </button>
        )}
      </div>
    </header>
  );
}

function EndedBanner({ view, onRestart, restarting, error }: { view: ObserverSessionView; onRestart: () => void; restarting: boolean; error?: string }) {
  const o = OUTCOME[view.outcome!];
  return (
    <div className={s.softCard} role="status">
      <div className={s.row}>
        <h2 className={s.cardTitle}>Practice ended</h2>
        <Badge tone={o.tone}>{o.label}</Badge>
      </div>
      <p>{o.summary}</p>
      {error && <InlineError message={error} onRetry={onRestart} />}
      <div className={s.row}>
        <Link className={s.button} href={`/scamper/history/${view.sessionId}`}>
          See your review
        </Link>
        <button type="button" className={s.button} data-variant="secondary" onClick={onRestart} disabled={restarting}>
          {restarting ? "Starting…" : "Try again"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- messages

function MessageBubble({ message, sender }: { message: Message; sender: string }) {
  const self = message.role === "user";
  return (
    <li className={s.message} data-role={message.role}>
      <span className={s.avatar} data-self={self || undefined} aria-hidden>
        <User size={18} />
      </span>
      <div className={s.bubble}>
        <div className={s.bubbleMeta}>
          <strong>{self ? "You" : sender}</strong>
          <span aria-hidden>·</span>
          <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
        </div>
        {/* Plain text only: model output is never rendered as HTML and simulated destinations never become links. */}
        <p className={s.bubbleText}>{message.content}</p>
      </div>
    </li>
  );
}

function TypingIndicator({ sender }: { sender: string }) {
  return (
    <li className={s.message} data-role="assistant">
      <span className={s.avatar} aria-hidden>
        <User size={18} />
      </span>
      <div className={s.bubble}>
        <span className={s.srOnly}>{sender} is replying</span>
        <span className={s.typing} aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </div>
    </li>
  );
}

/** Transcript plus trailing inline content (the request card), so cards scroll with the conversation. */
function MessageList({ view, pending, children }: { view: ObserverSessionView; pending: boolean; children?: ReactNode }) {
  const scroller = useRef<HTMLOListElement>(null);
  const count = view.messages.length + (pending ? 1 : 0) + (view.requestStatus === "not_presented" ? 0 : 1);
  const lastRole = view.messages.at(-1)?.role;
  const [atBottom, setAtBottom] = useState(true);
  const [seen, setSeen] = useState(count);
  // Follow new messages only when the reader is already at the bottom (or just sent one); otherwise offer a jump.
  const follow = atBottom || lastRole === "user";
  if (follow && seen !== count) setSeen(count);
  const unseen = !follow && count > seen;

  // Announce only replies that arrive after mount, never the whole transcript.
  const latest = view.messages.filter((m) => m.role === "assistant").at(-1);
  const [initialAssistantId] = useState(latest?.id);
  const announcement = latest && latest.id !== initialAssistantId ? `New message from ${view.scenario.senderName}: ${latest.content}` : "";

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [count, follow]);

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setSeen(count);
  };

  return (
    <div className={s.messagesWrap}>
      <ol
        ref={scroller}
        className={s.messages}
        aria-label="Conversation transcript"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAtBottom(near);
          if (near) setSeen(count);
        }}
      >
        {view.messages.map((m) => (
          <MessageBubble key={m.id} message={m} sender={view.scenario.senderName} />
        ))}
        {pending && <TypingIndicator sender={view.scenario.senderName} />}
        {children}
      </ol>
      {unseen && (
        <button type="button" className={s.jump} onClick={toBottom}>
          <ArrowDown size={14} aria-hidden /> New message
        </button>
      )}
      <div className={s.srOnly} aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

function MessageComposer({ value, onChange, onSend, disabled, sending }: { value: string; onChange: (v: string) => void; onSend: () => void; disabled: boolean; sending: boolean }) {
  const inputId = useId();
  const hintId = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <form
      className={s.composer}
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <label className={s.composerLabel} htmlFor={inputId}>
        Message
      </label>
      <div className={s.composerBox}>
        <textarea
          id={inputId}
          className={s.composerInput}
          rows={1}
          value={value}
          placeholder={disabled ? "Messaging is paused" : "Type your reply…"}
          aria-describedby={hintId}
          disabled={disabled}
          readOnly={sending}
          maxLength={2000}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className={s.button} disabled={disabled || sending || !value.trim()} aria-busy={sending}>
          <SendHorizontal size={18} aria-hidden />
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      <p id={hintId} className={s.composerHint}>
        Use only fictional information. Enter sends; Shift+Enter adds a new line.
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------- request card

function SimulatedRequestCard({ view, busy, onReject, onShare }: { view: ObserverSessionView; busy: boolean; onReject: (requestId: string) => void; onShare: (requestId: string, code: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const request = view.requests.at(-1);
  if (!request || view.requestStatus === "not_presented" || !view.practiceCode) return null;

  const shareable = view.requestStatus === "pending" && !view.ended && ((view.stage === "active" && !view.stopConfirmationPending) || (view.stage === "awaiting_final_decision" && view.finalDecisionProceeded));
  const state = view.requestStatus === "completed" ? "submitted" : view.requestStatus === "rejected" ? "rejected" : shareable ? "pending" : "inactive";
  const status = { pending: "Awaiting your choice", submitted: "Shared in simulation", rejected: "Declined", inactive: view.ended ? "Closed" : "Paused" }[state];

  return (
    <li className={s.requestCard} data-state={state} aria-label="Simulated request">
      <div className={s.row}>
        <h2 className={s.cardTitle}>Simulated request: share practice code</h2>
        <Badge tone={state === "submitted" ? "error" : state === "pending" ? undefined : "neutral"}>{status}</Badge>
      </div>
      <p className={s.muted}>{request.description}</p>
      <p>
        Fictional practice code: <span className={s.code}>{view.practiceCode}</span>
      </p>
      <p className={`${s.muted} ${s.small}`}>Typing the code or “I accept” in chat does not count. Only this card does.</p>
      {shareable && (
        <div className={s.row}>
          <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
            <AlertDialog.Trigger className={s.button} disabled={busy}>
              Share practice code
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className={s.overlay} />
              <AlertDialog.Content className={s.dialog}>
                <AlertDialog.Title className={s.dialogTitle}>Share the fictional practice code?</AlertDialog.Title>
                <AlertDialog.Description className={s.muted}>
                  This is a simulated disclosure of the fictional practice code {view.practiceCode}. Nothing real is shared. Cancel to keep it to yourself.
                </AlertDialog.Description>
                <div className={s.row}>
                  <AlertDialog.Cancel className={s.button} data-variant="secondary">
                    Cancel
                  </AlertDialog.Cancel>
                  <AlertDialog.Action className={s.button} onClick={() => onShare(request.id, view.practiceCode!)}>
                    Share in simulation
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
          {view.stage === "active" && (
            <button type="button" className={s.button} data-variant="secondary" onClick={() => onReject(request.id)} disabled={busy}>
              Decline request
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------- details

export function PracticeDetails({ view, inline, hideTitle, onCheck, onReport, disabled }: { view: ObserverSessionView | undefined; inline?: boolean; hideTitle?: boolean; onCheck?: () => void; onReport?: () => void; disabled?: boolean }) {
  const canCheck = !!view && !view.ended && !view.stopConfirmationPending;
  const paused = view?.stage === "verifying" || view?.stage === "awaiting_final_decision";
  const body = (
    <>
      {!hideTitle && (
        <h2 className={s.cardTitle}>
          <ClipboardList size={22} className={s.iconAccent} aria-hidden />
          Practice details
        </h2>
      )}
      {/* Neutral, fictional facts only: no hints about whether the message is a scam. */}
      <dl className={s.facts}>
        <dt>Scenario</dt>
        <dd>An unexpected account message</dd>
        <dt>Sender</dt>
        <dd>{view ? `${view.scenario.senderName} (fictional)` : "A fictional sender"}</dd>
        <dt>Your goal</dt>
        <dd>Respond the way you would in real life.</dd>
        {view && (
          <>
            <dt>Progress</dt>
            <dd>
              Turn {view.turn} of {view.maxTurns}
            </dd>
          </>
        )}
      </dl>
      {view && (
        <button type="button" className={s.button} data-block onClick={onCheck} disabled={!canCheck || (disabled && !paused)}>
          <ExternalLink size={18} aria-hidden />
          {paused ? "Open support check" : "Check official support"}
        </button>
      )}
      <div className={s.noteCard}>
        <h3 className={s.cardTitle}>
          <ClipboardList size={18} className={s.iconAccent} aria-hidden />
          Session note
        </h3>
        <p>This is a simulation with fictional details. Checking official support pauses the conversation. You can end practice at any time.</p>
      </div>
      {view && !view.ended && view.stage === "active" && (
        <button type="button" className={s.button} data-variant="danger" data-block onClick={onReport} disabled={disabled || view.stopConfirmationPending}>
          <Flag size={18} aria-hidden />
          Report / block and end
        </button>
      )}
    </>
  );
  if (inline) return <aside className={s.details} data-inline aria-label="Practice details">{body}</aside>;
  return <div className={s.stack}>{body}</div>;
}

// ---------------------------------------------------------------------------------------------- verification

function VerificationDialog(p: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  view: ObserverSessionView;
  busy: boolean;
  challengeId?: string;
  error?: string;
  onRun: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onReport: () => void;
  onProceed: () => void;
}) {
  const { view, busy } = p;
  const result = view.verification.officialResult;
  return (
    <Dialog.Root open={p.open} onOpenChange={p.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.dialog}>
          <div className={s.dialogHead}>
            <Dialog.Title className={s.dialogTitle}>Official support check</Dialog.Title>
            <Dialog.Close className={s.iconButton} aria-label="Close official support check">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>
          <div className={s.officialBanner}>
            <ShieldCheck size={18} aria-hidden />
            Part of the app, not the conversation. The sender cannot see this.
          </div>
          <Dialog.Description className={s.muted}>
            This simulates contacting the company through a channel you found yourself, such as the number on your bill or the official app.
          </Dialog.Description>

          {p.error && <InlineError message={p.error} />}

          {view.stage === "active" && !view.ended && (
            <>
              <p>Running the check pauses the conversation until you decide what to do.</p>
              <div className={s.row}>
                <button type="button" className={s.button} onClick={p.onRun} disabled={busy || view.stopConfirmationPending} aria-busy={busy}>
                  {busy ? "Checking…" : "Run check"}
                </button>
                <Dialog.Close className={s.button} data-variant="secondary">
                  Not now
                </Dialog.Close>
              </div>
            </>
          )}

          {result && (view.stage === "verifying" || view.stage === "awaiting_final_decision" || view.ended) && (
            <div className={s.result} role="status">
              <p>
                <strong>Official result</strong>
              </p>
              <p>{result}</p>
            </div>
          )}

          {view.stage === "verifying" && (
            <>
              {!p.challengeId && <p className={`${s.muted} ${s.small}`}>This check was started before the page reloaded. Cancel it and run it again to continue.</p>}
              <div className={s.row}>
                <button type="button" className={s.button} onClick={p.onComplete} disabled={busy || !p.challengeId}>
                  I have read this result
                </button>
                <button type="button" className={s.button} data-variant="secondary" onClick={p.onCancel} disabled={busy}>
                  Cancel check
                </button>
              </div>
            </>
          )}

          {view.stage === "awaiting_final_decision" && (
            <FinalDecisionControls view={view} busy={busy} onReport={p.onReport} onProceed={p.onProceed} onBack={() => p.onOpenChange(false)} />
          )}

          {view.ended && view.outcome && (
            <p>
              <Badge tone={OUTCOME[view.outcome].tone}>{OUTCOME[view.outcome].label}</Badge>
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FinalDecisionControls({ view, busy, onReport, onProceed, onBack }: { view: ObserverSessionView; busy: boolean; onReport: () => void; onProceed: () => void; onBack: () => void }) {
  return (
    <section className={s.stack} aria-label="Your decision">
      <h3 className={s.subtitle}>Your decision</h3>
      <p className={s.muted}>The conversation stays paused until you choose.</p>
      {!view.finalDecisionProceeded ? (
        <div className={s.row}>
          <button type="button" className={s.button} onClick={onReport} disabled={busy}>
            <Flag size={18} aria-hidden />
            Report / block and end
          </button>
          <button type="button" className={s.button} data-variant="secondary" onClick={onProceed} disabled={busy}>
            Proceed with the request (simulated)
          </button>
        </div>
      ) : (
        <>
          <p>You chose to proceed. Use the simulated request card in the conversation to share the fictional code, or report instead.</p>
          <div className={s.row}>
            <button type="button" className={s.button} data-variant="secondary" onClick={onBack}>
              Back to the request card
            </button>
            <button type="button" className={s.button} data-variant="danger" onClick={onReport} disabled={busy}>
              Report / block and end
            </button>
          </div>
        </>
      )}
    </section>
  );
}

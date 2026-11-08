"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layouts/kit-layouts";
import { MESSAGE_MAX_CHARS, PlayerActionSchema, type PlayerAction, type PlayerView, type DebriefResponse, type ReplayResponse, type SubmitActionRequest } from "@/contracts/game";
import { ApiClientError, errorMessage } from "@/lib/api-client";
import { apiGameAdapter, createFixtureAdapter, type GameAdapter } from "./adapter";
import s from "./game.module.css";

export function GameExperience({ adapter: supplied }: { adapter?: GameAdapter }) {
  const [adapter, setAdapter] = useState<GameAdapter | undefined>(supplied);
  const [view, setView] = useState<PlayerView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [tab, setTab] = useState("Phone");
  const [draft, setDraft] = useState("");
  const [debrief, setDebrief] = useState<DebriefResponse>();
  const [replay, setReplay] = useState<ReplayResponse>();
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [signs, setSigns] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string>();
  const lock = useRef(false);
  const retry = useRef<(() => Promise<void>) | undefined>(undefined);
  const messageId = useId();
  const conversation = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = conversation.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [view?.messages.length]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined); retry.current = work;
    try { await work(); retry.current = undefined; setRetryAvailable(false); }
    catch (cause) { setError(errorMessage(cause, "Something went wrong. Please try again.")); setRetryAvailable(!!retry.current); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    const selected = supplied ?? (new URLSearchParams(window.location.search).get("adapter") === "api" ? apiGameAdapter : createFixtureAdapter());
    let active = true;
    const start = async () => {
      await Promise.resolve();
      if (!active) return;
      setAdapter(selected); setBusy(true);
      const session = await selected.create({ scenarioId: "bank-alert", opponentMode: "live" });
      if (active) setView(session);
    };
    retry.current = start;
    start().then(() => { retry.current = undefined; }).catch(cause => { if (active) { setError(errorMessage(cause, "Unable to start.")); setRetryAvailable(true); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [supplied]);

  // Recover persisted pending turns through the server's recovery-aware GET endpoint.
  useEffect(() => {
    if (!view?.opponent.pendingTurn || !adapter || busy) return;
    const timer = setTimeout(() => { void run(async () => setView(await adapter.get(view.sessionId))); }, 1500);
    return () => clearTimeout(timer);
  }, [view, adapter, busy]);

  const can = (action: PlayerAction) => !!view?.allowedActions.some(allowed => allowed.type === action.type && (!("requestId" in action) || allowed.requestId === action.requestId) && (!("contactId" in action) || allowed.contactId === action.contactId));
  async function act(action: PlayerAction) {
    if (!view || !adapter || !can(action)) return;
    const parsed = PlayerActionSchema.safeParse(action);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    const input: SubmitActionRequest = { actionId: crypto.randomUUID(), expectedVersion: view.version, action: parsed.data };
    await run(async () => {
      let next: PlayerView;
      try { next = await adapter.submit(view.sessionId, input); }
      catch (cause) {
        if (cause instanceof ApiClientError && cause.details.error.code === "VERSION_CONFLICT") {
          setView(await adapter.get(view.sessionId));
          retry.current = undefined;
          throw new Error("The session changed. Review the refreshed state and choose your action again.");
        }
        throw cause;
      }
      setView(next); setConfirm(undefined);
      if (action.type === "send_message") setDraft("");
      if (action.type === "submit_reflection") setDebrief(await adapter.debrief(next.sessionId));
    });
  }
  async function restart() {
    if (!adapter) return;
    await run(async () => { const next = await adapter.create({ scenarioId: "bank-alert", opponentMode: "live" }); setView(next); setDebrief(undefined); setReplay(undefined); setSigns([]); setTab("Phone"); });
  }
  const origins = new Set(view?.messages.filter(m => m.from === "opponent").map(m => m.origin));
  const mode = adapter?.source === "fixtures" ? "Public fixture preview · no live calls" : view?.opponent.mode === "scripted" ? "Scripted encounter" : origins.has("scripted_fallback") ? (origins.has("live_model") ? "Mixed · live + scripted fallback" : "Scripted fallback · live unavailable") : origins.has("live_model") ? "Live opponent" : "Live requested · awaiting first turn";

  return <main className={s.shell}>
    <PageHeader title="Scamper" description="The urgent security alert" actions={<div className={s.row}><Link href="/">Home</Link>{view && <Button text="Restart" variant="ghost" disabled={busy} onClick={() => void restart()} />}</div>} />
    <div className={s.row}><Badge text={mode} tone="info" />{view?.lineage.parentSessionId && <Badge text="Checkpoint practice · separate attempt" tone="warning" />}</div>
    {adapter?.source === "fixtures" && <p className={s.notice}>Authored snapshot walkthrough. Actions open prepared public views; your message is not sent to a model. Preview path: reply → inspect → approve, or verify → reject. Verification and rejection may advance over intermediate steps. Full rules, safe exit, reflection, and other replays require the API.</p>}
    <div aria-live="polite">{busy && <p role="status">{view ? "Waiting for the encounter…" : "Preparing your garden fund…"}</p>}</div>
    {error && <div className={s.notice} role="alert"><p>{error}</p>{retryAvailable && <Button text="Retry request" disabled={busy} onClick={() => { const work = retry.current; if (work) void run(work); }} />}</div>}
    {view && <>
      <Card title={view.goal.label} description={view.goal.description}><div className={s.row}><span data-asset-slot="goal-portrait" aria-hidden="true">♧</span><p>Goal: {view.goal.targetCredits.toLocaleString()} credits</p><Badge text={view.status === "active" ? "Encounter in progress" : "Encounter complete"} /></div></Card>
      <nav className={s.tabs} aria-label="Your devices">{["Phone", "Bank", "Contacts"].map(name => <Button key={name} text={name === "Bank" && view.paymentRequests.some(r => r.status === "pending") ? "Bank · request" : name} pressed={tab === name} variant="secondary" onClick={() => setTab(name)} />)}</nav>
      <div className={s.workspace}>
        <div className={s.panel} data-visible={tab === "Phone"}>
          <Card title={view.opponentPersona.displayName} description={`${view.opponentPersona.senderLabel} · ${view.opponentPersona.channel.toUpperCase()} · identity claimed by sender`}>
            <div className={s.stack}>
              <div ref={conversation} className={s.messages} role="log" aria-label="Conversation" aria-live="polite" tabIndex={0}>{view.messages.map(message => <article key={message.messageId} className={s.message} data-from={message.from}>
                <strong>{message.from === "player" ? "You" : view.opponentPersona.senderLabel}</strong><p>{message.text}</p><span className={s.muted}>{message.origin === "scripted_fallback" ? "Scripted fallback" : message.origin === "live_model" ? (adapter?.source === "fixtures" ? "Recorded model example · fixture" : "Live model") : message.origin === "scenario" ? "Scenario opening" : "Player message"}</span>
              </article>)}</div>
              {view.opponent.pendingTurn && <p role="status">Opponent is responding… Checking recovery automatically.</p>}
              {view.paymentRequests.some(r => r.status === "pending") && <Button text="View payment request in Bank" variant="secondary" onClick={() => setTab("Bank")} />}
              {view.status === "active" && <form className={s.stack} onSubmit={event => { event.preventDefault(); void act({ type: "send_message", text: draft }); }}>
                <label htmlFor={messageId}>Your reply</label><Textarea id={messageId} value={draft} maxLength={MESSAGE_MAX_CHARS} rows={3} disabled={busy || !can({ type: "send_message", text: "x" })} onChange={event => setDraft(event.target.value)} placeholder="What would you say?" />
                <div className={s.row}><Button text="Send reply" type="submit" disabled={busy || !draft.trim() || !can({ type: "send_message", text: draft })} /><span className={s.muted}>{draft.length}/{MESSAGE_MAX_CHARS}</span><Button text="End conversation" variant="ghost" disabled={busy || !can({ type: "end_encounter" })} onClick={() => void act({ type: "end_encounter" })} /></div>
              </form>}
            </div>
          </Card>
        </div>
        <div className={s.stack}>
          <div className={s.panel} data-visible={tab === "Bank"}><Card title="Maple Ridge Bank" description={view.bank.accountLabel}>
            <div className={s.stack}><div><p className={s.muted}>Available fictional balance</p><p className={s.balance}>{view.bank.balance.toLocaleString()} credits</p></div>
              {view.paymentRequests.length === 0 && <p>No payment requests. A message alone cannot move your money.</p>}
              {view.paymentRequests.map(request => <section className={s.notice} key={request.requestId} aria-label="Payment request"><div className={s.stack}>
                <div className={s.row}><h3>{request.amount.toLocaleString()} credits</h3><Badge text={request.status} tone={request.status === "pending" ? "warning" : "neutral"} /></div><p>To: <strong>{request.recipient.displayName}</strong></p><p>Claimed purpose: {request.recipient.claimedPurpose}</p>
                {request.origin === "scripted_fallback" && <Badge text="Request from scripted fallback" />}
                {request.inspection && <><p>{request.inspection.accountLabel} · {request.inspection.savedPayee ? "Saved payee" : "New payee"}</p><ul>{request.inspection.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></>}
                <div className={s.row}>
                  {!request.inspected && <Button text="Inspect request" disabled={busy || !can({ type: "inspect_payment", requestId: request.requestId })} onClick={() => void act({ type: "inspect_payment", requestId: request.requestId })} />}
                  {can({ type: "approve_payment", requestId: request.requestId }) && <Dialog triggerText="Approve transfer…" title="Approve this fictional transfer?" description={`${request.amount} credits will be sent to ${request.recipient.displayName}. This is a consequential game decision.`} open={confirm === request.requestId} onOpenChange={open => { if (!busy) setConfirm(open ? request.requestId : undefined); }} footer={<Button text="Confirm approval" variant="danger" loading={busy} onClick={() => void act({ type: "approve_payment", requestId: request.requestId })} />}><p>Check the recipient and verify the request through a trusted contact before deciding.</p></Dialog>}
                  {request.status === "pending" && <Button text="Reject request" variant="secondary" disabled={busy || !can({ type: "reject_payment", requestId: request.requestId })} onClick={() => void act({ type: "reject_payment", requestId: request.requestId })} />}
                </div>
              </div></section>)}
              <h3>Recent activity</h3><ul className={s.list}>{view.bank.transactions.map(tx => <li key={tx.transactionId} className={s.row}><div><strong>{tx.counterparty}</strong><p className={s.muted}>{tx.description} · {tx.date}</p></div><span>{tx.direction === "debit" ? "−" : "+"}{tx.amount} credits</span></li>)}</ul>
            </div>
          </Card></div>
          <div className={s.panel} data-visible={tab === "Contacts"}><Card title="Your trusted contacts" description="An independent route. Supplied by your directory, not the message sender.">
            <div className={s.stack}>{view.contacts.map(contact => <div className={s.stack} key={contact.contactId}><strong>{contact.name}</strong><p>{contact.phone}</p><p className={s.muted}>{contact.source}</p><Button text="Verify through official line" loading={busy && tab === "Contacts"} disabled={busy || !can({ type: "verify_trusted_contact", contactId: contact.contactId })} onClick={() => void act({ type: "verify_trusted_contact", contactId: contact.contactId })} /></div>)}
              {view.verification.status === "verified" && <section aria-label="Verification result"><Badge text="Verified through trusted contact" tone="success" /><ul className={s.list}>{view.verification.facts.map(fact => <li key={fact.factId}>{fact.text}</li>)}</ul><p className={s.muted}>Evidence: {view.verification.eventId}</p></section>}
            </div>
          </Card></div>
        </div>
      </div>
      {view.outcome && <Card title={view.outcome.kind === "loss" ? "A transfer went through. Let’s look closer." : view.outcome.kind === "protected" ? "Your garden fund is safe." : "You stepped away safely."}>
        <div className={s.stack}><div className={s.row}><Badge text={view.outcome.fundsLost ? `${view.outcome.amountLost} credits lost` : "No funds lost"} tone={view.outcome.fundsLost ? "danger" : "success"} /><Badge text={view.outcome.secretDisclosed ? "Secret disclosed" : "No secret disclosed"} /><Badge text={view.outcome.verified ? "Independently verified" : "Not independently verified"} /></div>
          <p>One encounter is practice, not a judgment of you.</p>
          <div className={s.row}><Button text="Read your debrief" disabled={busy} onClick={() => void run(async () => setDebrief(await adapter!.debrief(view.sessionId)))} /><Button text="Replay the evidence" variant="secondary" disabled={busy} onClick={() => void run(async () => { const data = await adapter!.replay(view.sessionId); setReplay(data); setSelectedEvent(Math.max(0, data.events.findIndex(e => e.eventId === data.decisiveEventId))); })} />{view.checkpoint.available && <Button text="Retry before the payment decision" variant="secondary" disabled={busy} onClick={() => void run(async () => { const fork = await adapter!.fork(view.sessionId); setView(fork); setDebrief(undefined); setReplay(undefined); setSigns([]); setTab("Contacts"); })} />}</div>
          {view.checkpoint.available && <p className={s.muted}>Creates a separate practice attempt at “{view.checkpoint.label}”. Your original run stays intact.</p>}
        </div>
      </Card>}
      {debrief && <Card title={debrief.headline} description={debrief.isPracticeBranch ? "Coached practice · score belongs to this branch" : "Your encounter debrief"}><div className={s.stack}>
        <p>{debrief.explanation}</p><p><strong>Next time:</strong> {debrief.saferNextAction}</p><p className={s.balance}>{debrief.score.total} / {debrief.score.max}</p>
        <p>Decisive moment: {debrief.decisiveEvent.summary} <span className={s.muted}>({debrief.decisiveEvent.eventId})</span></p>
        <ul className={s.list}>{debrief.score.items.map(item => <li key={item.skillId}><strong>{item.label} · {item.points}/{item.maxPoints}</strong><p>{item.explanation}</p><p className={s.muted}>Evidence: {item.evidenceEventIds.join(", ") || "No event cited"}</p></li>)}</ul>
        <fieldset className={s.stack} disabled={busy || debrief.reflection.submitted}><legend>Optional reflection: which warning signs did you notice?</legend>{debrief.warningSignOptions.map(option => <label key={option.signId}><input type="checkbox" checked={signs.includes(option.signId)} onChange={event => setSigns(previous => event.target.checked ? [...previous, option.signId] : previous.filter(id => id !== option.signId))} /> {option.label}</label>)}<Button text="Save reflection" disabled={busy || !signs.length || !can({ type: "submit_reflection", warningSignIds: signs })} onClick={() => void act({ type: "submit_reflection", warningSignIds: signs })} /></fieldset>
      </div></Card>}
      {replay && <Card title="Replay the evidence" description={replay.reconstruction.matchesStoredState ? "Server reconstruction matches the saved state." : "Reconstruction mismatch reported by server."}><div className={s.workspace}>
        <ol className={s.list}>{replay.events.map((event, index) => <li key={event.eventId}><button className={s.event} aria-pressed={selectedEvent === index} onClick={() => setSelectedEvent(index)}>{event.sequence}. {event.summary}{event.eventId === replay.decisiveEventId && " · Decisive moment"}{event.inherited && " · Inherited"}</button></li>)}</ol>
        {replay.events[selectedEvent] && <div className={s.stack} aria-live="polite"><h3>After event {replay.events[selectedEvent].sequence}</h3><p>{replay.events[selectedEvent].summary}</p><p className={s.balance}>{replay.events[selectedEvent].snapshot.balance.toLocaleString()} credits</p><p>Verification: {replay.events[selectedEvent].snapshot.verified ? "Verified" : "Not yet verified"}</p><p>Encounter: {replay.events[selectedEvent].snapshot.status}</p><p className={s.muted}>{replay.events[selectedEvent].eventId}</p><p>These snapshots come from the server or committed public replay fixture.</p></div>}
      </div></Card>}
      <p className={s.muted}>{view.scenario.fictionalNotice}</p>
    </>}
  </main>;
}

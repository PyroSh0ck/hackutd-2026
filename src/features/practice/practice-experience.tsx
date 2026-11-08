"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/advanced/chat-panel";
import { PageHeader } from "@/components/layouts/kit-layouts";
import { Alert } from "@/components/ui/alert";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ObserverSessionResponseSchema, type ClientEventType, type ObserverSessionView, type Outcome } from "@/contracts/observer";
import { apiRequest, errorMessage } from "@/lib/api-client";

/**
 * Minimal practice UI (planner brief §3–§4): persistent simulation label, conversation, the fixed request
 * card with a cancelable simulated-disclosure confirmation, Verify independently, the official result
 * inside the trusted verification panel, the final-decision controls, End practice, the stop confirmation,
 * a neutral technical notice with one retry, and the outcome. All facts shown come from the server view.
 */

const STORAGE_KEY = "scamper.practice.sessionId";
const OUTCOME_TEXT: Record<Outcome, string> = {
  defense_demonstrated: "You rejected or reported the request. Defense demonstrated.",
  safely_disengaged: "You ended the practice. Safely disengaged.",
  simulated_exposure: "You shared the fictional practice code. Simulated exposure.",
  inconclusive: "The practice reached its turn limit without a decision. Inconclusive.",
  technical_interruption: "The practice stopped because of a technical problem. Nothing was decided.",
};

const readStored = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};
const store = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* per-viewer convenience only */
  }
};

export function PracticeExperience() {
  const [view, setView] = useState<ObserverSessionView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [challengeId, setChallengeId] = useState<string>();
  const [shareOpen, setShareOpen] = useState(false);
  const lock = useRef(false);

  const create = useCallback(async () => {
    const { session } = await apiRequest("/api/observer/sessions", ObserverSessionResponseSchema, { method: "POST" });
    store(session.sessionId);
    return session;
  }, []);

  // Resume after refresh or tab close: the server holds the durable session; the browser only remembers its id.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const stored = readStored();
      let session: ObserverSessionView | undefined;
      if (stored) session = await apiRequest(`/api/observer/sessions/${stored}`, ObserverSessionResponseSchema).then((r) => r.session, () => undefined);
      session ??= await create();
      if (alive) setView(session);
    };
    load().catch((e) => {
      if (alive) setError(errorMessage(e, "Could not start the practice."));
    });
    return () => {
      alive = false;
    };
  }, [create]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e, "That did not work. Try again."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const event = (type: ClientEventType, extra: { requestId?: string | null; challengeId?: string; practiceCode?: string; linkedIssueId?: string } = {}) =>
    run(async () => {
      if (!view) return;
      const r = await apiRequest(`/api/observer/sessions/${view.sessionId}/events`, ObserverSessionResponseSchema, {
        method: "POST",
        body: { idempotencyKey: crypto.randomUUID(), type, requestId: extra.requestId ?? null, ...(extra.challengeId ? { challengeId: extra.challengeId } : {}), ...(extra.practiceCode ? { practiceCode: extra.practiceCode } : {}), ...(extra.linkedIssueId ? { linkedIssueId: extra.linkedIssueId } : {}) },
      });
      if (r.challengeId) setChallengeId(r.challengeId);
      setView(r.session);
    });

  async function send(text: string) {
    if (!view) return;
    const r = await apiRequest(`/api/observer/sessions/${view.sessionId}/messages`, ObserverSessionResponseSchema, { method: "POST", body: { idempotencyKey: crypto.randomUUID(), content: text } });
    setView(r.session);
  }

  const retry = () =>
    run(async () => {
      if (!view) return;
      const r = await apiRequest(`/api/observer/sessions/${view.sessionId}/retry`, ObserverSessionResponseSchema, { method: "POST", body: { idempotencyKey: crypto.randomUUID() } });
      setView(r.session);
    });

  const restart = () =>
    run(async () => {
      store(null);
      setChallengeId(undefined);
      setView(await create());
    });

  if (!view) {
    return (
      <main>
        <PageHeader title="Practice conversation" description="Loading the simulation…" />
        {error && <Alert tone="danger" message={error} />}
      </main>
    );
  }

  const request = view.requests.at(-1);
  const active = view.stage === "active" && !view.stopConfirmationPending;
  const shareDialog = request && view.practiceCode && (
    <AlertDialog
      triggerText="Share practice code"
      title="Share the fictional practice code?"
      description={`This is a simulated disclosure of the fictional practice code ${view.practiceCode}. Nothing real is shared. Cancel to keep it to yourself.`}
      confirmText="Share in simulation"
      open={shareOpen}
      onOpenChange={setShareOpen}
      loading={busy}
      onConfirm={() => {
        setShareOpen(false);
        void event("practice_code_submitted", { requestId: request.id, practiceCode: view.practiceCode! });
      }}
    />
  );

  return (
    <main>
      <PageHeader
        title={`Practice: ${view.scenario.senderName} (fictional)`}
        description={`Simulation · turn ${view.turn} of ${view.maxTurns}`}
        actions={!view.ended ? <Button text="End practice" variant="secondary" disabled={busy} onClick={() => void event("conversation_ended")} /> : <Button text="Start a new practice" onClick={() => void restart()} />}
      />
      <Alert tone="info" title="Simulation" message={view.scenario.simulationNotice} />
      {error && <Alert tone="danger" message={error} onDismiss={() => setError(undefined)} />}

      {view.outcome && (
        <Card title="Practice ended" description={OUTCOME_TEXT[view.outcome]}>
          <Badge text={view.outcome.replaceAll("_", " ")} tone={view.outcome === "defense_demonstrated" || view.outcome === "safely_disengaged" ? "success" : "warning"} />
          <p>What official simulated support says: Cedar Mobile did not start this conversation, and the practice code should not be shared. A claimed support identity never authorizes sharing a verification code.</p>
        </Card>
      )}

      {view.stopConfirmationPending && !view.ended && (
        <Card title="End the practice?" description="It sounded like you might want to stop. Nothing else happens until you choose.">
          <Button text="End practice" onClick={() => void event("conversation_ended")} disabled={busy} />
          <Button text="Keep practicing" variant="secondary" onClick={() => void event("stop_confirmation_dismissed")} disabled={busy} />
        </Card>
      )}

      {view.stage === "verifying" && (
        <Card title="Verify independently: official simulated support" description="This panel is part of the app, not the conversation. The sender cannot see it.">
          <p>{view.verification.officialResult}</p>
          <Button text="I have read this result" onClick={() => void event("official_verification_completed", { challengeId })} disabled={busy || !challengeId} />
          <Button text="Cancel verification" variant="secondary" onClick={() => void event("official_verification_cancelled")} disabled={busy} />
        </Card>
      )}

      {view.stage === "awaiting_final_decision" && (
        <Card title="Your decision" description="The conversation is paused. Official simulated support said this was not Cedar Mobile.">
          <p>{view.verification.officialResult}</p>
          <Button text="Reject and report" onClick={() => void event("conversation_reported")} disabled={busy} />
          {!view.finalDecisionProceeded ? <Button text="Proceed with simulated sharing" variant="secondary" onClick={() => void event("final_decision_proceed")} disabled={busy} /> : shareDialog}
        </Card>
      )}

      {view.stage === "active" && request && view.requestStatus === "pending" && (
        <Card title="Simulated request: share practice code" description={`Fictional practice code: ${view.practiceCode}. Typing digits in chat does not count; only this card does.`}>
          {shareDialog}
          <Button text="Decline request" variant="secondary" onClick={() => void event("request_rejected", { requestId: request.id })} disabled={busy} />
        </Card>
      )}

      {view.stage === "active" && (
        <Card title="Check before you act" description="Independent support is available here at any time. It pauses the conversation.">
          <Button text="Verify independently" variant="secondary" disabled={busy || view.stopConfirmationPending} onClick={() => void event("official_verification_started", view.verificationLinkIssueId ? { linkedIssueId: view.verificationLinkIssueId } : {})} />
          <Button text="Report or block sender" variant="danger" disabled={busy || view.stopConfirmationPending} onClick={() => void event("conversation_reported")} />
        </Card>
      )}

      <ChatPanel
        messages={view.messages.map((m) => ({ id: m.id, role: m.role, text: m.role === "assistant" ? `${view.scenario.senderName} (fictional): ${m.content}` : m.content }))}
        onSend={send}
        disabled={!active || busy}
        error={view.technicalNotice?.message}
        onRetry={view.technicalNotice?.canRetry ? () => void retry() : undefined}
      />
    </main>
  );
}

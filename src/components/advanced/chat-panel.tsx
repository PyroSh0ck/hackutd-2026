"use client";
import { useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import s from "@visual/advanced.module.css";
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: readonly { id: string; label: string; url: string }[];
};
export type ChatPanelProps = {
  messages: readonly ChatMessage[];
  onSend: (text: string) => void | Promise<void>;
  streaming?: boolean;
  onStop?: () => void;
  error?: string;
  onRetry?: () => void;
  disabled?: boolean;
};
function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function ChatPanel({
  messages,
  onSend,
  streaming = false,
  onStop,
  error,
  onRetry,
  disabled = false,
}: ChatPanelProps) {
  const draftId = useId();
  const [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false),
    [localError, setLocalError] = useState<string>();
  const lock = useRef(false);
  const busy = sending || streaming;
  async function send() {
    const text = draft.trim();
    if (!text || busy || disabled || lock.current) return;
    lock.current = true;
    setSending(true);
    setLocalError(undefined);
    try {
      await onSend(text);
      setDraft("");
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "Unable to send message.",
      );
    } finally {
      lock.current = false;
      setSending(false);
    }
  }
  return (
    <section className={s.stack} aria-label="Chat">
      <div
        className={s.messages}
        role="log"
        aria-label="Conversation"
        aria-live={streaming ? "off" : "polite"}
        tabIndex={0}
      >
        {!messages.length && <p>Start a conversation.</p>}
        {messages.map((message) => (
          <article
            key={message.id}
            className={s.message}
            data-role={message.role}
          >
            <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            <p>{message.text}</p>
            {message.citations && (
              <ul>
                {message.citations.map((citation) => {
                  const href = safeUrl(citation.url);
                  return (
                    <li key={citation.id}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {citation.label}
                        </a>
                      ) : (
                        <span>{citation.label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        ))}
      </div>
      {streaming && <p role="status">Assistant is responding…</p>}
      {(error || localError) && (
        <div role="alert">
          {error || localError}
          {onRetry && (
            <Button
              text="Retry response"
              variant="secondary"
              disabled={busy || disabled}
              onClick={onRetry}
            />
          )}
        </div>
      )}
      <form
        className={s.stack}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor={draftId}>Message</label>
        <textarea
          id={draftId}
          className={s.input}
          rows={3}
          value={draft}
          disabled={disabled || busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className={s.row}>
          {streaming && onStop && (
            <Button text="Stop response" variant="secondary" onClick={onStop} />
          )}
          <Button
            text="Send"
            type="submit"
            loading={sending}
            disabled={disabled || streaming || !draft.trim()}
          />
        </div>
      </form>
    </section>
  );
}

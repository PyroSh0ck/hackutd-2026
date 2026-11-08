"use client";
import type { Tone } from "./badge";
import s from "@visual/ui.module.css";
export type AlertProps = {
  title?: string;
  message: string;
  tone?: Tone;
  onDismiss?: () => void;
};
export function Alert({
  title,
  message,
  tone = "info",
  onDismiss,
}: AlertProps) {
  return (
    <div
      className={s.alert}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div>
        {title && <strong>{title}</strong>}
        <p>{message}</p>
      </div>
      {onDismiss && (
        <button
          className={s.textButton}
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

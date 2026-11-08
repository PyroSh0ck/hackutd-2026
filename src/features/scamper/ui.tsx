"use client";

import { RotateCcw, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import s from "./scamper.module.css";

/** Small shared presentational pieces for the SCAMPER views. */

export function InlineError({ message, onRetry, retryLabel = "Try again", onDismiss, children }: { message: string; onRetry?: () => void; retryLabel?: string; onDismiss?: () => void; children?: ReactNode }) {
  return (
    <div className={s.notice} data-tone="error" role="alert">
      <TriangleAlert size={20} aria-hidden />
      <div className={s.noticeBody}>
        <span>{message}</span>
        {(onRetry || children) && (
          <div className={s.row}>
            {onRetry && (
              <button type="button" className={s.button} data-variant="secondary" onClick={onRetry}>
                <RotateCcw size={16} aria-hidden />
                {retryLabel}
              </button>
            )}
            {children}
          </div>
        )}
      </div>
      {onDismiss && (
        <button type="button" className={s.button} data-variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "success" | "error" | "neutral" }) {
  return (
    <span className={s.badge} data-tone={tone}>
      {children}
    </span>
  );
}

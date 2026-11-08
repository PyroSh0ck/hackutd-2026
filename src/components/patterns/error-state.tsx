"use client";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import s from "@visual/ui.module.css";
export type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
};
export function ErrorState({
  message,
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  return (
    <div className={s.field}>
      <Alert title="Something went wrong" message={message} tone="danger" />
      {onRetry && (
        <Button
          text="Try again"
          variant="secondary"
          loading={retrying}
          onClick={onRetry}
        />
      )}
    </div>
  );
}

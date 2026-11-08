"use client";
import { AlertDialog as Primitive } from "radix-ui";
import { Button } from "./button";
import s from "@visual/ui.module.css";
export type AlertDialogProps = {
  triggerText: string;
  title: string;
  description: string;
  confirmText: string;
  cancelText?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading?: boolean;
  error?: string;
  destructive?: boolean;
};
// Parent closes after successful work. Rejection/error leaves the dialog open.
export function AlertDialog({
  triggerText,
  title,
  description,
  confirmText,
  cancelText = "Cancel",
  open,
  onOpenChange,
  onConfirm,
  loading = false,
  error,
  destructive = true,
}: AlertDialogProps) {
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next);
      }}
    >
      <Primitive.Trigger
        className={s.button}
        data-variant={destructive ? "danger" : "secondary"}
      >
        {triggerText}
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Overlay className={s.overlay} />
        <Primitive.Content className={s.dialog}>
          <Primitive.Title className={s.heading}>{title}</Primitive.Title>
          <Primitive.Description className={s.muted}>
            {description}
          </Primitive.Description>
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <div className={s.actions}>
            <Primitive.Cancel
              className={s.button}
              data-variant="secondary"
              disabled={loading}
            >
              {cancelText}
            </Primitive.Cancel>
            <Button
              text={confirmText}
              variant={destructive ? "danger" : "primary"}
              loading={loading}
              onClick={onConfirm}
            />
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

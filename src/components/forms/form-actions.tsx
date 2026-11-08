"use client";
import { Button } from "../ui/button";
import s from "@visual/ui.module.css";
export type FormActionsProps = {
  submitText?: string;
  loadingText?: string;
  loading?: boolean;
  disabled?: boolean;
  form?: string;
  cancelText?: string;
  onCancel?: () => void;
};
export function FormActions({
  submitText = "Save",
  loadingText = "Saving…",
  loading = false,
  disabled = false,
  form,
  cancelText = "Cancel",
  onCancel,
}: FormActionsProps) {
  return (
    <div className={s.actions}>
      {onCancel && (
        <Button
          text={cancelText}
          variant="secondary"
          disabled={loading}
          onClick={onCancel}
        />
      )}
      <Button
        text={submitText}
        loadingText={loadingText}
        type="submit"
        form={form}
        loading={loading}
        disabled={disabled}
      />
    </div>
  );
}

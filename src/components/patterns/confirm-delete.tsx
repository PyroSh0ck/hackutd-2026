"use client";

import { useState } from "react";
import { AlertDialog } from "../ui/alert-dialog";

export type ConfirmDeleteProps = {
  /** Display name of the item being deleted, shown in the confirmation. */
  itemName: string;
  /** Resource label, e.g. "project". */
  resourceLabel: string;
  /** Performs the deletion. Reject to keep the dialog open with an error. */
  onConfirm: () => Promise<void>;
  /** Called after a successful deletion and close. */
  onDeleted?: () => void;
  /** Turns a thrown value into a user-facing message. */
  describeError?: (error: unknown) => string;
};

/** Delete trigger + confirmation that owns loading, error, and close-on-success. */
export function ConfirmDelete({
  itemName,
  resourceLabel,
  onConfirm,
  onDeleted,
  describeError = (error) => (error instanceof Error ? error.message : "Delete failed."),
}: ConfirmDeleteProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function confirm() {
    setLoading(true);
    setError(undefined);
    try {
      await onConfirm();
      setOpen(false);
      onDeleted?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog
      triggerText="Delete"
      title={`Delete ${resourceLabel}?`}
      description={`“${itemName}” will be permanently deleted.`}
      confirmText={`Delete ${resourceLabel}`}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(undefined);
      }}
      onConfirm={confirm}
      loading={loading}
      error={error}
    />
  );
}

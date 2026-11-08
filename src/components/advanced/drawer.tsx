"use client";
import type { ReactNode } from "react";
import { Dialog } from "radix-ui";
import s from "@visual/advanced.module.css";
export type DrawerProps = {
  triggerText: string;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
};
export function Drawer({
  triggerText,
  title,
  description,
  open,
  onOpenChange,
  children,
  footer,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger className={s.button}>{triggerText}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.drawer}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <div className={s.stack}>{children}</div>
          {footer}
          <Dialog.Close className={s.button}>Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

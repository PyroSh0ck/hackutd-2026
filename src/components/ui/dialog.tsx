"use client";
import type { ReactNode } from "react";
import { Dialog as Primitive } from "radix-ui";
import s from "@visual/ui.module.css";
export type DialogProps = {
  triggerText: string;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
};
export function Dialog({
  triggerText,
  title,
  description,
  open,
  onOpenChange,
  children,
  footer,
}: DialogProps) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Trigger className={s.button} data-variant="secondary">
        {triggerText}
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Overlay className={s.overlay} />
        <Primitive.Content className={s.dialog}>
          <Primitive.Title className={s.heading}>{title}</Primitive.Title>
          <Primitive.Description className={s.muted}>
            {description}
          </Primitive.Description>
          {children}
          {footer && <footer className={s.footer}>{footer}</footer>}
          <Primitive.Close className={s.textButton}>Close</Primitive.Close>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

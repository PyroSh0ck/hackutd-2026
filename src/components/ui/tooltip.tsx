"use client";
import { Tooltip as Primitive } from "radix-ui";
import s from "@visual/ui.module.css";
// Dedicated focusable help trigger: does not rely on prop forwarding through Button.
export type TooltipProps = { text: string; triggerText?: string };
export function Tooltip({
  text,
  triggerText = "More information",
}: TooltipProps) {
  return (
    <Primitive.Provider delayDuration={250}>
      <Primitive.Root>
        <Primitive.Trigger className={s.textButton}>
          {triggerText}
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content className={s.tooltip} sideOffset={6}>
            {text}
            <Primitive.Arrow />
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}

"use client";
import type { ReactNode } from "react";
import { Tabs as Primitive } from "radix-ui";
import s from "@visual/ui.module.css";
export type TabItem = {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
};
export type TabsProps = {
  label: string;
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
};
export function Tabs({ label, items, value, onValueChange }: TabsProps) {
  return (
    <Primitive.Root
      value={value}
      onValueChange={onValueChange}
      activationMode="manual"
    >
      <Primitive.List className={s.tabList} aria-label={label}>
        {items.map((item) => (
          <Primitive.Trigger
            className={s.tab}
            key={item.value}
            value={item.value}
            disabled={item.disabled}
          >
            {item.label}
          </Primitive.Trigger>
        ))}
      </Primitive.List>
      {items.map((item) => (
        <Primitive.Content
          className={s.tabPanel}
          key={item.value}
          value={item.value}
        >
          {item.content}
        </Primitive.Content>
      ))}
    </Primitive.Root>
  );
}

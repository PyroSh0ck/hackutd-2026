"use client";
import type { ReactNode } from "react";
import { Accordion as Primitive } from "radix-ui";
import s from "@visual/advanced.module.css";
export type AccordionItem = {
  id: string;
  title: string;
  content: ReactNode;
  disabled?: boolean;
};
export type AccordionProps = {
  items: readonly AccordionItem[];
  defaultOpenIds?: string[];
};
export function Accordion({ items, defaultOpenIds = [] }: AccordionProps) {
  return (
    <Primitive.Root
      type="multiple"
      defaultValue={defaultOpenIds}
      className={s.stack}
    >
      {items.map((item) => (
        <Primitive.Item
          className={s.panel}
          key={item.id}
          value={item.id}
          disabled={item.disabled}
        >
          <Primitive.Header>
            <Primitive.Trigger className={s.accordionTrigger}>
              {item.title}
              <span aria-hidden="true">+</span>
            </Primitive.Trigger>
          </Primitive.Header>
          <Primitive.Content className={s.accordionContent}>
            {item.content}
          </Primitive.Content>
        </Primitive.Item>
      ))}
    </Primitive.Root>
  );
}

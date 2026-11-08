"use client";
import { DropdownMenu as Primitive } from "radix-ui";
import { Icon, type ButtonIcon } from "./icon";
import s from "@visual/ui.module.css";
export type MenuItem = {
  id: string;
  text: string;
  icon?: ButtonIcon;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
};
export type DropdownMenuProps = {
  triggerText: string;
  items: readonly MenuItem[];
  disabled?: boolean;
};
export function DropdownMenu({
  triggerText,
  items,
  disabled,
}: DropdownMenuProps) {
  return (
    <Primitive.Root>
      <Primitive.Trigger
        className={s.button}
        data-variant="secondary"
        disabled={disabled}
      >
        {triggerText}
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content className={s.menu} sideOffset={6}>
          {items.map((item) => (
            <Primitive.Item
              key={item.id}
              className={s.menuItem}
              data-destructive={item.destructive || undefined}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              {item.icon && <Icon name={item.icon} />}
              {item.text}
            </Primitive.Item>
          ))}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

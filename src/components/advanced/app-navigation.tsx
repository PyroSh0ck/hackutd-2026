"use client";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { DropdownMenu, type MenuItem } from "../ui/dropdown-menu";
import s from "@visual/advanced.module.css";
export type NavigationItem = { id: string; label: string; href: string };
export type AppNavigationProps = {
  appName: string;
  items: readonly NavigationItem[];
  activeId: string;
  account?: { name: string; actions: readonly MenuItem[] };
};
export function AppNavigation({
  appName,
  items,
  activeId,
  account,
}: AppNavigationProps) {
  const [open, setOpen] = useState(false);
  const links = (mobile = false) => (
    <nav
      aria-label={mobile ? "Mobile navigation" : "Main navigation"}
      className={s.navLinks}
    >
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          aria-current={item.id === activeId ? "page" : undefined}
          onClick={() => setOpen(false)}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
  return (
    <>
      <aside className={s.desktopNav}>
        <strong>{appName}</strong>
        {links()}
        {account && (
          <DropdownMenu triggerText={account.name} items={account.actions} />
        )}
      </aside>
      <div className={s.mobileNav}>
        <strong>{appName}</strong>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger className={s.button}>Menu</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className={s.overlay} />
            <Dialog.Content className={s.drawer}>
              <Dialog.Title>{appName}</Dialog.Title>
              <Dialog.Description>
                Choose a page or account action.
              </Dialog.Description>
              {links(true)}
              {account && (
                <DropdownMenu
                  triggerText={account.name}
                  items={account.actions}
                />
              )}
              <Dialog.Close className={s.button}>Close menu</Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </>
  );
}

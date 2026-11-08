import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  /** Omit when the page renders its own PageHeader (kit layouts). */
  title?: string;
  actions?: ReactNode;
};

export function AppShell({ children, title, actions }: AppShellProps) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {(title || actions) && (
        <header className="mb-6 flex items-center justify-between gap-4">
          {title && <h1 className="text-2xl font-semibold">{title}</h1>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}

      <main>{children}</main>
    </div>
  );
}

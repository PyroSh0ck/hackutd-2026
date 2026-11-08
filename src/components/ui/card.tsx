import type { ReactNode } from "react";
import s from "@visual/ui.module.css";
export type CardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
};
export function Card({
  title,
  description,
  children,
  actions,
  footer,
}: CardProps) {
  return (
    <section className={s.card}>
      {(title || description || actions) && (
        <header className={s.row}>
          <div>
            {title && <h2 className={s.heading}>{title}</h2>}
            {description && <p className={s.muted}>{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div>{children}</div>
      {footer && <footer className={s.footer}>{footer}</footer>}
    </section>
  );
}

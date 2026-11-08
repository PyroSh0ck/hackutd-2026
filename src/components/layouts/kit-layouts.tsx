import type { ReactNode } from "react";
import s from "@visual/layouts.module.css";
export type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={s.header}>
      <div>
        <h1 className={s.title}>{title}</h1>
        {description && <p className={s.description}>{description}</p>}
      </div>
      {actions}
    </header>
  );
}
export type ListLayoutProps = PageHeaderProps & {
  toolbar?: ReactNode;
  children: ReactNode;
  pagination?: ReactNode;
};
export function ListLayout({
  title,
  description,
  actions,
  toolbar,
  children,
  pagination,
}: ListLayoutProps) {
  return (
    <div className={s.stack}>
      <PageHeader title={title} description={description} actions={actions} />
      {toolbar}
      {children}
      {pagination}
    </div>
  );
}
export type SplitLayoutProps = { primary: ReactNode; secondary: ReactNode };
export function SplitLayout({ primary, secondary }: SplitLayoutProps) {
  return (
    <div className={s.split}>
      <div className={s.stack}>{primary}</div>
      <aside className={s.stack}>{secondary}</aside>
    </div>
  );
}
export type DetailLayoutProps = PageHeaderProps & {
  children: ReactNode;
  sidebar?: ReactNode;
};
export function DetailLayout({
  title,
  description,
  actions,
  children,
  sidebar,
}: DetailLayoutProps) {
  return (
    <div className={s.stack}>
      <PageHeader title={title} description={description} actions={actions} />
      {sidebar ? (
        <SplitLayout primary={children} secondary={sidebar} />
      ) : (
        children
      )}
    </div>
  );
}
export type DashboardLayoutProps = PageHeaderProps & {
  stats: ReactNode;
  children: ReactNode;
};
export function DashboardLayout({
  title,
  description,
  actions,
  stats,
  children,
}: DashboardLayoutProps) {
  return (
    <div className={s.stack}>
      <PageHeader title={title} description={description} actions={actions} />
      <div className={s.grid}>{stats}</div>
      {children}
    </div>
  );
}

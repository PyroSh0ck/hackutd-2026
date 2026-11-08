"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useId, useState, type ReactNode } from "react";
import { BookOpen, Folder, House, Menu, MessageCircle, Sparkle, X } from "lucide-react";
import { Mascot } from "./mascot";
import s from "./scamper.module.css";

const NAV = [
  { href: "/scamper", label: "Home", icon: House, exact: true },
  { href: "/scamper/practice", label: "Practice", icon: MessageCircle },
  { href: "/scamper/history", label: "Case history", icon: Folder },
  { href: "/scamper/resources", label: "Resources", icon: BookOpen },
] as const;

function Wordmark() {
  return (
    <span className={s.wordmark}>
      Cyber Sleuth
      <Sparkle className={s.wordmarkMark} aria-hidden strokeWidth={3} />
    </span>
  );
}

function CurrentNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList path={usePathname()} onNavigate={onNavigate} />;
}

/** The pathname read suspends under dynamic routes, so it sits in its own boundary with a plain fallback. */
export function PrimaryNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList path="" onNavigate={onNavigate} />}>
      <CurrentNavigation onNavigate={onNavigate} />
    </Suspense>
  );
}

function NavList({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary">
      <ul className={s.nav}>
        {NAV.map(({ href, label, icon: Icon, ...rest }) => {
          const current = "exact" in rest ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link className={s.navLink} href={href} aria-current={current ? "page" : undefined} onClick={onNavigate}>
                <Icon size={20} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shared shell for every SCAMPER view: sidebar navigation on desktop/tablet, a compact top bar on mobile. */
export function ScamperShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  return (
    <div className={s.app}>
      <div className={s.shell}>
        <header className={s.topbar}>
          <Link href="/scamper" className={s.brand} aria-label="Cyber Sleuth home">
            <Wordmark />
          </Link>
          <button type="button" className={s.iconButton} aria-expanded={menuOpen} aria-controls={menuId} aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </header>
        <aside id={menuId} className={s.sidebar} data-open={menuOpen || undefined}>
          <Link href="/scamper" className={s.brand} aria-label="Cyber Sleuth home">
            <Wordmark />
            <p className={s.tagline}>Practice spotting customer scams</p>
          </Link>
          <div className={s.sidebarMascot}>
            <Mascot size={132} />
          </div>
          <PrimaryNavigation onNavigate={() => setMenuOpen(false)} />
        </aside>
        <div className={s.content}>{children}</div>
      </div>
    </div>
  );
}

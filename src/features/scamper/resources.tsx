import { BookOpen, ExternalLink } from "lucide-react";
import s from "./scamper.module.css";

/** Verified educational links only. General guidance lives here, never as hints inside an active practice. */
const RESOURCES = [
  {
    title: "What To Do if You Were Scammed",
    source: "Federal Trade Commission (consumer.ftc.gov)",
    href: "https://consumer.ftc.gov/articles/what-do-if-you-were-scammed",
    summary: "Steps to take depending on how you paid or what you shared, and how to report it.",
  },
] as const;

export function ResourcesView() {
  return (
    <main className={s.page}>
      <h1 className={s.title}>Resources</h1>
      <p className={s.lede}>Trusted guidance for real situations.</p>
      <ul className={s.list}>
        {RESOURCES.map((r) => (
          <li key={r.href} className={s.card}>
            <h2 className={s.cardTitle}>
              <BookOpen size={20} className={s.iconAccent} aria-hidden />
              {r.title}
            </h2>
            <p className={s.muted}>{r.summary}</p>
            <a className={s.extLink} href={r.href} target="_blank" rel="noopener noreferrer">
              Read on {r.source}
              <ExternalLink size={14} aria-hidden style={{ marginLeft: 6, verticalAlign: "-2px" }} />
              <span className={s.srOnly}> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <div className={s.noteCard}>
        <h2 className={s.cardTitle}>A habit worth keeping</h2>
        <p>When a message asks you to act, pause and contact the company through a number or app you found yourself, not one the message gave you. Real support will not ask you to read back a verification code.</p>
      </div>
    </main>
  );
}

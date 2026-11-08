import Link from "next/link";
import s from "@visual/ui.module.css";

export type TextLinkProps = {
  text: string;
  /** Internal app path only, e.g. "/projects/abc". */
  href: `/${string}`;
  /** Accessible name when `text` alone is ambiguous (e.g. many "Open" links). */
  label?: string;
};

/** Internal navigation link with shared styling. */
export function TextLink({ text, href, label }: TextLinkProps) {
  return (
    <Link href={href} className={s.textButton} aria-label={label}>
      {text}
    </Link>
  );
}

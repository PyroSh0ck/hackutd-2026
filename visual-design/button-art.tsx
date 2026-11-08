// Designer-owned. Decorative artwork rendered inside every <Button>.
// Rules: stay aria-hidden, never receive pointer events, never become interactive.
// Swap this markup per variant (e.g. Procreate PNG/SVG layers) freely — Button's
// behavior, ref, and public props live in src/components/ui/button.tsx.
import s from "./ui.module.css";

export type ButtonArtVariant = "primary" | "secondary" | "ghost" | "danger";

export function ButtonArt({ variant }: { variant: ButtonArtVariant }) {
  return <span className={s.buttonArt} data-variant={variant} aria-hidden="true" />;
}

import s from "@visual/ui.module.css";
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
export type BadgeProps = { text: string; tone?: Tone };
export function Badge({ text, tone = "neutral" }: BadgeProps) {
  return (
    <span className={s.badge} data-tone={tone}>
      {text}
    </span>
  );
}

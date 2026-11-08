import s from "@visual/ui.module.css";
export type SpinnerProps = { label?: string; decorative?: boolean };
export function Spinner({
  label = "Loading",
  decorative = false,
}: SpinnerProps) {
  return (
    <span
      className={s.spinnerWrap}
      role={decorative ? undefined : "status"}
      aria-hidden={decorative || undefined}
    >
      <span className={s.spinner} />
      {!decorative && <span className={s.srOnly}>{label}</span>}
    </span>
  );
}

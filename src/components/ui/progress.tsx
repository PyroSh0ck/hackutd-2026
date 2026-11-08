import s from "@visual/ui.module.css";
export type ProgressProps = { label: string; value?: number; max?: number };
export function Progress({ label, value, max = 100 }: ProgressProps) {
  const limit = Number.isFinite(max) && max > 0 ? max : 100;
  const current =
    value === undefined || !Number.isFinite(value)
      ? undefined
      : Math.min(limit, Math.max(0, value));
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      <progress className={s.progress} value={current} max={limit} />
    </label>
  );
}

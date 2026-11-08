import s from "@visual/ui.module.css";
export type SkeletonProps = {
  kind?: "text" | "avatar" | "card";
  lines?: number;
};
export function Skeleton({ kind = "text", lines = 3 }: SkeletonProps) {
  const count = Number.isFinite(lines)
    ? Math.min(20, Math.max(1, Math.floor(lines)))
    : 3;
  return (
    <div aria-hidden="true" className={s.skeletonGroup}>
      {Array.from({ length: kind === "text" ? count : 1 }, (_, i) => (
        <span key={i} className={s.skeleton} data-kind={kind} />
      ))}
    </div>
  );
}

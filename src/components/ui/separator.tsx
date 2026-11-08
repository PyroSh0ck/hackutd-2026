import s from "@visual/ui.module.css";
export type SeparatorProps = {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
};
export function Separator({
  orientation = "horizontal",
  decorative = true,
}: SeparatorProps) {
  return (
    <div
      className={s.separator}
      data-orientation={orientation}
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
    />
  );
}

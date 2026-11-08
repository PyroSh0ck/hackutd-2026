import { Card } from "../ui/card";
import s from "@visual/ui.module.css";
export type StatCardProps = {
  label: string;
  value: string | number;
  description?: string;
};
export function StatCard({ label, value, description }: StatCardProps) {
  return (
    <Card title={label}>
      <strong className={s.heading}>{value}</strong>
      {description && <p className={s.muted}>{description}</p>}
    </Card>
  );
}

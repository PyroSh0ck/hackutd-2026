import s from "@visual/ui.module.css";

export type FieldListItem = { label: string; value: string | number | null };

export type FieldListProps = { items: readonly FieldListItem[] };

/** Read-only label/value pairs for a record. Null values render as an em dash. */
export function FieldList({ items }: FieldListProps) {
  if (items.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className={s.muted}>{item.label}</dt>
          <dd className="m-0 whitespace-pre-wrap break-words">{item.value === null || item.value === "" ? "—" : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

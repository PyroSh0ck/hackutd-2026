import type { ReactNode } from "react";
import s from "@visual/ui.module.css";
export type TableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
};
export type TableProps<T> = {
  caption: string;
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  emptyText?: string;
};
export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  emptyText = "No results.",
}: TableProps<T>) {
  return (
    <div
      className={s.tableScroll}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className={s.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.cell(row)}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={Math.max(1, columns.length)}>{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

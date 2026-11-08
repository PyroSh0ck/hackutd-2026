"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Checkbox } from "../ui/checkbox";
import { TextField } from "../forms/text-field";
import { Pagination } from "../ui/pagination";
import { DropdownMenu, type MenuItem } from "../ui/dropdown-menu";
import s from "@visual/advanced.module.css";
export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
  searchValue?: (row: T) => string;
};
export type DataTableProps<T> = {
  caption: string;
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  selection?: { ids: readonly string[]; onChange: (ids: string[]) => void };
  rowActions?: (row: T) => readonly MenuItem[];
};
export function DataTable<T>({
  caption,
  rows,
  columns,
  rowKey,
  pageSize = 10,
  loading = false,
  error,
  onRetry,
  selection,
  rowActions,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>();
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    let result = rows.filter(
      (row) =>
        !query.trim() ||
        columns.some((column) =>
          (column.searchValue?.(row) ?? String(column.sortValue?.(row) ?? ""))
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ),
    );
    const column = columns.find((c) => c.id === sort?.id);
    if (column?.sortValue && sort) {
      const getter = column.sortValue;
      result = [...result].sort((a, b) => {
        const av = getter(a),
          bv = getter(b);
        const order =
          av === null
            ? bv === null
              ? 0
              : 1
            : bv === null
              ? -1
              : typeof av === "number" && typeof bv === "number"
                ? av - bv
                : String(av).localeCompare(String(bv));
        return sort.direction === "asc" ? order : -order;
      });
    }
    return result;
  }, [rows, columns, query, sort]);
  const size = Number.isFinite(pageSize)
    ? Math.max(1, Math.floor(pageSize))
    : 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * size, current * size);
  const selected = new Set(selection?.ids ?? []);
  const all =
    visible.length > 0 && visible.every((row) => selected.has(rowKey(row)));
  const some = visible.some((row) => selected.has(rowKey(row)));
  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    selection?.onChange([...next]);
  }
  return (
    <section className={s.stack} aria-label={caption} aria-busy={loading}>
      <TextField
        label={`Search ${caption}`}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
      />
      {loading ? (
        <p role="status">Loading data…</p>
      ) : error ? (
        <div role="alert">
          {error}
          {onRetry && (
            <button className={s.button} type="button" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className={s.tableScroll}
            role="region"
            aria-label={`${caption} table`}
            tabIndex={0}
          >
            <table className={s.table}>
              <caption>{caption}</caption>
              <thead>
                <tr>
                  {selection && (
                    <th scope="col">
                      <Checkbox
                        label="Select page"
                        checked={all ? true : some ? "indeterminate" : false}
                        onCheckedChange={(checked) => {
                          const next = new Set(selected);
                          visible.forEach((row) => {
                            if (checked) next.add(rowKey(row));
                            else next.delete(rowKey(row));
                          });
                          selection.onChange([...next]);
                        }}
                      />
                    </th>
                  )}
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={
                        sort?.id === column.id
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          className={s.button}
                          onClick={() => {
                            setSort({
                              id: column.id,
                              direction:
                                sort?.id === column.id &&
                                sort.direction === "asc"
                                  ? "desc"
                                  : "asc",
                            });
                            setPage(1);
                          }}
                        >
                          {column.header}
                          {sort?.id === column.id
                            ? sort.direction === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  ))}
                  {rowActions && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((row) => (
                    <tr key={rowKey(row)}>
                      {selection && (
                        <td>
                          <Checkbox
                            label={`Select row ${rowKey(row)}`}
                            checked={selected.has(rowKey(row))}
                            onCheckedChange={(checked) =>
                              toggle(rowKey(row), checked)
                            }
                          />
                        </td>
                      )}
                      {columns.map((column) => (
                        <td key={column.id}>{column.cell(row)}</td>
                      ))}
                      {rowActions && (
                        <td>
                          <DropdownMenu
                            triggerText={`Actions for ${rowKey(row)}`}
                            items={rowActions(row)}
                          />
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={
                        columns.length +
                          Number(Boolean(selection)) +
                          Number(Boolean(rowActions)) || 1
                      }
                    >
                      No results.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p>
            {filtered.length} results
            {selection ? ` · ${selection.ids.length} selected` : ""}
          </p>
          <Pagination
            page={current}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}

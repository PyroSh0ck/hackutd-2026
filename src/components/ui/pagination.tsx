"use client";
import { Button } from "./button";
import s from "@visual/ui.module.css";
export type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
};
export function Pagination({
  page,
  pageCount,
  onPageChange,
  disabled = false,
}: PaginationProps) {
  const total = Number.isFinite(pageCount)
    ? Math.max(1, Math.floor(pageCount))
    : 1;
  const current = Number.isFinite(page)
    ? Math.min(total, Math.max(1, Math.floor(page)))
    : 1;
  return (
    <nav className={s.actions} aria-label="Pagination">
      <Button
        text="Previous"
        variant="secondary"
        leadingIcon="arrow-left"
        disabled={disabled || current <= 1}
        onClick={() => onPageChange(current - 1)}
      />
      <span aria-live="polite">
        Page {current} of {total}
      </span>
      <Button
        text="Next"
        variant="secondary"
        trailingIcon="arrow-right"
        disabled={disabled || current >= total}
        onClick={() => onPageChange(current + 1)}
      />
    </nav>
  );
}

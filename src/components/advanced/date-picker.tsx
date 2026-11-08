"use client";
import { useId } from "react";
import s from "@visual/advanced.module.css";
export type DatePickerProps = {
  label: string;
  value: string;
  onValueChange: (date: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  error?: string;
};
// Values are calendar strings YYYY-MM-DD, never converted through UTC Date objects.
export function DatePicker({
  label,
  value,
  onValueChange,
  min,
  max,
  required,
  disabled,
  name,
  error,
}: DatePickerProps) {
  const id = useId();
  return (
    <div className={s.stack}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="date"
        className={s.input}
        value={value}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        name={name}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export type DateRange = { start: string; end: string };
export type DateRangePickerProps = {
  label: string;
  value: DateRange;
  onValueChange: (range: DateRange) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
};
export function DateRangePicker({
  label,
  value,
  onValueChange,
  min,
  max,
  disabled,
}: DateRangePickerProps) {
  const invalid = Boolean(value.start && value.end && value.start > value.end);
  return (
    <fieldset className={s.stack} disabled={disabled}>
      <legend>{label}</legend>
      <div className={s.grid}>
        <DatePicker
          label="Start date"
          value={value.start}
          onValueChange={(start) => onValueChange({ ...value, start })}
          min={min}
          max={value.end && (!max || value.end < max) ? value.end : max}
        />
        <DatePicker
          label="End date"
          value={value.end}
          onValueChange={(end) => onValueChange({ ...value, end })}
          min={value.start && (!min || value.start > min) ? value.start : min}
          max={max}
        />
      </div>
      {invalid && <p role="alert">End date must be on or after start date.</p>}
    </fieldset>
  );
}

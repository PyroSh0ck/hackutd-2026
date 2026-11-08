"use client";
import { useId } from "react";
import s from "@visual/ui.module.css";
export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Validation message shown below the control; also marks it invalid. */
  error?: string;
};
export function Select({
  label,
  options,
  value,
  onValueChange,
  placeholder,
  id,
  name,
  disabled,
  required,
  invalid,
  describedBy,
  error,
}: SelectProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const errorId = error ? `${fieldId}-error` : undefined;
  const description = [describedBy, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={fieldId}>
        {label}
      </label>
      <select
        className={s.control}
        id={fieldId}
        name={name}
        value={value}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || Boolean(error) || undefined}
        aria-describedby={description}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} role="alert" className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}

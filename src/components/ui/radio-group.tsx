"use client";
import { useId } from "react";
import type { SelectOption } from "./select";
import s from "@visual/ui.module.css";
export type RadioGroupProps = {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  describedBy?: string;
};
export function RadioGroup({
  label,
  options,
  value,
  onValueChange,
  name,
  disabled,
  required,
  describedBy,
}: RadioGroupProps) {
  const generated = useId();
  return (
    <fieldset
      className={s.field}
      disabled={disabled}
      aria-describedby={describedBy}
    >
      <legend className={s.label}>{label}</legend>
      {options.map((option) => (
        <label className={s.choice} key={option.value}>
          <input
            type="radio"
            name={name ?? generated}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            required={required}
            onChange={() => onValueChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

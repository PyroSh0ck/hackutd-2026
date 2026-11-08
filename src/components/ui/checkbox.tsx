"use client";
import { useId, useEffect, useRef } from "react";
import s from "@visual/ui.module.css";
export type CheckboxProps = {
  label: string;
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  required?: boolean;
  describedBy?: string;
};
export function Checkbox({
  label,
  checked,
  onCheckedChange,
  id,
  name,
  value,
  disabled,
  required,
  describedBy,
}: CheckboxProps) {
  const generated = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === "indeterminate";
  }, [checked]);
  return (
    <label className={s.choice} htmlFor={id ?? generated}>
      <input
        ref={ref}
        id={id ?? generated}
        type="checkbox"
        name={name}
        value={value}
        checked={checked === true}
        disabled={disabled}
        required={required}
        aria-describedby={describedBy}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

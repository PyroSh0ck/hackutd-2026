"use client";
import { useId } from "react";
import s from "@visual/ui.module.css";
export type SwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  describedBy?: string;
};
export function Switch({
  label,
  checked,
  onCheckedChange,
  id,
  name,
  disabled,
  describedBy,
}: SwitchProps) {
  const generated = useId();
  return (
    <label className={s.choice} htmlFor={id ?? generated}>
      <input
        className={s.switch}
        id={id ?? generated}
        type="checkbox"
        role="switch"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

"use client";
import type { InputHTMLAttributes, Ref } from "react";
import s from "@visual/ui.module.css";
export type InputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | "type"
  | "min"
  | "max"
  | "step"
  | "pattern"
  | "inputMode"
  | "id"
  | "name"
  | "value"
  | "defaultValue"
  | "onChange"
  | "onBlur"
  | "disabled"
  | "required"
  | "readOnly"
  | "placeholder"
  | "autoComplete"
  | "minLength"
  | "maxLength"
> & { invalid?: boolean; describedBy?: string; ref?: Ref<HTMLInputElement> };
export function Input({
  invalid = false,
  describedBy,
  ref,
  ...props
}: InputProps) {
  return (
    <input
      {...props}
      ref={ref}
      className={s.control}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  );
}

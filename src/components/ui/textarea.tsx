"use client";
import type { TextareaHTMLAttributes, Ref } from "react";
import s from "@visual/ui.module.css";
export type TextareaProps = Pick<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  | "rows"
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
> & { invalid?: boolean; describedBy?: string; ref?: Ref<HTMLTextAreaElement> };
export function Textarea({
  invalid = false,
  describedBy,
  ref,
  ...props
}: TextareaProps) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={s.control}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  );
}

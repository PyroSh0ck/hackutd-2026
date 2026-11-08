"use client";
import { useId } from "react";
import { Textarea, type TextareaProps } from "../ui/textarea";
import { Label } from "../ui/label";
import s from "@visual/ui.module.css";
export type TextareaFieldProps = TextareaProps & {
  label: string;
  hint?: string;
  error?: string;
};
export function TextareaField({
  label,
  hint,
  error,
  id,
  describedBy,
  invalid,
  required,
  ...props
}: TextareaFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const description =
    [
      describedBy,
      hint ? `${fieldId}-hint` : undefined,
      error ? `${fieldId}-error` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className={s.field}>
      <Label text={label} htmlFor={fieldId} required={required} />
      <Textarea
        {...props}
        id={fieldId}
        required={required}
        invalid={Boolean(error) || invalid}
        describedBy={description}
      />
      {hint && (
        <p id={`${fieldId}-hint`} className={s.muted}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} role="alert" className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}

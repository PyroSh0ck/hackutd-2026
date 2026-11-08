"use client";
import type { MouseEventHandler, Ref } from "react";
import { Icon, type ButtonIcon } from "./icon";
import { Spinner } from "./spinner";
import { ButtonArt } from "@visual/button-art";
import s from "@visual/ui.module.css";
export type { ButtonIcon } from "./icon";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonProps = {
  text: string;
  loadingText?: string;
  leadingIcon?: ButtonIcon;
  trailingIcon?: ButtonIcon;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  pressed?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
  form?: string;
  name?: string;
  value?: string;
  id?: string;
  describedBy?: string;
  controls?: string;
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
};
export function Button({
  text,
  loadingText,
  leadingIcon,
  trailingIcon,
  variant = "primary",
  disabled = false,
  loading = false,
  pressed,
  onClick,
  type = "button",
  form,
  name,
  value,
  id,
  describedBy,
  controls,
  expanded,
  ref,
}: ButtonProps) {
  return (
    <button
      ref={ref}
      id={id}
      type={type}
      form={form}
      name={name}
      value={value}
      className={s.button}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      aria-describedby={describedBy}
      aria-controls={controls}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <ButtonArt variant={variant} />
      <span className={s.buttonContent}>
        {loading ? (
          <Spinner decorative />
        ) : leadingIcon ? (
          <Icon name={leadingIcon} />
        ) : null}
        <span>{loading ? (loadingText ?? text) : text}</span>
        {trailingIcon && <Icon name={trailingIcon} />}
      </span>
    </button>
  );
}

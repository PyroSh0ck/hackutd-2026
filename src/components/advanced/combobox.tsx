"use client";
import { useId, useState, useRef } from "react";
import s from "@visual/advanced.module.css";
export type ComboboxOption = {
  value: string;
  label: string;
  disabled?: boolean;
};
export type ComboboxProps = {
  label: string;
  options: readonly ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  error?: string;
};
export function Combobox({
  label,
  options,
  value,
  onValueChange,
  placeholder = "Search options",
  disabled = false,
  name,
  error,
}: ComboboxProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const selected = options.find((option) => option.value === value);
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const choose = (index: number) => {
    const option = filtered[index];
    if (option && !option.disabled) {
      onValueChange(option.value);
      close();
    }
  };
  const move = (direction: number) => {
    const indices = filtered.flatMap((option, index) =>
      option.disabled ? [] : [index],
    );
    if (!indices.length) return;
    const position = indices.indexOf(active);
    setActive(
      indices[
        position < 0
          ? direction > 0
            ? 0
            : indices.length - 1
          : (position + direction + indices.length) % indices.length
      ],
    );
  };
  return (
    <div
      className={s.combo}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        ref={input}
        id={id}
        className={s.input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          open && active >= 0 ? `${id}-option-${active}` : undefined
        }
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => {
          setQuery("");
          setActive(-1);
          setOpen(true);
        }}
        onClick={() => {
          if (!open) {
            setQuery("");
            setActive(-1);
            setOpen(true);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            choose(active);
          } else if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      />
      {name && (
        <input type="hidden" name={name} value={value} disabled={disabled} />
      )}
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        className={s.options}
        hidden={!open}
      >
        {filtered.map((option, index) => (
          <li
            id={`${id}-option-${index}`}
            key={option.value}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined}
            data-active={index === active || undefined}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => {
              if (!option.disabled) setActive(index);
            }}
            onClick={() => choose(index)}
          >
            {option.label}
          </li>
        ))}
      </ul>
      {open && !filtered.length && <p role="status">No matching options.</p>}
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

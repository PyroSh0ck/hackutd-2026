import s from "@visual/ui.module.css";
export type LabelProps = { text: string; htmlFor: string; required?: boolean };
export function Label({ text, htmlFor, required = false }: LabelProps) {
  return (
    <label className={s.label} htmlFor={htmlFor}>
      {text}
      {required && <span aria-hidden="true"> *</span>}
    </label>
  );
}

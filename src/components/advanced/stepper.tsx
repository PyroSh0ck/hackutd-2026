"use client";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import s from "@visual/advanced.module.css";
export type WizardStep = {
  id: string;
  title: string;
  content: ReactNode;
  validate?: () => string | undefined | Promise<string | undefined>;
};
export type StepperProps = {
  steps: readonly WizardStep[];
  onComplete: () => void | Promise<void>;
  completeText?: string;
};
export function Stepper({
  steps,
  onComplete,
  completeText = "Finish",
}: StepperProps) {
  const [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = Math.min(index, Math.max(0, steps.length - 1));
  async function next() {
    if (lock.current || !steps.length) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const problem = await steps[current].validate?.();
      if (problem) {
        setError(problem);
        return;
      }
      if (current === steps.length - 1) await onComplete();
      else {
        setIndex(current + 1);
        requestAnimationFrame(() => heading.current?.focus());
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to continue. Please try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!steps.length) return <p>No steps configured.</p>;
  return (
    <section className={s.stack} aria-label="Guided form">
      <ol className={s.steps}>
        {steps.map((step, i) => (
          <li key={step.id} aria-current={i === current ? "step" : undefined}>
            {i + 1}. {step.title}
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1}>
        {steps[current].title}
      </h2>
      {steps.map((step, i) => (
        <div key={step.id} hidden={i !== current}>
          {step.content}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className={s.row}>
        <Button
          text="Back"
          variant="secondary"
          disabled={busy || current === 0}
          onClick={() => {
            setError(undefined);
            setIndex(current - 1);
            requestAnimationFrame(() => heading.current?.focus());
          }}
        />
        <Button
          text={current === steps.length - 1 ? completeText : "Continue"}
          loading={busy}
          onClick={() => void next()}
        />
      </div>
    </section>
  );
}

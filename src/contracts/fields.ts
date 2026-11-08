import { z } from "zod";

// Shared field-schema helpers used by generated contracts.

/**
 * Optional value semantics: omitted, null, and blank strings all mean "no value" (stored as null).
 * Wraps a non-null schema so blank strings become null before validation.
 */
export function optionalValue<S extends z.ZodType>(schema: S) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    schema.nullable(),
  );
}

/** Calendar date as "YYYY-MM-DD" (no time zone). */
export function isoDate(label: string, bounds: { min?: string; max?: string } = {}) {
  let schema = z
    .string({
      error: (issue) => (issue.input == null ? `${label} is required.` : `${label} must be a date.`),
    })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date (YYYY-MM-DD).`)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }, `${label} must be a real calendar date.`);
  if (bounds.min) schema = schema.refine((value) => value >= bounds.min!, `${label} must be on or after ${bounds.min}.`);
  if (bounds.max) schema = schema.refine((value) => value <= bounds.max!, `${label} must be on or before ${bounds.max}.`);
  return schema;
}

/** Number with a required/type message that reads well in forms. */
export function numberValue(label: string) {
  return z.number({
    error: (issue) => (issue.input == null ? `${label} is required.` : `${label} must be a number.`),
  });
}

/** True when `value` has at most `scale` decimal places. */
export function hasAtMostDecimals(value: number, scale: number) {
  const scaled = value * 10 ** scale;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** Converts a stored Date (date-only column) to "YYYY-MM-DD". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Converts "YYYY-MM-DD" to a UTC midnight Date for a date-only column. */
export function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

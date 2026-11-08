import { z } from "zod";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiClientError } from "@/lib/api-client";

/** Applies the first error message per field to a react-hook-form instance. */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fieldErrors: Record<string, string[] | undefined>,
  fields: readonly Path<T>[],
  type: "client" | "server" = "server",
): boolean {
  let applied = false;
  for (const field of fields) {
    const message = fieldErrors[field]?.[0];
    if (message) {
      setError(field, { type, message });
      applied = true;
    }
  }
  return applied;
}

/** Validates a payload client-side; on failure applies field errors and returns null. */
export function validatePayload<S extends z.ZodType, T extends FieldValues>(
  schema: S,
  payload: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): z.infer<S> | null {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const { fieldErrors } = z.flattenError(result.error);
  applyFieldErrors(setError, fieldErrors as Record<string, string[]>, fields, "client");
  return null;
}

/** Applies server-side field errors from an ApiClientError, if any. */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
) {
  if (error instanceof ApiClientError) applyFieldErrors(setError, error.fieldErrors, fields);
}

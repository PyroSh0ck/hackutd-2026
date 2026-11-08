import "server-only";

import { z } from "zod";
import type { ApiErrorCode } from "@/contracts/api-error";

// Throw these from route handlers or services; authRoute() maps them to responses.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: {
      fieldErrors?: Record<string, string[]>;
      formErrors?: string[];
      reason?: string;
      currentVersion?: number;
    },
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class NotFoundError extends HttpError {
  constructor(label = "Resource") {
    super(404, "NOT_FOUND", `${label} not found.`);
    this.name = "NotFoundError";
  }
}

export class InvalidJsonError extends HttpError {
  constructor() {
    super(400, "INVALID_JSON", "Request body must contain valid JSON.");
    this.name = "InvalidJsonError";
  }
}

export class RequestValidationError extends HttpError {
  constructor(error: z.ZodError, message = "Check the submitted fields.") {
    const { fieldErrors, formErrors } = z.flattenError(error);
    super(400, "VALIDATION_ERROR", message, {
      fieldErrors: fieldErrors as Record<string, string[]>,
      formErrors,
    });
    this.name = "RequestValidationError";
  }
}

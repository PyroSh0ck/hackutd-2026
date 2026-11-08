import type { z } from "zod";
import { ApiErrorResponseSchema, type ApiErrorResponse } from "@/contracts/api-error";

/** A structured error returned by one of this app's API routes. */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly details: ApiErrorResponse,
  ) {
    super(details.error.message);
    this.name = "ApiClientError";
  }

  get fieldErrors() {
    return this.details.error.fieldErrors ?? {};
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
};

function withQuery(path: string, query: RequestOptions["query"]) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * Calls an app API route and validates the success body with `schema`.
 * Pass `schema: null` for 204 responses. Throws ApiClientError for API errors
 * and Error for network/unreadable responses.
 */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  options?: RequestOptions,
): Promise<z.infer<S>>;
export async function apiRequest(
  path: string,
  schema: null,
  options?: RequestOptions,
): Promise<void>;
export async function apiRequest(
  path: string,
  schema: z.ZodType | null,
  { method = "GET", body, query }: RequestOptions = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(withQuery(path, query), {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not connect. Please try again.");
  }

  if (response.status === 204 && schema === null) return;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }

  if (!response.ok) {
    const parsed = ApiErrorResponseSchema.safeParse(json);
    if (parsed.success) throw new ApiClientError(response.status, parsed.data);
    throw new Error(`Request failed with status ${response.status}.`);
  }

  return schema === null ? undefined : schema.parse(json);
}

/** A user-facing message for any thrown value, including the request reference. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    return `${error.message} Reference: ${error.details.requestId}`;
  }
  return error instanceof Error ? error.message : fallback;
}

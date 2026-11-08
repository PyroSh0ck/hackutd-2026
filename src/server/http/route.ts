import "server-only";

import type { z } from "zod";
import type { ApiErrorResponse } from "@/contracts/api-error";
import { ResourceIdSchema } from "@/contracts/pagination";
import { requireUser, UnauthorizedError } from "@/server/auth/require-user";
import {
  HttpError,
  InvalidJsonError,
  NotFoundError,
  RequestValidationError,
} from "@/server/http/errors";
import { createRequestContext } from "@/server/http/request-context";
import { isSameOrigin, resolvePlayer } from "@/server/game/identity";

type AuthUser = Awaited<ReturnType<typeof requireUser>>;

export type AuthRouteArgs<P> = {
  request: Request;
  user: AuthUser;
  params: P;
  requestId: string;
};

export type RouteResult = { status: number; body: unknown };

function headers(requestId: string) {
  return { "Cache-Control": "no-store", "X-Request-ID": requestId };
}

function errorBody(error: HttpError, requestId: string): ApiErrorResponse {
  return {
    error: { code: error.code, message: error.message, ...error.details },
    requestId,
  };
}

/**
 * Wraps an authenticated route handler: request ID, session check, error mapping,
 * structured completion logging, and no-store headers.
 * The handler returns { status, body }; body should already be parsed by a response schema.
 */
export function authRoute<P = Record<string, never>>(
  route: string,
  failureMessage: string,
  handler: (args: AuthRouteArgs<P>) => Promise<RouteResult>,
) {
  return async (
    request: Request,
    context?: { params?: Promise<P> },
  ): Promise<Response> => {
    const ctx = createRequestContext(request, route);

    try {
      const user = await requireUser(request);
      const params = ((await context?.params) ?? {}) as P;
      const { status, body } = await handler({
        request,
        user,
        params,
        requestId: ctx.requestId,
      });

      ctx.complete(status);
      if (status === 204) {
        return new Response(null, { status, headers: headers(ctx.requestId) });
      }
      return Response.json(body, { status, headers: headers(ctx.requestId) });
    } catch (error) {
      const httpError =
        error instanceof UnauthorizedError
          ? new HttpError(401, "UNAUTHORIZED", "Sign in to continue.")
          : error instanceof HttpError
            ? error
            : null;

      if (httpError) {
        ctx.complete(httpError.status);
        return Response.json(errorBody(httpError, ctx.requestId), {
          status: httpError.status,
          headers: headers(ctx.requestId),
        });
      }

      ctx.complete(500, error);
      return Response.json(
        errorBody(
          new HttpError(500, "INTERNAL_ERROR", failureMessage),
          ctx.requestId,
        ),
        { status: 500, headers: headers(ctx.requestId) },
      );
    }
  };
}

export type PlayerRouteArgs<P> = {
  request: Request;
  /** Anonymous, cookie-bound owner key. Never from the request body. */
  playerKey: string;
  params: P;
  requestId: string;
};

/**
 * Like authRoute, but for anonymous game play: identity comes from the signed `scamper_player`
 * cookie (issued on first request). Same request id, error envelope, logging, and no-store
 * headers. Non-GET requests must be same-origin when an Origin header is present.
 */
export function playerRoute<P = Record<string, never>>(
  route: string,
  failureMessage: string,
  handler: (args: PlayerRouteArgs<P>) => Promise<RouteResult>,
) {
  return async (request: Request, context?: { params?: Promise<P> }): Promise<Response> => {
    const ctx = createRequestContext(request, route);
    let setCookie: string | null = null;
    const withCookie = (init: Record<string, string>) => (setCookie ? { ...init, "Set-Cookie": setCookie } : init);
    try {
      if (request.method !== "GET" && !isSameOrigin(request)) {
        throw new HttpError(403, "FORBIDDEN", "Cross-origin requests are not allowed.");
      }
      const player = resolvePlayer(request);
      setCookie = player.setCookie;
      const params = ((await context?.params) ?? {}) as P;
      const { status, body } = await handler({ request, playerKey: player.playerKey, params, requestId: ctx.requestId });
      ctx.complete(status);
      return Response.json(body, { status, headers: withCookie(headers(ctx.requestId)) });
    } catch (error) {
      const httpError = error instanceof HttpError ? error : null;
      if (httpError) {
        ctx.complete(httpError.status);
        return Response.json(errorBody(httpError, ctx.requestId), { status: httpError.status, headers: withCookie(headers(ctx.requestId)) });
      }
      ctx.complete(500, error);
      return Response.json(errorBody(new HttpError(500, "INTERNAL_ERROR", failureMessage), ctx.requestId), {
        status: 500,
        headers: withCookie(headers(ctx.requestId)),
      });
    }
  };
}

/** Reads a JSON body. Throws InvalidJsonError (400) for malformed input. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InvalidJsonError();
  }
}

/** Validates input with a Zod schema. Throws RequestValidationError (400). */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  message?: string,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new RequestValidationError(result.error, message);
  return result.data;
}

/** Parses URL search params (single values only) with a Zod schema. */
export function parseQuery<S extends z.ZodType>(schema: S, request: Request): z.infer<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return parseInput(schema, params, "Check the query parameters.");
}

/** Validates a route id. Malformed ids are reported as not found, never as 400. */
export function parseId(id: unknown, label: string): string {
  const result = ResourceIdSchema.safeParse(id);
  if (!result.success) throw new NotFoundError(label);
  return result.data;
}

"use client";

import { ObserverSessionResponseSchema, type ClientEventType, type ObserverSessionResponse, type ObserverSessionView } from "@/contracts/observer";
import { HistoryResponseSchema, ProgressResponseSchema } from "@/contracts/history";
import { ReferenceDirectoryResponseSchema } from "@/contracts/reference";
import { apiRequest } from "@/lib/api-client";

/**
 * Thin adapter over the existing observer session API (no new endpoints, no schema changes). The server
 * is the only source of truth for session state, outcomes and allowed actions; the browser remembers only
 * session ids so it can resume the current practice and list this viewer's past sessions.
 *
 * History and progress come from the server (owner = signed player cookie). The browser keeps only the
 * current session id, as a convenience for resuming.
 */

const base = "/api/observer/sessions";
const key = () => crypto.randomUUID();

export type EventExtra = { requestId?: string | null; challengeId?: string; practiceCode?: string; linkedIssueId?: string };

export const scamperApi = {
  start: () => apiRequest(base, ObserverSessionResponseSchema, { method: "POST" }),
  load: (id: string) => apiRequest(`${base}/${id}`, ObserverSessionResponseSchema),
  send: (id: string, content: string, idempotencyKey = key()) =>
    apiRequest(`${base}/${id}/messages`, ObserverSessionResponseSchema, { method: "POST", body: { idempotencyKey, content } }),
  event: (id: string, type: ClientEventType, extra: EventExtra = {}): Promise<ObserverSessionResponse> =>
    apiRequest(`${base}/${id}/events`, ObserverSessionResponseSchema, {
      method: "POST",
      body: {
        idempotencyKey: key(),
        type,
        requestId: extra.requestId ?? null,
        ...(extra.challengeId ? { challengeId: extra.challengeId } : {}),
        ...(extra.practiceCode ? { practiceCode: extra.practiceCode } : {}),
        ...(extra.linkedIssueId ? { linkedIssueId: extra.linkedIssueId } : {}),
      },
    }),
  history: (cursor?: string) => apiRequest(`${base}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, HistoryResponseSchema),
  progress: () => apiRequest("/api/observer/progress", ProgressResponseSchema),
  directory: () => apiRequest("/api/observer/reference-directory", ReferenceDirectoryResponseSchema),
  retry: (id: string) => apiRequest(`${base}/${id}/retry`, ObserverSessionResponseSchema, { method: "POST", body: { idempotencyKey: key() } }),
};

/** Keep the newest server view: a slower response must never overwrite a later state (e.g. End during generation). */
export const newer = (prev: ObserverSessionView | undefined, next: ObserverSessionView) => (!prev || next.revision >= prev.revision ? next : prev);

// ---------------------------------------------------------------- per-viewer session index (localStorage)

const CURRENT = "scamper.current";
const INDEX = "scamper.sessions";

export type IndexedSession = { id: string; startedAt: string };

function read<T>(k: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, JSON.stringify(value));
  } catch {
    /* convenience only: the page still works without storage */
  }
}

export const sessionIndex = {
  current: () => read<string | null>(CURRENT, null),
  setCurrent: (id: string | null) => write(CURRENT, id),
  list: (): IndexedSession[] => {
    const v = read<unknown>(INDEX, []);
    return Array.isArray(v) ? v.filter((x): x is IndexedSession => typeof x?.id === "string" && typeof x?.startedAt === "string") : [];
  },
  add: (id: string, startedAt: string) => {
    const rest = sessionIndex.list().filter((s) => s.id !== id);
    write(INDEX, [{ id, startedAt }, ...rest].slice(0, 50));
  },
  remove: (id: string) => write(INDEX, sessionIndex.list().filter((s) => s.id !== id)),
};

"use client";

import { useCallback, useEffect, useState } from "react";
import type { PageMeta } from "@/contracts/pagination";

export type ListParams = { page: number; pageSize: number; q?: string };

export type ResourceListState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: T[]; meta: PageMeta };

/**
 * Loading/error/ready state for a paged, searchable, owner-scoped list.
 * Feature code supplies `load`; this hook owns request sequencing and local updates.
 */
export function useResourceList<T extends { id: string }>(
  load: (params: ListParams) => Promise<{ data: T[]; meta: PageMeta }>,
  initial: ListParams = { page: 1, pageSize: 20 },
) {
  const [params, setParams] = useState<ListParams>(initial);
  const [state, setState] = useState<ResourceListState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    load(params)
      .then(({ data, meta }) => {
        if (active) setState({ status: "ready", items: data, meta });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load items.",
          });
        }
      });

    return () => {
      active = false;
    };
    // `load` is expected to be a stable module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }, []);

  const setPage = useCallback((page: number) => {
    setState({ status: "loading" });
    setParams((current) => ({ ...current, page }));
  }, []);

  const search = useCallback((q: string) => {
    setState({ status: "loading" });
    setParams((current) => ({ ...current, page: 1, q: q.trim() || undefined }));
  }, []);

  /** Insert a newly created item at the top of the current page. */
  const prepend = useCallback((item: T) => {
    setState((current) =>
      current.status !== "ready"
        ? current
        : {
            ...current,
            items: [item, ...current.items].slice(0, current.meta.pageSize),
            meta: {
              ...current.meta,
              total: current.meta.total + 1,
              pageCount: Math.max(1, Math.ceil((current.meta.total + 1) / current.meta.pageSize)),
            },
          },
    );
  }, []);

  /** Remove a deleted item locally. */
  const remove = useCallback((id: string) => {
    setState((current) => {
      if (current.status !== "ready") return current;
      const total = Math.max(0, current.meta.total - 1);
      return {
        ...current,
        items: current.items.filter((item) => item.id !== id),
        meta: { ...current.meta, total, pageCount: Math.max(1, Math.ceil(total / current.meta.pageSize)) },
      };
    });
  }, []);

  return { state, params, reload, setPage, search, prepend, remove };
}

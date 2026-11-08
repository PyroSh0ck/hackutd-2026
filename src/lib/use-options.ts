"use client";

import { useEffect, useState } from "react";

export type Option = { value: string; label: string };

export type OptionsState =
  | { status: "loading"; options: Option[] }
  | { status: "error"; options: Option[]; message: string }
  | { status: "ready"; options: Option[] };

/** Loads select options once (e.g. parent records for a belongsTo field). `load` must be stable. */
export function useOptions(load: () => Promise<Option[]>): OptionsState {
  const [state, setState] = useState<OptionsState>({ status: "loading", options: [] });

  useEffect(() => {
    let active = true;
    load()
      .then((options) => active && setState({ status: "ready", options }))
      .catch((error: unknown) =>
        active && setState({ status: "error", options: [], message: error instanceof Error ? error.message : "Could not load options." }),
      );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

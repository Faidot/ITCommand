"use client";

import { useEffect, useRef } from "react";
import { subscribeDataChange, type DataChange } from "@/lib/data-sync";

type Matcher = string | string[] | ((change: DataChange) => boolean);

function matches(matcher: Matcher, change: DataChange): boolean {
  if (typeof matcher === "function") return matcher(change);
  const list = Array.isArray(matcher) ? matcher : [matcher];
  return list.some((m) => change.path.includes(m));
}

/**
 * Re-run `onChange` whenever a matching resource is created/updated/deleted —
 * including from the other split-screen panel (iframe) — without a page reload.
 *
 * `matcher` is a path substring (e.g. "/departments"), a list of them, or a
 * predicate. Calls are debounced so a burst of writes triggers one refresh.
 *
 *   useDataSync("/departments", fetchDepartments);
 */
export function useDataSync(matcher: Matcher, onChange: () => void, debounceMs = 150) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const matcherRef = useRef(matcher);
  matcherRef.current = matcher;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeDataChange((change) => {
      if (!matches(matcherRef.current, change)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [debounceMs]);
}

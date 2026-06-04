"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Bulk-selection state for a table. Tracks a set of selected row ids and
 * exposes the helpers a table header / row / action bar typically needs.
 *
 *   const sel = useBulkSelection<number>();
 *   sel.toggle(id);
 *   sel.toggleAll(rows.map(r => r.id));   // select-all on the visible set
 *   sel.isSelected(id);
 *   sel.allSelected(rows.map(r => r.id));
 *   sel.someSelected(rows.map(r => r.id));
 *   sel.clear();
 *   sel.ids;        // number[]
 *   sel.count;
 */
export function useBulkSelection<T extends number | string = number>() {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((ids: T[]) => {
    setSelected((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) {
        // Deselect this batch but keep anything outside it.
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      // Add all visible ids.
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: T) => selected.has(id), [selected]);

  const allSelected = useCallback(
    (ids: T[]) => ids.length > 0 && ids.every((id) => selected.has(id)),
    [selected],
  );

  const someSelected = useCallback(
    (ids: T[]) => ids.some((id) => selected.has(id)) && !ids.every((id) => selected.has(id)),
    [selected],
  );

  const ids = useMemo(() => Array.from(selected), [selected]);

  return {
    selected,
    ids,
    count: selected.size,
    toggle,
    toggleAll,
    clear,
    isSelected,
    allSelected,
    someSelected,
  };
}

export interface BulkDeleteResponse {
  deleted_count: number;
  blocked_count: number;
  deleted: Array<number | string>;
  blocked: Array<{ id: number | string; reason: string; [k: string]: any }>;
}

/** Build a toast message from a bulk-delete response. */
export function summarizeBulkDelete(res: BulkDeleteResponse): { kind: "success" | "warning"; message: string } {
  if (res.blocked_count === 0) {
    return { kind: "success", message: `Deleted ${res.deleted_count} item(s).` };
  }
  if (res.deleted_count === 0) {
    return { kind: "warning", message: `Blocked ${res.blocked_count} item(s): ${res.blocked[0]?.reason ?? "in use"}` };
  }
  return {
    kind: "warning",
    message: `Deleted ${res.deleted_count}, blocked ${res.blocked_count} (in use).`,
  };
}

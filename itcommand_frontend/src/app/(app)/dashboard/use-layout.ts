"use client";

/**
 * Per-person dashboard layout: which cards, in what order, at what size.
 *
 * Stored in localStorage keyed by user id rather than on the server. A layout
 * is a preference about one browser, not a fact about the account, and putting
 * it behind the API would mean a model, a migration and a round trip before
 * the first paint — for something that must survive exactly one reload.
 * Server-side sync is a later change if people want it across devices.
 *
 * The stored layout is treated as a hint, never as the source of truth: cards
 * that no longer exist are dropped and cards added since are appended, so a
 * saved layout cannot hide a new module or resurrect a removed one.
 */

import { useCallback, useEffect, useState } from "react";

/** Column spans a card may take on the 12-column grid. */
export const WIDTHS = [2, 3, 4, 6, 12] as const;
export type Width = (typeof WIDTHS)[number];

/** Row heights, in units of the base card height. */
export const HEIGHTS = [1, 2] as const;
export type Height = (typeof HEIGHTS)[number];

export interface CardLayout {
  id: string;
  w: Width;
  h: Height;
  hidden?: boolean;
}

const KEY = (userId: string | number | undefined) => `itcommand.dashboard.layout.${userId ?? "anon"}`;

function isWidth(n: unknown): n is Width {
  return WIDTHS.includes(n as Width);
}
function isHeight(n: unknown): n is Height {
  return HEIGHTS.includes(n as Height);
}

export function useDashboardLayout(
  userId: string | number | undefined,
  defaults: CardLayout[],
) {
  const [layout, setLayout] = useState<CardLayout[]>(defaults);
  const [loaded, setLoaded] = useState(false);

  // Read once on mount. Rendering the default first and correcting after
  // avoids a hydration mismatch: the server has no localStorage to read.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stored: CardLayout[] = [];
    try {
      const raw = window.localStorage.getItem(KEY(userId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          stored = parsed.filter(
            (c) => c && typeof c.id === "string" && isWidth(c.w) && isHeight(c.h),
          );
        }
      }
    } catch {
      // Corrupt or unreadable: fall through to the defaults rather than
      // leaving somebody with a dashboard that will not render.
      stored = [];
    }

    const known = new Set(defaults.map((d) => d.id));
    const kept = stored.filter((c) => known.has(c.id));
    const seen = new Set(kept.map((c) => c.id));
    // Anything added to the app since this layout was saved goes on the end,
    // visible. A new module must not be invisible because of an old preference.
    const appended = defaults.filter((d) => !seen.has(d.id));

    setLayout(kept.length ? [...kept, ...appended] : defaults);
    setLoaded(true);
  }, [userId, defaults]);

  const persist = useCallback(
    (next: CardLayout[]) => {
      setLayout(next);
      try {
        window.localStorage.setItem(KEY(userId), JSON.stringify(next));
      } catch {
        // Private browsing or a full quota. The layout still applies for this
        // session; losing it on reload beats failing the interaction.
      }
    },
    [userId],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = [...layout];
      const [card] = next.splice(from, 1);
      next.splice(to, 0, card);
      persist(next);
    },
    [layout, persist],
  );

  const resize = useCallback(
    (id: string, patch: Partial<Pick<CardLayout, "w" | "h">>) => {
      persist(layout.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [layout, persist],
  );

  const toggle = useCallback(
    (id: string) => {
      persist(layout.map((c) => (c.id === id ? { ...c, hidden: !c.hidden } : c)));
    },
    [layout, persist],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(KEY(userId));
    } catch {
      /* nothing to clear */
    }
    setLayout(defaults);
  }, [userId, defaults]);

  return { layout, loaded, move, resize, toggle, reset };
}

"use client";

/**
 * How the app should feel, per person and per browser.
 *
 * These are display preferences, not account settings, so they live in
 * localStorage rather than behind the API — the same call as the dashboard
 * layout. They also have to apply before the first paint, and a round trip
 * cannot.
 *
 * Every preference is expressed as a `data-*` attribute on <html>, and the
 * styling lives in globals.css. That keeps components free of preference
 * checks: a card does not ask whether hover is enabled, it just declares its
 * hover style and the root attribute decides whether it survives.
 */

import { create } from "zustand";

export type Motion = "full" | "reduced" | "none";
export type Hover = "full" | "subtle" | "off";
export type Density = "comfortable" | "compact";
export type Radius = "round" | "soft" | "square";
export type TextScale = "sm" | "md" | "lg" | "xl";

export interface UiPrefs {
  motion: Motion;
  hover: Hover;
  density: Density;
  radius: Radius;
  textScale: TextScale;
  /** Backdrop blur is expensive on weak GPUs and the first thing to drop. */
  blur: boolean;
  /** Coloured status text/badges; off leaves shape and text carrying meaning. */
  vividStatus: boolean;
  /** Honour the OS "reduce motion" switch even when motion is set to full. */
  followSystemMotion: boolean;
}

export const DEFAULT_PREFS: UiPrefs = {
  motion: "full",
  hover: "full",
  density: "comfortable",
  radius: "round",
  textScale: "md",
  blur: true,
  vividStatus: true,
  followSystemMotion: true,
};

const KEY = "itcommand.ui.prefs";

interface State extends UiPrefs {
  set: <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => void;
  reset: () => void;
  hydrate: () => void;
}

function persist(prefs: UiPrefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing or a full quota. The choice still applies this session.
  }
}

/** Push the current preferences onto <html> so CSS can act on them. */
export function applyPrefs(prefs: UiPrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // The OS switch wins when asked to. Somebody who set "reduce motion" at the
  // system level has already answered this question once.
  const systemReduced =
    prefs.followSystemMotion &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  root.dataset.motion = systemReduced && prefs.motion === "full" ? "reduced" : prefs.motion;
  root.dataset.hover = prefs.hover;
  root.dataset.density = prefs.density;
  root.dataset.radius = prefs.radius;
  root.dataset.text = prefs.textScale;
  root.dataset.blur = prefs.blur ? "on" : "off";
  root.dataset.vivid = prefs.vividStatus ? "on" : "off";
}

export const useUiPrefs = create<State>((setState, getState) => ({
  ...DEFAULT_PREFS,

  set: (key, value) => {
    setState({ [key]: value } as Partial<State>);
    const { set: _s, reset: _r, hydrate: _h, ...prefs } = getState();
    persist(prefs as UiPrefs);
    applyPrefs(prefs as UiPrefs);
  },

  reset: () => {
    setState({ ...DEFAULT_PREFS });
    persist(DEFAULT_PREFS);
    applyPrefs(DEFAULT_PREFS);
  },

  hydrate: () => {
    if (typeof window === "undefined") return;
    let stored: Partial<UiPrefs> = {};
    try {
      stored = JSON.parse(window.localStorage.getItem(KEY) || "{}") ?? {};
    } catch {
      stored = {};
    }
    // Merged over the defaults, so a preference added in a later release is
    // present even for somebody with an older blob saved.
    const merged: UiPrefs = { ...DEFAULT_PREFS, ...stored };
    setState({ ...merged });
    applyPrefs(merged);
  },
}));

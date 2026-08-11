"use client";

/**
 * Applies saved appearance preferences to <html> as early as the client can.
 *
 * Two parts, deliberately:
 *
 * The inline script runs *before* React hydrates, so the app does not paint at
 * full motion and default text size and then jump when the store loads. It is
 * the same trick next-themes uses to avoid a flash of the wrong theme, and it
 * has to be inline for the same reason — an external module arrives too late.
 *
 * The component then hydrates the store so the settings UI has state to edit,
 * and follows the OS reduced-motion switch while the page is open.
 */

import { useEffect } from "react";

import { applyPrefs, useUiPrefs } from "@/store/uiPrefsStore";

/**
 * Stringified so it can run before hydration. Kept deliberately small and
 * total: any failure leaves the document at its defaults rather than
 * unstyled, because this runs before anything can catch an error.
 */
const BOOTSTRAP = `
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('itcommand.ui.prefs') || '{}');
    var d = document.documentElement;
    var motion = p.motion || 'full';
    if ((p.followSystemMotion !== false) && motion === 'full' &&
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion = 'reduced';
    }
    d.dataset.motion = motion;
    d.dataset.hover = p.hover || 'full';
    d.dataset.density = p.density || 'comfortable';
    d.dataset.radius = p.radius || 'round';
    d.dataset.text = p.textScale || 'md';
    d.dataset.blur = p.blur === false ? 'off' : 'on';
    d.dataset.vivid = p.vividStatus === false ? 'off' : 'on';
  } catch (e) {}
})();
`;

export function UiPrefsScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />;
}

export function UiPrefsProvider() {
  const hydrate = useUiPrefs((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // The OS switch can be thrown while the app is open; honour it live rather
  // than only at load.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      const { set: _s, reset: _r, hydrate: _h, ...prefs } = useUiPrefs.getState();
      applyPrefs(prefs);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return null;
}

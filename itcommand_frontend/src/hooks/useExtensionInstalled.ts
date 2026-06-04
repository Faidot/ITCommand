"use client";

import { useEffect, useState } from "react";

export type ExtensionState = "checking" | "installed" | "not-installed";

/**
 * Detects whether the "IT Command" browser extension is installed.
 *
 * The extension's content script runs on every page (including this app). It
 * sets a `data-it-command` attribute on <html>, broadcasts a HELLO over the
 * window message bus on load, and replies PONG to our PING. We check the marker
 * synchronously and ping a few times before concluding it's absent.
 */
export function useExtensionInstalled(timeoutMs = 2000) {
  const [state, setState] = useState<ExtensionState>("checking");
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let settled = false;
    const markInstalled = (v?: string | null) => {
      if (settled) return;
      settled = true;
      if (v) setVersion(v);
      setState("installed");
    };

    // Fast path: marker already on the document.
    const attr = document.documentElement.getAttribute("data-it-command");
    if (attr) {
      markInstalled(attr);
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data && data.source === "it-command-extension" && (data.type === "PONG" || data.type === "HELLO")) {
        markInstalled(data.version);
      }
    };
    window.addEventListener("message", onMessage);

    const ping = () => window.postMessage({ source: "it-command-web", type: "PING" }, "*");
    const pingTimers = [0, 250, 600, 1200].map((d) => window.setTimeout(ping, d));

    const finalTimer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setState("not-installed");
      }
    }, timeoutMs);

    return () => {
      window.removeEventListener("message", onMessage);
      pingTimers.forEach(clearTimeout);
      clearTimeout(finalTimer);
    };
  }, [timeoutMs]);

  return { state, version };
}

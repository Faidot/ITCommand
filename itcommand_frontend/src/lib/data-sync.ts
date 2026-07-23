/**
 * Cross-document data sync bus.
 *
 * The split-screen view renders the right panel inside an iframe, so the two
 * sides are separate documents with their own React trees and their own copies
 * of fetched data. Without a bridge, adding a department on one side never
 * shows up in the other side's dropdowns until a full reload.
 *
 * Every successful mutating API call (POST/PUT/PATCH/DELETE) publishes the
 * affected resource path here. Both the parent window and the iframe are the
 * same origin, so a BroadcastChannel message reaches both — each page listens
 * for the paths it cares about and re-fetches. A window event is also emitted
 * so listeners in the *same* document react even where BroadcastChannel is
 * unavailable.
 */

const CHANNEL_NAME = "it-command:data-sync";
const WINDOW_EVENT = "it-command:data-sync";

export interface DataChange {
  path: string;   // request pathname, e.g. "/departments/3/"
  method: string; // lowercase http method
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Announce that a resource changed. Called by the API client after mutations. */
export function emitDataChange(change: DataChange) {
  if (typeof window === "undefined") return;
  try {
    getChannel()?.postMessage(change);
  } catch {
    /* channel may be closing during navigation — ignore */
  }
  window.dispatchEvent(new CustomEvent<DataChange>(WINDOW_EVENT, { detail: change }));
}

/**
 * Subscribe to changes. `onChange` fires for every mutation (local or from the
 * other split-screen panel). Returns an unsubscribe function.
 */
export function subscribeDataChange(onChange: (change: DataChange) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const fromChannel = (e: MessageEvent<DataChange>) => e.data && onChange(e.data);
  const fromWindow = (e: Event) => {
    const detail = (e as CustomEvent<DataChange>).detail;
    if (detail) onChange(detail);
  };

  const ch = getChannel();
  ch?.addEventListener("message", fromChannel);
  window.addEventListener(WINDOW_EVENT, fromWindow);

  return () => {
    ch?.removeEventListener("message", fromChannel);
    window.removeEventListener(WINDOW_EVENT, fromWindow);
  };
}

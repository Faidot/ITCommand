/**
 * Handing a generated file to the browser.
 *
 * There were six copies of this in the app and they disagreed in ways that
 * only show up somewhere other than the machine they were written on:
 *
 * * half of them called `click()` on an anchor that was never added to the
 *   document. Chrome allows that; **Firefox ignores it**, so those exports did
 *   nothing at all and said nothing about it;
 * * most revoked the object URL on the very next line, which can cancel a
 *   download that has not started yet;
 * * one never revoked it, leaking the whole blob for the life of the tab.
 *
 * One implementation, so there is one thing to be right.
 */

/** Save `data` as `filename`. Returns false only if the DOM is unavailable. */
export function downloadBlob(
  data: BlobPart | Blob,
  filename: string,
  type?: string,
): boolean {
  if (typeof document === "undefined") return false;

  const blob =
    data instanceof Blob ? data : new Blob([data], type ? { type } : undefined);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  // In the document before the click: a detached anchor's click is a no-op in
  // Firefox, which is what made these exports fail silently.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Deferred, not immediate. Revoking while the browser is still reading the
  // blob can cancel the save; one turn of the event loop is enough for the
  // download to have taken its own reference.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

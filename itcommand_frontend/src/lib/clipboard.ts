/**
 * Copying text, on the deployment we actually have.
 *
 * `navigator.clipboard` only exists in a **secure context** — HTTPS, or
 * localhost. This app is served over plain HTTP on the LAN, so on the server
 * the whole API is `undefined` and `navigator.clipboard.writeText(...)` throws
 * a TypeError before it can do anything. Every copy button in the app was
 * written against it directly, which is why they all worked on a developer's
 * machine and none of them worked for anybody else.
 *
 * So: use the modern API when it is really there, and fall back to the legacy
 * `document.execCommand("copy")` otherwise. It is deprecated, and it is also
 * the only thing that works outside a secure context, so it stays until the
 * app is served over TLS.
 *
 * The second rule here matters as much as the first: **never claim success we
 * did not have.** A toast saying "password copied" over a clipboard that still
 * holds something else is worse than a dead button — it sends someone off to
 * paste a value they do not have. Every function returns whether it worked and
 * callers are expected to branch on it.
 */

/** Copy via a throwaway textarea. The only path available over plain HTTP. */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off-screen rather than hidden: `display:none` and `visibility:hidden`
  // elements cannot be selected, so the copy would silently do nothing.
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);

  // Put the user's own selection back afterwards — copying a password should
  // not clear the text they had highlighted.
  const selection = document.getSelection();
  const previous =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  let ok = false;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(area);
    if (selection && previous) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
  }
  return ok;
}

/**
 * Put `text` on the clipboard. Resolves to whether it actually landed there.
 *
 * Never throws: a copy button failing is not worth an unhandled rejection, but
 * it is worth the caller knowing, so the answer comes back as a boolean.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof document === "undefined") return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Present but refused — permissions policy, or a browser that requires
      // a user gesture this call is too far removed from. The legacy path
      // below often still works, so fall through rather than give up.
    }
  }
  return legacyCopy(text);
}

/**
 * Can we read the clipboard back to check what is on it?
 *
 * Reading is gated more tightly than writing — it needs a secure context *and*
 * an explicit permission — so an auto-clear promise should only be made when
 * this is true.
 */
export function canVerifyClipboard(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function"
  );
}

/**
 * Clear the clipboard, but only if it still holds `expected`.
 *
 * The check is the point. Blindly wiping the clipboard some seconds after a
 * copy would throw away whatever the person copied in the meantime, which is
 * their work, not ours to discard.
 */
export async function clearClipboardIfUnchanged(expected: string): Promise<boolean> {
  if (!canVerifyClipboard()) return false;
  try {
    const current = await navigator.clipboard.readText();
    if (current !== expected) return false;
    await navigator.clipboard.writeText("");
    return true;
  } catch {
    // Read permission denied. Leaving the clipboard alone is the safe answer.
    return false;
  }
}

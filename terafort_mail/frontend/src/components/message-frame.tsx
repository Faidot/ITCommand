"use client";

import { useMemo } from "react";

/**
 * Renders a message body inside a sandbox.
 *
 * This is the first of the two independent mechanisms from blueprint
 * section 10 — the server-side sanitiser is the second. Both have to fail
 * before a message can run code.
 *
 * `sandbox` without `allow-scripts` and without `allow-same-origin` gives the
 * frame a null origin and no script execution. `allow-popups` is granted so
 * that links still open; it does not permit script.
 *
 * The CSP inside the document is belt and braces: even if something got past
 * the sanitiser, `default-src 'none'` leaves it nothing to reach.
 */
export function MessageFrame({
  html,
  text,
  imagesAllowed,
}: {
  html: string;
  text: string;
  imagesAllowed: boolean;
}) {
  const doc = useMemo(() => {
    // Images are rewritten server-side to point at our own proxy, so the
    // frame only ever needs to reach us. `https:` is deliberately NOT allowed
    // — if a URL slipped past the rewriter, the CSP still stops the browser
    // contacting the sender directly.
    const imgSrc = imagesAllowed ? "'self'" : "'none'";

    const content = html
      ? html
      : `<pre>${(text || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>`;

    return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<base target="_blank">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 16px 18px; }
  body {
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #16192b; background: #fff; word-break: break-word;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #dbe1f2; background: #0f1424; }
    a { color: #9d97ff; }
    blockquote { border-color: #2c3554; color: #98a1bf; }
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; border-collapse: collapse; }
  pre { white-space: pre-wrap; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  blockquote { border-left: 3px solid #dfe4f1; margin: 0 0 12px; padding-left: 12px; color: #667; }
  a { color: #4f46e5; }
</style>
</head><body>${content}</body></html>`;
  }, [html, text, imagesAllowed]);

  return (
    <iframe
      title="Message body"
      // No allow-scripts. No allow-same-origin. Ever.
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className="h-[52vh] w-full rounded-lg border border-border bg-white dark:bg-[#0f1424]"
    />
  );
}

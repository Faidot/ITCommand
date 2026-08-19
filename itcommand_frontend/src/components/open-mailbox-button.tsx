"use client";

import { useState } from "react";
import api from "@/lib/api";

/**
 * The Open Mailbox button.
 *
 * The interesting part is how the ticket crosses the origin boundary. The
 * obvious implementation is a redirect to mail.itcommand.com/auth?t=… and it
 * is wrong: a bearer value in a query string is written to browser history,
 * sent onward in Referer, and captured verbatim in the nginx access log on
 * both hosts. Three durable copies.
 *
 * So the ticket comes back in a response body and leaves in a request body,
 * via a form we build and submit ourselves. None of those three records it.
 *
 * The ticket is single-use and lives 30 seconds, so there is no value in
 * holding it in React state beyond the moment of submission.
 */
export function OpenMailboxButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/open-mailbox/");

      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.post_to;
      // A new tab keeps IT Command where it was. noopener so the mail app
      // never gets a handle back to this window.
      form.target = "_blank";
      form.rel = "noopener";

      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "ticket";
      field.value = data.ticket;
      form.appendChild(field);

      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
    } catch (err: any) {
      // 409 means the mail session expired independently of this one. We hold
      // no credential to rebuild it, so signing in again is the only answer.
      setError(
        err?.response?.status === 409
          ? "Your mailbox session has expired. Sign out and back in to reopen it."
          : "Could not open your mailbox. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2
                   text-sm font-medium text-primary-foreground
                   disabled:opacity-60"
      >
        {busy ? "Opening…" : "Open Mailbox"}
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Draft, type Queued } from "@/lib/api";

/**
 * The composer.
 *
 * Send does not send. It queues, and the undo window runs client-side against
 * a server-side clock — nothing reaches Exim until it closes, so "undo" is
 * cancelling a job rather than attempting a recall. That is why it always
 * works, and why there is no "recall sent message" button anywhere: recall
 * depends on the recipient's server cooperating, and it usually does not.
 */
export function Composer({
  initial,
  onClose,
  onQueued,
}: {
  initial: Partial<Draft>;
  onClose: () => void;
  onQueued: (queued: Queued, draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    to: initial.to ?? "",
    cc: initial.cc ?? "",
    subject: initial.subject ?? "",
    text: initial.text ?? "",
    in_reply_to: initial.in_reply_to,
    references: initial.references,
  });
  const [showCc, setShowCc] = useState(Boolean(initial.cc));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [later, setLater] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // A reply opens with the cursor in the body; a new message opens in To.
    const target = initial.to ? bodyRef.current : document.getElementById("compose-to");
    (target as HTMLElement | null)?.focus();
  }, [initial.to]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const send = async () => {
    if (!draft.to.trim()) { setError("Add at least one recipient."); return; }
    setBusy(true);
    setError(null);
    try {
      const queued = await api.send({ ...draft, send_in_seconds: later ?? undefined });
      onQueued(queued, draft);
      onClose();
    } catch {
      setError("That could not be queued. Nothing has been sent.");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (ev: React.KeyboardEvent) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); void send(); }
    if (ev.key === "Escape") { ev.preventDefault(); onClose(); }
  };

  return (
    <div
      onKeyDown={onKey}
      className="fixed bottom-0 right-0 z-40 m-0 w-full overflow-hidden border border-border
                 bg-background shadow-2xl sm:bottom-5 sm:right-5 sm:m-0 sm:w-[min(38rem,94vw)]
                 sm:rounded-xl"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2">
        <span className="flex-1 text-sm font-semibold">
          {initial.in_reply_to ? "Reply" : "New message"}
        </span>
        <button onClick={onClose} aria-label="Close"
                className="rounded px-2 py-1 text-muted-foreground hover:bg-muted">✕</button>
      </div>

      <Field label="To">
        <input id="compose-to" value={draft.to} onChange={(e) => set({ to: e.target.value })}
               placeholder="name@example.com" className="w-full bg-transparent outline-none" />
        {!showCc && (
          <button onClick={() => setShowCc(true)}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Cc</button>
        )}
      </Field>

      {showCc && (
        <Field label="Cc">
          <input value={draft.cc ?? ""} onChange={(e) => set({ cc: e.target.value })}
                 className="w-full bg-transparent outline-none" />
        </Field>
      )}

      <Field label="Subject">
        <input value={draft.subject} onChange={(e) => set({ subject: e.target.value })}
               className="w-full bg-transparent outline-none" />
      </Field>

      <textarea
        ref={bodyRef}
        value={draft.text}
        onChange={(e) => set({ text: e.target.value })}
        placeholder="Write something…"
        className="min-h-[11rem] w-full resize-y bg-transparent px-4 py-3 text-sm outline-none"
      />

      {error && <p className="px-4 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {later !== null && (
        <p className="mx-4 mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Scheduled. If your session has ended by then, it sends the moment you next sign in —
          we hold no copy of your password to send it without you.
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-border bg-muted/50 px-4 py-2.5">
        <button onClick={() => void send()} disabled={busy}
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy ? "Queueing…" : later !== null ? "Schedule" : "Send"}
        </button>
        <select
          value={later ?? ""}
          onChange={(e) => setLater(e.target.value === "" ? null : Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="">Send now</option>
          <option value={3600}>In an hour</option>
          <option value={28800}>In 8 hours</option>
          <option value={86400}>Tomorrow</option>
        </select>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">⌘↵</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
      <label className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/**
 * The undo toast. Counts down against the window the server gave us, so the
 * number on screen is the real deadline rather than an optimistic guess.
 */
export function UndoToast({
  queued, onUndone, onExpired,
}: {
  queued: Queued; onUndone: (draft: Draft) => void; onExpired: () => void;
}) {
  const [left, setLeft] = useState(queued.undo_seconds);

  useEffect(() => {
    if (queued.kind === "SEND_LATER") return;
    if (left <= 0) { onExpired(); return; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, queued.kind, onExpired]);

  const undo = async () => {
    try {
      const result = await api.undo(queued.id);
      onUndone(result.draft);
    } catch {
      // Already gone. Saying so is better than a silently dead button.
      onExpired();
    }
  };

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3
                    rounded-lg bg-foreground px-4 py-2.5 text-sm text-background shadow-xl">
      <span>
        {queued.kind === "SEND_LATER"
          ? `Scheduled${queued.note ? " — sends when you next sign in" : ""}`
          : "Sending"}
      </span>
      {queued.kind === "UNDO_WINDOW" && (
        <span className="font-mono text-xs tabular-nums opacity-70">{left}s</span>
      )}
      <button onClick={() => void undo()}
              className="rounded-md border border-current/40 px-2.5 py-1 text-xs font-semibold hover:bg-background/15">
        Undo
      </button>
    </div>
  );
}

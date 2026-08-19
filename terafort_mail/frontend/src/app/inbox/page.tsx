"use client";

import { useEffect, useState } from "react";
import { api, SessionExpired, type Folder, type Me } from "@/lib/api";

/**
 * Phase 1 landing page.
 *
 * Deliberately thin: it exists to prove the handoff lands a signed-in session
 * and that folders come back scoped to it. The three-pane client, the
 * virtualized list and the keyboard model arrive in Phase 2 and Phase 6.
 */
export default function Inbox() {
  const [me, setMe] = useState<Me | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setMe(await api.me());
        setFolders(await api.folders());
      } catch (err) {
        if (err instanceof SessionExpired) setExpired(true);
        else throw err;
      }
    })();
  }, []);

  if (expired) {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold">Your mailbox session has ended</h1>
          <p className="mt-2 text-muted-foreground">
            We hold no copy of your password, so there is nothing to renew it with.
            Open your mailbox from IT Command again.
          </p>
          <a
            href={process.env.NEXT_PUBLIC_ITC_URL ?? "https://itcommand.com"}
            className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
          >
            Back to IT Command
          </a>
        </div>
      </main>
    );
  }

  if (!me) {
    return <main className="grid min-h-screen place-items-center text-muted-foreground">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8 border-b border-border pb-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Signed in as</p>
        <h1 className="mt-1 text-2xl font-semibold">{me.mailbox}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Session ends in {Math.round(me.expires_in / 60)} minutes.
        </p>
      </header>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Folders
      </h2>
      {folders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing synced yet — the IMAP read path lands in Phase 2.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {folders.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{f.path}</span>
              <span className="tabular-nums text-muted-foreground">
                {f.unread > 0 ? `${f.unread} unread` : `${f.total}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api, BUNDLES, initials, when,
  SessionExpired, ServerUnreachable,
  type Body, type Draft, type Folder, type Queued, type Row,
} from "@/lib/api";
import { MessageFrame } from "@/components/message-frame";
import { Composer, UndoToast } from "@/components/composer";

type View = { kind: "folder"; id: string; label: string } | { kind: "bundle"; name: string };

const FOLDER_ICON: Record<string, string> = {
  "": "✉", "\\Sent": "➤", "\\Drafts": "✎", "\\Trash": "🗑",
  "\\Junk": "⚠", "\\Archive": "📦",
};

/** INBOX.Team.Renewals reads as "Renewals" in a list. */
function leaf(path: string): string {
  if (path.toUpperCase() === "INBOX") return "Inbox";
  const parts = path.split(/[./]/);
  return parts[parts.length - 1] || path;
}

export default function Inbox() {
  const [mailbox, setMailbox] = useState("");
  const [expiresIn, setExpiresIn] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState<Body | null>(null);
  const [thread, setThread] = useState<Row[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expired, setExpired] = useState(false);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [composing, setComposing] = useState<Partial<Draft> | null>(null);
  const [queued, setQueued] = useState<Queued | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const say = (message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3200);
  };

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SessionExpired) setExpired(true);
      else if (err instanceof ServerUnreachable) setOffline(true);
      else say("Something went wrong.");
      return null;
    }
  }, []);

  // -- loading ------------------------------------------------------------

  const loadFolders = useCallback(async () => {
    const list = await guard(() => api.folders());
    if (!list) return;
    setFolders(list);
    setView((current) => {
      if (current) return current;
      const inbox = list.find((f) => f.path.toUpperCase() === "INBOX") ?? list[0];
      return inbox ? { kind: "folder", id: inbox.id, label: leaf(inbox.path) } : null;
    });
  }, [guard]);

  const loadMessages = useCallback(async (target: View) => {
    setLoading(true);
    const page = await guard(() =>
      api.messages(target.kind === "folder" ? { folder: target.id } : { bundle: target.name }));
    setLoading(false);
    if (!page) return;
    setRows(page.results);
    setCount(page.count);
    setCursor(0);
  }, [guard]);

  const sync = useCallback(async () => {
    setSyncing(true);
    const result = await guard(() => api.sync());
    setSyncing(false);
    if (result) {
      await loadFolders();
      say("Up to date");
    }
  }, [guard, loadFolders]);

  useEffect(() => {
    (async () => {
      const me = await guard(() => api.me());
      if (!me) return;
      setMailbox(me.mailbox);
      setExpiresIn(me.expires_in);
      await loadFolders();
      // First sign-in of a session has an empty cache, so pull once rather
      // than showing an empty inbox that is not actually empty.
      const page = await guard(() => api.messages({}));
      if (page && page.count === 0) await sync();
      // Anything scheduled past the last session goes out now. This call is
      // what makes "sends when you next sign in" true rather than a promise.
      void api.flushOutbox().then((r) => {
        if (r.sent.length) say(`Sent ${r.sent.length} queued message(s)`);
      }).catch(() => undefined);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (view) void loadMessages(view); }, [view, loadMessages]);

  // -- opening ------------------------------------------------------------

  const openRow = useCallback(async (row: Row) => {
    const body = await guard(() => api.body(row.id));
    if (!body) return;
    setOpen(body);
    setRows((r) => r.map((m) => (m.id === row.id ? { ...m, seen: true } : m)));
    if (row.thread_id) {
      const conversation = await guard(() => api.thread(row.thread_id!));
      setThread(conversation && conversation.messages.length > 1 ? conversation.messages : []);
    } else {
      setThread([]);
    }
  }, [guard]);

  const star = useCallback(async (row: Row) => {
    // Optimistic: the star appears now, the server catches up behind.
    const next = !row.flagged;
    setRows((r) => r.map((m) => (m.id === row.id ? { ...m, flagged: next } : m)));
    setOpen((o) => (o && o.id === row.id ? { ...o, flagged: next } : o));
    const result = await guard(() => api.flag(row.id, next ? "star" : "unstar"));
    if (result && !(result as Row & { synced_to_server?: boolean }).synced_to_server) {
      say("Starred here — the mail server has not confirmed it yet");
    }
  }, [guard]);

  const phish = useCallback(async (row: Row) => {
    const result = await guard(() => api.reportPhishing(row.id));
    if (!result) return;
    setRows((r) => r.filter((m) => m.id !== row.id));
    setOpen(null);
    say("Reported and quarantined");
  }, [guard]);

  const reply = useCallback(async (row: Row, all: boolean) => {
    const context = await guard(() => api.replyContext(row.id));
    if (!context) return;
    setComposing({
      to: context.to.join(", "),
      cc: all ? context.cc_all.join(", ") : "",
      subject: context.subject,
      text: context.quoted,
      in_reply_to: context.in_reply_to,
      references: context.references,
    });
  }, [guard]);

  const showImages = useCallback(async (row: Body) => {
    const result = await guard(() => api.loadImages(row.id));
    if (result) setOpen({ ...row, images_allowed: true });
  }, [guard]);

  // -- keyboard -----------------------------------------------------------

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA)$/.test((ev.target as HTMLElement)?.tagName ?? "")) return;
      const current = rows[cursor];
      switch (ev.key) {
        case "j": ev.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); break;
        case "k": ev.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); break;
        case "Enter": if (current) { ev.preventDefault(); void openRow(current); } break;
        case "u": ev.preventDefault(); setOpen(null); break;
        case "s": if (current) { ev.preventDefault(); void star(current); } break;
        case "!": if (current) { ev.preventDefault(); void phish(current); } break;
        case "c": ev.preventDefault(); setComposing({}); break;
        case "r": if (open ?? current) { ev.preventDefault(); void reply(open ?? current, false); } break;
        case "a": if (open ?? current) { ev.preventDefault(); void reply(open ?? current, true); } break;
        case "Escape": setOpen(null); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, open, openRow, star, phish, reply]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-cursor='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const unreadTotal = useMemo(
    () => folders.reduce((sum, f) => sum + (f.path.toUpperCase() === "INBOX" ? f.unread : 0), 0),
    [folders]);

  // -- terminal states ----------------------------------------------------

  if (expired) return <Ended />;
  if (offline) return (
    <Ended
      title="The mail server is not reachable"
      body="Your password has not been rejected — Dovecot is not answering. Try again shortly."
      action={{ label: "Try again", onClick: () => { setOffline(false); void sync(); } }}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground">✉</span>
          Terafort Mail
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{mailbox}</span>
          <span title="Session length">{Math.round(expiresIn / 60)} min left</span>
          <button onClick={() => void sync()} disabled={syncing}
                  className="rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50">
            {syncing ? "Syncing…" : "Refresh"}
          </button>
          <button onClick={() => setComposing({})}
                  className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground">
            ✎ Compose
          </button>
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[210px_360px_1fr]">
        {/* rail */}
        <aside className="hidden overflow-y-auto border-r border-border bg-muted/30 p-2 md:block">
          <Group label="Folders">
            {folders.map((f) => (
              <NavItem
                key={f.id}
                icon={FOLDER_ICON[f.special_use] ?? "📁"}
                label={leaf(f.path)}
                count={f.unread}
                active={view?.kind === "folder" && view.id === f.id}
                onClick={() => { setOpen(null); setView({ kind: "folder", id: f.id, label: leaf(f.path) }); }}
              />
            ))}
          </Group>
          <Group label="Bundles">
            {BUNDLES.map((name) => (
              <NavItem
                key={name} icon="●" label={name}
                active={view?.kind === "bundle" && view.name === name}
                onClick={() => { setOpen(null); setView({ kind: "bundle", name }); }}
              />
            ))}
            <p className="px-2 pt-1 text-[11px] leading-snug text-muted-foreground">
              Views, not folders. Nothing is moved on the server.
            </p>
          </Group>
        </aside>

        {/* list */}
        <section className={`flex min-h-0 flex-col border-r border-border ${open ? "hidden md:flex" : "flex"}`}>
          <div className="flex items-baseline gap-2 border-b border-border px-3 py-2">
            <span className="font-semibold">
              {view?.kind === "bundle" ? view.name : view?.label ?? "Inbox"}
            </span>
            <span className="text-xs text-muted-foreground">
              {count} message{count === 1 ? "" : "s"}
              {unreadTotal > 0 && view?.kind === "folder" ? ` · ${unreadTotal} unread` : ""}
            </span>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {loading && <Empty>Loading…</Empty>}
            {!loading && rows.length === 0 && (
              <Empty>
                Nothing here.
                <button onClick={() => void sync()} className="mt-2 block text-primary underline">
                  Check the server
                </button>
              </Empty>
            )}
            {rows.map((row, i) => (
              <button
                key={row.id}
                data-cursor={i === cursor}
                onClick={() => { setCursor(i); void openRow(row); }}
                className={`block w-full border-b border-border px-3 py-2.5 text-left
                  ${i === cursor ? "bg-primary/10" : "hover:bg-muted/60"}
                  ${open?.id === row.id ? "bg-primary/10" : ""}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className={`flex-1 truncate text-sm ${row.seen ? "" : "font-semibold"}`}>
                    {row.from_name || row.from_address}
                  </span>
                  {row.flagged && <span className="text-amber-500">★</span>}
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {when(row.date)}
                  </span>
                </div>
                <div className={`truncate text-sm ${row.seen ? "text-muted-foreground" : "font-medium"}`}>
                  {row.subject || "(no subject)"}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.bundle && <Tag tone="accent">{row.bundle}</Tag>}
                  {row.link_mismatch && <Tag tone="risk">⚠ suspicious link</Tag>}
                  {row.has_remote_images && <Tag>images blocked</Tag>}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* reader */}
        <section className={`flex min-h-0 flex-col ${open ? "flex" : "hidden md:flex"}`}>
          {!open ? (
            <div className="grid flex-1 place-items-center p-8 text-center text-muted-foreground">
              <div>
                <div className="mb-2 text-3xl opacity-40">✉</div>
                <p className="text-sm">
                  Pick a message. <kbd className="rounded border border-border px-1">j</kbd>{" "}
                  <kbd className="rounded border border-border px-1">k</kbd> to move,{" "}
                  <kbd className="rounded border border-border px-1">Enter</kbd> to open,{" "}
                  <kbd className="rounded border border-border px-1">c</kbd> to compose.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-sm">
                <button onClick={() => setOpen(null)} className="rounded px-2 py-1 hover:bg-muted md:hidden">←</button>
                <button onClick={() => void star(open)} className="rounded px-2 py-1 hover:bg-muted">
                  {open.flagged ? "★ Starred" : "☆ Star"}
                </button>
                <button onClick={() => void reply(open, false)} className="rounded px-2 py-1 hover:bg-muted">
                  ↩ Reply
                </button>
                <button onClick={() => void reply(open, true)} className="rounded px-2 py-1 hover:bg-muted">
                  ↩↩ Reply all
                </button>
                <span className="flex-1" />
                <button onClick={() => void phish(open)}
                        className="rounded px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950">
                  ⚠ Report phishing
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <h1 className="mb-3 text-lg font-semibold leading-snug">
                  {open.subject || "(no subject)"}
                </h1>
                <div className="mb-4 flex items-center gap-3 border-b border-border pb-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {initials(open.from_name, open.from_address)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{open.from_name || "—"}</span>
                    {/* Address always shown next to the name: a mismatched
                        display name is the commonest phishing tell, and
                        hiding the address hides the tell. */}
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {open.from_address}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{when(open.date)}</span>
                </div>

                {open.link_mismatch && (
                  <Banner tone="risk">
                    A link in this message points somewhere other than it claims. Treat it as
                    phishing until you are sure.
                  </Banner>
                )}

                {open.has_remote_images && !open.images_allowed && (
                  <Banner tone="warn"
                          action={{ label: "Load images", onClick: () => void showImages(open) }}>
                    Images are blocked. Loading them fetches from the sender directly, which
                    tells them you opened this.
                  </Banner>
                )}

                <div className="mb-2 flex items-center gap-2 rounded-t-lg border border-b-0 border-border bg-muted/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="text-emerald-600 dark:text-emerald-400">🔒</span>
                  sandboxed · no scripts · CSP default-src none
                </div>
                <MessageFrame html={open.html} text={open.text} imagesAllowed={open.images_allowed} />

                {open.attachments.length > 0 && (
                  <div className="mt-4">
                    <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {open.attachments.length} attachment{open.attachments.length === 1 ? "" : "s"}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {open.attachments.map((a, i) => (
                        <div key={i} className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                          <div className="font-medium">{a.filename}</div>
                          <div className="text-xs text-muted-foreground">
                            {Math.max(1, Math.round(a.size / 1024))} KB · downloads arrive in a later phase
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {thread.length > 1 && (
                  <div className="mt-5 border-t border-border pt-3">
                    <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {thread.length} messages in this conversation
                    </h2>
                    {thread.map((m) => (
                      <button key={m.id} onClick={() => void openRow(m)}
                              className={`block w-full border-b border-border px-1 py-2 text-left last:border-b-0
                                ${m.id === open.id ? "opacity-50" : "hover:bg-muted/50"}`}>
                        <span className="flex items-baseline gap-2">
                          <span className="flex-1 truncate text-sm font-medium">
                            {m.from_name || m.from_address}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{when(m.date)}</span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{m.subject}</span>
                      </button>
                    ))}
                  </div>
                )}

                <p className="mt-6 text-xs text-muted-foreground">
                  Attachments cannot be downloaded yet, and search arrives next.
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {composing && (
        <Composer
          initial={composing}
          onClose={() => setComposing(null)}
          onQueued={(q) => setQueued(q)}
        />
      )}

      {queued && (
        <UndoToast
          queued={queued}
          onUndone={(draft) => { setQueued(null); setComposing(draft); say("Send cancelled"); }}
          onExpired={() => { setQueued(null); say("Sent"); }}
        />
      )}

      {toast && !queued && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// -- small pieces ---------------------------------------------------------

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="px-2 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </h2>
      {children}
    </div>
  );
}

function NavItem({ icon, label, count, active, onClick }: {
  icon: string; label: string; count?: number; active?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm
              ${active ? "bg-primary/15 font-medium text-primary" : "hover:bg-muted"}`}>
      <span className="w-4 shrink-0 text-center opacity-70">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span> : null}
    </button>
  );
}

function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "accent" | "risk" }) {
  const styles = {
    plain: "bg-muted text-muted-foreground",
    accent: "bg-primary/15 text-primary",
    risk: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  }[tone];
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${styles}`}>
      {children}
    </span>
  );
}

function Banner({ children, tone, action }: {
  children: React.ReactNode; tone: "warn" | "risk";
  action?: { label: string; onClick: () => void };
}) {
  const styles = tone === "risk"
    ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
    : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return (
    <div className={`mb-3 flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${styles}`}>
      <span className="flex-1">{children}</span>
      {action && (
        <button onClick={action.onClick}
                className="shrink-0 rounded-md border border-current px-2 py-1 text-xs font-medium">
          {action.label}
        </button>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

function Ended({ title, body, action }: {
  title?: string; body?: string; action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-semibold">{title ?? "Your mailbox session has ended"}</h1>
        <p className="mt-2 text-muted-foreground">
          {body ?? "We hold no copy of your password, so there is nothing to renew it with. Open your mailbox from IT Command again."}
        </p>
        {action ? (
          <button onClick={action.onClick}
                  className="mt-5 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">
            {action.label}
          </button>
        ) : (
          <a href={process.env.NEXT_PUBLIC_ITC_URL ?? "https://itcommand.com"}
             className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">
            Back to IT Command
          </a>
        )}
      </div>
    </main>
  );
}

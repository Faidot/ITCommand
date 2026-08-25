/**
 * The API client.
 *
 * Two rules, both load-bearing:
 *
 *  1. `credentials: "include"` and nothing else. The session lives in an
 *     httpOnly cookie the browser attaches automatically. There is no token
 *     to read, no header to set, and nothing in localStorage to steal.
 *  2. No function here takes a mailbox. There is no mailbox parameter in the
 *     API to pass one to — the server derives it from the session.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export class SessionExpired extends Error {}
export class ServerUnreachable extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401 || res.status === 403) {
    // The credential is gone and cannot be rebuilt without the user. Signing
    // in again is the only honest recovery.
    throw new SessionExpired("mail session is no longer valid");
  }
  if (res.status === 503) {
    // Dovecot is down. Distinct from a rejected credential, deliberately —
    // telling someone their password is wrong during an outage sends them
    // off changing a password that was fine.
    throw new ServerUnreachable("the mail server is not reachable");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : "{}" });

export type Me = { mailbox: string; expires_in: number; mfa_verified: boolean };

export type Folder = {
  id: string; path: string; special_use: string; unread: number; total: number;
};

export type Row = {
  id: string;
  folder: string;
  thread_id: string | null;
  date: string;
  subject: string;
  from_name: string;
  from_address: string;
  to: { name: string; address: string }[];
  seen: boolean;
  flagged: boolean;
  bundle: string;
  size: number;
  has_remote_images: boolean;
  link_mismatch: boolean;
  quarantined: boolean;
};

export type Body = Row & {
  text: string;
  html: string;
  attachments: { filename: string; content_type: string; size: number }[];
  images_allowed: boolean;
  preview: string;
};

export type Page = {
  results: Row[]; count: number; offset: number; page_size: number; synced: boolean;
};

export const BUNDLES = ["Renewals", "Invoices", "Alerts", "Vendors", "Store Policy"];

export type Draft = {
  to: string; cc?: string; bcc?: string;
  subject: string; text: string;
  in_reply_to?: string; references?: string[];
  send_in_seconds?: number;
};

export type Queued = {
  id: string; due_at: string; undo_seconds: number;
  kind: "UNDO_WINDOW" | "SEND_LATER"; note?: string;
};

export type ReplyContext = {
  subject: string; to: string[]; cc_all: string[];
  in_reply_to: string; references: string[]; quoted: string;
};

export const api = {
  me: () => request<Me>("/me"),
  folders: () => request<Folder[]>("/folders"),
  sync: () => post<{ folders: number }>("/sync"),

  messages: (params: { folder?: string; bundle?: string; unread?: boolean; offset?: number }) => {
    const q = new URLSearchParams();
    if (params.folder) q.set("folder", params.folder);
    if (params.bundle) q.set("bundle", params.bundle);
    if (params.unread) q.set("unread", "true");
    if (params.offset) q.set("offset", String(params.offset));
    return request<Page>(`/messages?${q.toString()}`);
  },

  body: (id: string) => request<Body>(`/messages/${id}/body`),
  thread: (id: string) => request<{ thread_id: string; messages: Row[] }>(`/threads/${id}`),
  flag: (id: string, action: "star" | "unstar" | "read" | "unread") =>
    post<Row>(`/messages/${id}/flag`, { action }),
  loadImages: (id: string) => post<{ images_allowed: boolean }>(`/messages/${id}/load-images`),
  reportPhishing: (id: string) =>
    post<{ quarantined: boolean; detail: string }>(`/messages/${id}/report-phishing`),
  logout: () => post<{ ok: boolean }>("/auth/logout"),

  search: (q: string) =>
    request<{ query: string; count: number; results: Row[]; note?: string }>(
      `/search?q=${encodeURIComponent(q)}`),

  send: (draft: Draft) => post<Queued>("/compose/send", draft),
  undo: (id: string) => post<{ cancelled: boolean; draft: Draft }>("/compose/undo", { id }),
  replyContext: (id: string) => request<ReplyContext>(`/messages/${id}/reply`),
  /** Called on load: this is what makes "sends when you next sign in" true. */
  flushOutbox: () => post<{ sent: string[]; failed: unknown[] }>("/outbox/flush"),
};

/** Short, human dates for a list that is scanned rather than read. */
export function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString([], { day: "numeric", month: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" });
}

export function initials(name: string, address: string): string {
  const source = (name || address || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

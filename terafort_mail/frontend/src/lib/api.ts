/**
 * The API client.
 *
 * Two rules, both load-bearing:
 *
 *  1. `credentials: "include"` and nothing else. The session lives in an
 *     httpOnly cookie the browser attaches automatically. There is no token
 *     to read, no header to set, and nothing in localStorage to steal.
 *  2. No function here takes a mailbox. There is no mailbox parameter in the
 *     API to pass one to -- the server derives it from the session.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export class SessionExpired extends Error {}

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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export type Me = { mailbox: string; expires_in: number; mfa_verified: boolean };
export type Folder = {
  id: string; path: string; special_use: string; unread: number; total: number;
};

export const api = {
  me: () => request<Me>("/me"),
  folders: () => request<Folder[]>("/folders"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};

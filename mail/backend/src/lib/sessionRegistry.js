'use strict';

/**
 * Store-agnostic registry of active webmail user sessions, used by the admin
 * panel (list active sessions + force logout). Kept in sync by the auth route
 * and the requireAuth middleware. For a multi-node deployment this would move
 * to Redis; for a single node an in-memory map is enough.
 */

/** sid -> { email, ip, userAgent, loginTime, lastActivity } */
const sessions = new Map();

function register(sid, meta) {
  sessions.set(sid, { ...meta, loginTime: meta.loginTime || Date.now(), lastActivity: Date.now() });
}

function touch(sid) {
  const s = sessions.get(sid);
  if (s) s.lastActivity = Date.now();
}

function remove(sid) {
  sessions.delete(sid);
}

function get(sid) {
  return sessions.get(sid);
}

function list() {
  return [...sessions.entries()].map(([sid, s]) => ({ id: sid, ...s }));
}

function count() {
  return sessions.size;
}

module.exports = { register, touch, remove, get, list, count };

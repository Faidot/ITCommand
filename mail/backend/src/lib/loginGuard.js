'use strict';

/**
 * In-memory brute-force lockout keyed by an identifier (ip:email or ip:admin).
 * Backed by config security.maxLoginAttempts / lockoutDuration. Sufficient for
 * a single-node deployment; back with Redis for a cluster.
 */

const config = require('../config/configManager');

/** key -> { count, firstAt, lockedUntil } */
const attempts = new Map();

function policy() {
  const sec = config.getSection('security');
  return {
    max: sec.maxLoginAttempts || 5,
    lockoutMs: (sec.lockoutDuration || 900) * 1000,
  };
}

function check(key) {
  const rec = attempts.get(key);
  if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false };
}

function recordFailure(key) {
  const { max, lockoutMs } = policy();
  const rec = attempts.get(key) || { count: 0, firstAt: Date.now(), lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= max) {
    rec.lockedUntil = Date.now() + lockoutMs;
  }
  attempts.set(key, rec);
  return rec;
}

function reset(key) {
  attempts.delete(key);
}

module.exports = { check, recordFailure, reset };

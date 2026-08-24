'use strict';

/**
 * serviceAuth
 * -----------
 * Lets IT Command call TeraMailer as a service rather than as a person.
 *
 * TeraMailer's own auth is a browser session. IT Command is not a browser: it
 * calls from its own server to hand a signed-in user across, and to read and
 * write settings on behalf of a superadmin it has already authenticated. So it
 * gets a different door, and this file is the lock on it.
 *
 * The signature covers the caller name, a timestamp and the raw body, so none
 * of the three can be changed without invalidating it, and a captured request
 * stops working within the skew window.
 *
 * Nothing here is reachable without ITC_SHARED_SECRET being set. Absent, every
 * service request is refused — a missing secret must never mean "allow".
 */

const crypto = require('crypto');
const logger = require('./logger');

/** How far a request's timestamp may be from ours. Both services run on the
 *  same host or the same network; a minute is generous. */
const MAX_SKEW_SECONDS = 60;

function secret() {
  return process.env.ITC_SHARED_SECRET || '';
}

function isConfigured() {
  return Boolean(secret());
}

/**
 * Verify a signed service request. Returns the caller's name, or null.
 * Never throws — a malformed header is a refusal, not a crash.
 */
function verify(req) {
  const key = secret();
  if (!key) return null;

  const caller = req.get('x-service') || '';
  const timestamp = req.get('x-timestamp') || '';
  const signature = req.get('x-signature') || '';
  if (!caller || !timestamp || !signature) return null;

  const drift = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(drift) || drift > MAX_SKEW_SECONDS) {
    logger.warn('Service request rejected: stale timestamp', { caller, drift });
    return null;
  }

  // express.json() has already consumed the stream, so the raw body is
  // captured by the verify hook in app.js. Falling back to a re-serialised
  // body would break the signature the moment key order differed.
  const raw = req.rawBody === undefined ? '' : req.rawBody;
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${caller}|${timestamp}|${raw}`)
    .digest('hex');

  const given = Buffer.from(signature, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    logger.warn('Service request rejected: bad signature', { caller });
    return null;
  }
  return caller;
}

/**
 * Express guard. Answers 404 rather than 401 on purpose: a caller who cannot
 * sign should not learn that a service door exists here at all.
 */
function requireService(req, res, next) {
  const caller = verify(req);
  if (!caller) return res.status(404).json({ error: 'Not found' });
  req.serviceCaller = caller;
  next();
}

module.exports = { verify, requireService, isConfigured, MAX_SKEW_SECONDS };

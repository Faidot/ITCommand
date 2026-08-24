'use strict';

/**
 * Session auth for webmail users + a lightweight double-submit CSRF guard for
 * state-changing requests. Credentials live only in the session store and are
 * attached to the request as `req.creds` for downstream IMAP/SMTP calls.
 */

const logger = require('../lib/logger');
const { verify: verifyService } = require('../lib/serviceAuth');
const sessionRegistry = require('../lib/sessionRegistry');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.creds = {
    email: req.session.user.email,
    password: req.session.password,
  };
  // Track activity for the admin sessions view.
  req.session.lastActivity = Date.now();
  sessionRegistry.touch(req.sessionID);
  next();
}

/**
 * CSRF: the client reads `csrfToken` from /api/auth/me (or /csrf) and echoes it
 * in the `x-csrf-token` header on POST/PUT/PATCH/DELETE. Combined with
 * SameSite cookies this blocks cross-site state changes.
 */
function csrfProtection(req, res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();

  // A signed service request carries no session and needs no CSRF token: CSRF
  // defends against a browser being tricked into sending a request with its
  // cookies attached, and there is no browser and no cookie here. The HMAC
  // already covers the method's body and cannot be produced by a third party.
  if (req.serviceCaller || verifyService(req)) return next();

  const token = req.get('x-csrf-token');
  if (!req.session || !req.session.csrfToken || token !== req.session.csrfToken) {
    logger.warn('CSRF token mismatch', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

module.exports = { requireAuth, csrfProtection };

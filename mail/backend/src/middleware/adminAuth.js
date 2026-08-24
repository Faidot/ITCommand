'use strict';

/**
 * Admin-only guard.
 *
 * Two ways to satisfy it, and they are not equivalent:
 *
 *   a browser session with isAdmin  — somebody signed in to TeraMailer's own
 *                                     admin panel with its admin password
 *   a signed service request        — IT Command calling on behalf of a
 *                                     superadmin it has already authenticated
 *
 * The second exists so the settings can live in IT Command under its own
 * roles, rather than behind a second password nobody remembers. IT Command
 * enforces the superadmin check; this only verifies that the caller really is
 * IT Command and that the request has not been altered in transit.
 */

const { verify } = require('../lib/serviceAuth');

function requireAdmin(req, res, next) {
  const caller = verify(req);
  if (caller) {
    req.serviceCaller = caller;
    return next();
  }
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  req.session.lastActivity = Date.now();
  next();
}

module.exports = { requireAdmin };

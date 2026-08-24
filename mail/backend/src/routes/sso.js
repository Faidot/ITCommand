'use strict';

/**
 * Single sign-on from IT Command.
 *
 * The point of the whole integration: somebody already signed in to IT
 * Command clicks "Open Mailbox" and lands in their inbox without typing a
 * password again.
 *
 * Two steps, and the split is what keeps the credential out of the browser:
 *
 *   issue   IT Command's server posts the mailbox address and password over
 *           the signed service channel. We verify them against IMAP, park
 *           them under a random ticket for 30 seconds, and return the ticket.
 *   redeem  The browser posts that ticket back to us in a FORM BODY. We swap
 *           it for a real session and redirect to the inbox.
 *
 * The password never touches the browser, and the ticket never touches a URL
 * — a ticket in a query string would be written to history, sent onward in
 * Referer, and captured in access logs on both hosts.
 */

const express = require('express');
const crypto = require('crypto');

const config = require('../config/configManager');
const logger = require('../lib/logger');
const imapClient = require('../imap/imapClient');
const sessionRegistry = require('../lib/sessionRegistry');
const { requireService } = require('../lib/serviceAuth');

const router = express.Router();

/** Long enough for a click, short enough that a captured ticket is usually
 *  already dead. */
const TICKET_TTL_MS = 30 * 1000;

/** In-process, deliberately. These live seconds and must not outlive a
 *  restart: a ticket surviving a deploy is a credential surviving a deploy. */
const tickets = new Map();

function sweep() {
  const now = Date.now();
  for (const [token, entry] of tickets) {
    if (entry.expires <= now) tickets.delete(token);
  }
}

function domainAllowed(email) {
  const { allowedDomains } = config.getSection('app');
  if (!allowedDomains || !allowedDomains.length) return true;
  const domain = String(email).split('@')[1];
  return !!domain && allowedDomains.map((d) => d.toLowerCase()).includes(domain.toLowerCase());
}

/* POST /api/auth/sso/issue  — service only */
router.post('/issue', requireService, async (req, res) => {
  sweep();

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // The domain rule applies to a handoff exactly as it does to a typed login.
  // Skipping it here would make IT Command a way around the admin's own
  // allow-list.
  if (!domainAllowed(email)) {
    logger.warn('SSO refused: domain not allowed', { email, caller: req.serviceCaller });
    return res.status(403).json({ error: 'This email domain is not permitted.' });
  }

  try {
    await imapClient.verifyCredentials(email, password);
  } catch (err) {
    // Verified here, not at redeem. A ticket that turns out to be unusable
    // would strand the user on an error page having already left IT Command.
    logger.warn('SSO refused: credentials rejected', { email, error: err.message });
    return res.status(401).json({ error: 'Invalid credentials or mail server unreachable.' });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  tickets.set(token, {
    email,
    password,
    expires: Date.now() + TICKET_TTL_MS,
    issuedTo: req.serviceCaller,
  });

  logger.info('SSO ticket issued', { email, caller: req.serviceCaller });
  res.json({ ticket: token, expires_in: TICKET_TTL_MS / 1000 });
});

/* POST /api/auth/sso/redeem  — the browser's form POST lands here */
router.post('/redeem', (req, res) => {
  sweep();

  const token = String(req.body.ticket || '');
  const entry = token && tickets.get(token);

  // Single use: deleted whether or not it was valid, so a ticket cannot be
  // probed twice.
  tickets.delete(token);

  if (!entry || entry.expires <= Date.now()) {
    logger.info('SSO redeem refused: unknown or expired ticket');
    return res
      .status(401)
      .type('html')
      .send(errorPage('That sign-in link has expired. Open your mailbox from IT Command again.'));
  }

  req.session.regenerate((err) => {
    if (err) {
      logger.error('SSO session regenerate failed', { error: err.message });
      return res.status(500).type('html').send(errorPage('Could not establish a session.'));
    }
    req.session.user = { email: entry.email };
    req.session.password = entry.password;
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    req.session.loginTime = Date.now();
    req.session.lastActivity = Date.now();
    req.session.ip = req.ip;
    req.session.viaSso = true;

    sessionRegistry.register(req.sessionID, {
      email: entry.email,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      loginTime: req.session.loginTime,
    });

    logger.info('SSO login success', { email: entry.email, ip: req.ip });
    // 303 so the browser turns this POST into a GET for the inbox.
    res.redirect(303, process.env.WEBMAIL_URL || '/');
  });
});

function errorPage(message) {
  const itc = process.env.ITC_URL || 'https://itcommand.com';
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign-in link expired</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fc;color:#0b1020;
      font:16px/1.6 ui-sans-serif,system-ui,"Segoe UI",sans-serif;padding:24px}
 .c{max-width:26rem;text-align:center}
 h1{font-size:1.3rem;margin:0 0 .6rem}
 p{color:#3c4463;margin:0 0 1.4rem}
 a{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
   border-radius:9px;padding:10px 18px;font-weight:600}
 @media(prefers-color-scheme:dark){body{background:#080c18;color:#e3e8f8}p{color:#aeb7d3}}
</style>
<div class="c"><h1>That sign-in link has expired</h1><p>${message}</p>
<a href="${itc}">Back to IT Command</a></div>`;
}

module.exports = router;

'use strict';

const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const config = require('../config/configManager');
const logger = require('../lib/logger');
const loginGuard = require('../lib/loginGuard');
const imapClient = require('../imap/imapClient');
const idleService = require('../imap/idleService');
const sessionRegistry = require('../lib/sessionRegistry');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Network-level rate limiting in addition to per-account lockout.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

function domainAllowed(email) {
  const { allowedDomains } = config.getSection('app');
  if (!allowedDomains || !allowedDomains.length) return true;
  const domain = String(email).split('@')[1];
  return !!domain && allowedDomains.map((d) => d.toLowerCase()).includes(domain.toLowerCase());
}

/* POST /api/auth/login */
router.post(
  '/login',
  loginLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid email or password format' });
    }

    const { email, password } = req.body;
    const key = `${req.ip}:${email}`;

    const lock = loginGuard.check(key);
    if (lock.locked) {
      return res
        .status(429)
        .json({ error: `Account temporarily locked. Try again in ${lock.retryAfter}s.` });
    }

    if (!domainAllowed(email)) {
      loginGuard.recordFailure(key);
      logger.warn('Login rejected: domain not allowed', { email, ip: req.ip });
      return res.status(403).json({ error: 'This email domain is not permitted.' });
    }

    try {
      await imapClient.verifyCredentials(email, password);
    } catch (err) {
      loginGuard.recordFailure(key);
      logger.warn('Login failed', { email, ip: req.ip, error: err.message });
      return res.status(401).json({ error: 'Invalid credentials or mail server unreachable.' });
    }

    loginGuard.reset(key);

    // Regenerate the session to prevent fixation, then store identity + creds.
    req.session.regenerate((err) => {
      if (err) {
        logger.error('Session regenerate failed', { error: err.message });
        return res.status(500).json({ error: 'Could not establish session.' });
      }
      req.session.user = { email };
      req.session.password = password; // server-side store only; never on disk in plaintext
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
      req.session.loginTime = Date.now();
      req.session.lastActivity = Date.now();
      req.session.ip = req.ip;

      sessionRegistry.register(req.sessionID, {
        email,
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        loginTime: req.session.loginTime,
      });

      logger.info('Login success', { email, ip: req.ip });
      res.json({
        user: { email },
        csrfToken: req.session.csrfToken,
        app: config.getSection('app'),
      });
    });
  }
);

/* POST /api/auth/logout */
router.post('/logout', requireAuth, async (req, res) => {
  const sid = req.sessionID;
  const email = req.session.user && req.session.user.email;
  idleService.teardown(sid);
  await imapClient.closeClient(sid);
  sessionRegistry.remove(sid);
  req.session.destroy((err) => {
    if (err) logger.warn('Session destroy error', { error: err.message });
    res.clearCookie('teramailer.sid');
    logger.info('Logout', { email });
    res.json({ ok: true });
  });
});

/* GET /api/auth/me */
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    user: req.session.user,
    csrfToken: req.session.csrfToken,
    app: config.getSection('app'),
  });
});

/* GET /api/auth/csrf — refresh token without full /me */
router.get('/csrf', requireAuth, (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});

module.exports = router;

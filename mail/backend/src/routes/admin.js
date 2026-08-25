'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const config = require('../config/configManager');
const logger = require('../lib/logger');
const loginGuard = require('../lib/loginGuard');
const sessionRegistry = require('../lib/sessionRegistry');
const { probe } = require('../lib/netProbe');
const imapClient = require('../imap/imapClient');
const idleService = require('../imap/idleService');
const smtpService = require('../smtp/smtpService');
const { requireAdmin } = require('../middleware/adminAuth');
const { csrfProtection } = require('../middleware/auth');

const router = express.Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin login attempts.' },
});

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Invalid request', details: errors.array() });
    return false;
  }
  return true;
}

/* Strip secrets before returning config to the admin UI. */
function publicConfig() {
  const cfg = JSON.parse(JSON.stringify(config.get()));
  if (cfg.security) delete cfg.security.adminPassword;
  return cfg;
}

/* ------------------------------------------------------------------ */
/* Admin auth                                                          */
/* ------------------------------------------------------------------ */

router.post(
  '/login',
  adminLoginLimiter,
  body('username').isString(),
  body('password').isString(),
  async (req, res) => {
    if (!validate(req, res)) return;
    const { username, password } = req.body;
    const sec = config.getSection('security');
    const key = `${req.ip}:admin`;

    const lock = loginGuard.check(key);
    if (lock.locked) {
      return res.status(429).json({ error: `Locked. Retry in ${lock.retryAfter}s.` });
    }

    const userOk = username === sec.adminUsername;
    const passOk = userOk && sec.adminPassword && (await bcrypt.compare(password, sec.adminPassword));

    if (!userOk || !passOk) {
      loginGuard.recordFailure(key);
      logger.warn('Admin login failed', { ip: req.ip, username });
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    loginGuard.reset(key);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not establish admin session' });
      req.session.isAdmin = true;
      req.session.adminUser = username;
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
      logger.info('Admin login success', { ip: req.ip, username });
      res.json({ user: { username }, csrfToken: req.session.csrfToken });
    });
  }
);

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('teramailer.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  res.json({ user: { username: req.session.adminUser }, csrfToken: req.session.csrfToken });
});

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

router.get('/dashboard', requireAdmin, async (req, res) => {
  const imap = config.getSection('imap');
  const smtp = config.getSection('smtp');
  const [imapStatus, smtpStatus] = await Promise.all([
    probe({ host: imap.host, port: imap.port, tls: imap.tls }),
    probe({ host: smtp.host, port: smtp.port, tls: smtp.secure }),
  ]);

  const recentLogins = logger
    .tail(500)
    .filter((l) => l.includes('Login success'))
    .slice(-10)
    .reverse();

  res.json({
    activeSessions: sessionRegistry.count(),
    imapConnections: imapClient.stats().activeConnections,
    imapStatus,
    smtpStatus,
    uptimeSeconds: Math.floor(process.uptime()),
    recentLogins,
    app: config.getSection('app'),
  });
});

/* ------------------------------------------------------------------ */
/* Config read / update                                                */
/* ------------------------------------------------------------------ */

router.get('/config', requireAdmin, (req, res) => {
  res.json(publicConfig());
});

router.post(
  '/config/imap',
  requireAdmin,
  csrfProtection,
  body('host').isString().notEmpty(),
  body('port').toInt().isInt({ min: 1, max: 65535 }),
  body('tls').isBoolean(),
  body('timeout').optional().toInt().isInt({ min: 1000 }),
  body('maxConnections').optional().toInt().isInt({ min: 1 }),
  (req, res) => {
    if (!validate(req, res)) return;
    const { host, port, tls, timeout, maxConnections } = req.body;
    const updated = config.update('imap', {
      host,
      port,
      tls,
      ...(timeout != null ? { timeout } : {}),
      ...(maxConnections != null ? { maxConnections } : {}),
    });
    logger.info('IMAP config updated', { host, port });
    res.json({ ok: true, imap: updated });
  }
);

router.post(
  '/config/smtp',
  requireAdmin,
  csrfProtection,
  body('host').isString().notEmpty(),
  body('port').toInt().isInt({ min: 1, max: 65535 }),
  body('secure').isBoolean(),
  body('requireTLS').optional().isBoolean(),
  body('fromName').optional().isString(),
  body('fromAddress').optional().isString(),
  (req, res) => {
    if (!validate(req, res)) return;
    const { host, port, secure, requireTLS, fromName, fromAddress } = req.body;
    const updated = config.update('smtp', {
      host,
      port,
      secure,
      ...(requireTLS != null ? { requireTLS } : {}),
      ...(fromName != null ? { fromName } : {}),
      ...(fromAddress != null ? { fromAddress } : {}),
    });
    logger.info('SMTP config updated', { host, port });
    res.json({ ok: true, smtp: updated });
  }
);

router.post(
  '/config/domain',
  requireAdmin,
  csrfProtection,
  body('name').optional().isString(),
  body('domain').optional().isString(),
  body('allowedDomains').optional().isArray(),
  body('logo').optional().isString(),
  body('maxUploadMb').optional().toInt().isInt({ min: 1, max: 200 }),
  (req, res) => {
    if (!validate(req, res)) return;
    const patch = {};
    ['name', 'domain', 'allowedDomains', 'logo', 'maxUploadMb'].forEach((k) => {
      if (req.body[k] != null) patch[k] = req.body[k];
    });
    const updated = config.update('app', patch);
    logger.info('App/domain config updated', patch);
    res.json({ ok: true, app: updated });
  }
);

router.post(
  '/config/security',
  requireAdmin,
  csrfProtection,
  body('sessionTTL').optional().toInt().isInt({ min: 60 }),
  body('maxLoginAttempts').optional().toInt().isInt({ min: 1 }),
  body('lockoutDuration').optional().toInt().isInt({ min: 30 }),
  body('ipWhitelist').optional().isArray(),
  body('newPassword').optional().isString().isLength({ min: 6 }),
  async (req, res) => {
    if (!validate(req, res)) return;
    const patch = {};
    ['sessionTTL', 'maxLoginAttempts', 'lockoutDuration', 'ipWhitelist'].forEach((k) => {
      if (req.body[k] != null) patch[k] = req.body[k];
    });
    if (req.body.newPassword) {
      patch.adminPassword = await bcrypt.hash(req.body.newPassword, 10);
    }
    config.update('security', patch);
    logger.info('Security config updated', { changed: Object.keys(patch) });
    res.json({ ok: true, security: publicConfig().security });
  }
);

/* ------------------------------------------------------------------ */
/* Connectivity tests                                                  */
/* ------------------------------------------------------------------ */

router.post('/test/imap', requireAdmin, csrfProtection, async (req, res) => {
  const imap = config.getSection('imap');
  // If admin supplies real mailbox creds, do a full auth check; else reachability.
  if (req.body.email && req.body.password) {
    try {
      await imapClient.verifyCredentials(req.body.email, req.body.password);
      return res.json({ ok: true, message: 'IMAP authentication succeeded' });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }
  const result = await probe({ host: imap.host, port: imap.port, tls: imap.tls });
  res.json(
    result.ok
      ? { ok: true, message: `Connected in ${result.latencyMs}ms` }
      : { ok: false, error: result.error }
  );
});

router.post('/test/smtp', requireAdmin, csrfProtection, async (req, res) => {
  const smtp = config.getSection('smtp');
  // Full path: send a real test email when creds + recipient are supplied.
  if (req.body.email && req.body.password) {
    try {
      const creds = { email: req.body.email, password: req.body.password };
      await smtpService.verify(creds);
      if (req.body.to) {
        await smtpService.send(creds, {
          to: req.body.to,
          subject: 'TeraMailer SMTP test',
          text: 'This is a test email sent from the TeraMailer admin panel.',
        });
        return res.json({ ok: true, message: `Test email sent to ${req.body.to}` });
      }
      return res.json({ ok: true, message: 'SMTP authentication succeeded' });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }
  const result = await probe({ host: smtp.host, port: smtp.port, tls: smtp.secure });
  res.json(
    result.ok
      ? { ok: true, message: `Connected in ${result.latencyMs}ms` }
      : { ok: false, error: result.error }
  );
});

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

router.get('/sessions', requireAdmin, (req, res) => {
  res.json({ sessions: sessionRegistry.list() });
});

router.delete('/sessions/:id', requireAdmin, csrfProtection, async (req, res) => {
  const sid = req.params.id;
  idleService.teardown(sid);
  await imapClient.closeClient(sid);
  sessionRegistry.remove(sid);
  if (req.sessionStore && typeof req.sessionStore.destroy === 'function') {
    req.sessionStore.destroy(sid, () => {});
  }
  logger.info('Admin forced logout', { sessionId: sid });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Logs                                                                */
/* ------------------------------------------------------------------ */

router.get('/logs', requireAdmin, (req, res) => {
  const level = req.query.level ? String(req.query.level).toUpperCase() : null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const lines = logger.tail(limit, ['ERROR', 'WARN', 'INFO'].includes(level) ? level : null);
  res.json({ lines });
});

module.exports = router;

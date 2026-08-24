'use strict';

const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');

const config = require('../config/configManager');
const { requireAuth, csrfProtection } = require('../middleware/auth');
const { sanitizeHtml } = require('../middleware/sanitize');
const smtpService = require('../smtp/smtpService');
const messageService = require('../imap/messageService');
const logger = require('../lib/logger');

const router = express.Router();

function uploadLimitBytes() {
  const mb = (config.getSection('app').maxUploadMb || config.getSection('app').maxUpload || 25);
  return mb * 1024 * 1024;
}

// In-memory storage — attachments are streamed straight into the outgoing mail.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitBytes(), files: 20 },
});

function parseRecipients(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  // Accept comma/semicolon separated strings from the form.
  return String(value)
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildMessage(req) {
  const html = req.body.html ? sanitizeHtml(req.body.html) : undefined;
  return {
    to: parseRecipients(req.body.to),
    cc: parseRecipients(req.body.cc),
    bcc: parseRecipients(req.body.bcc),
    subject: req.body.subject || '',
    text: req.body.text || undefined,
    html,
    files: req.files || [],
    inReplyTo: req.body.inReplyTo || undefined,
    references: req.body.references || undefined,
  };
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Invalid request', details: errors.array() });
    return false;
  }
  if (!parseRecipients(req.body.to).length) {
    res.status(400).json({ error: 'At least one recipient (To) is required' });
    return false;
  }
  return true;
}

/**
 * Send via SMTP, then save a copy to the IMAP Sent folder (best-effort — a
 * failed Sent copy never fails the send). Returns the JSON response body.
 */
async function deliver(req, sendFn) {
  const result = await sendFn(req.creds, buildMessage(req));
  try {
    const saved = await messageService.appendToSent(req.sessionID, req.creds, result.raw);
    if (!saved.appended) {
      logger.warn('Sent copy not saved', { reason: saved.reason });
    }
  } catch (err) {
    logger.warn('Append to Sent failed', { error: err.message });
  }
  return {
    ok: true,
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
  };
}

/* POST /api/send */
router.post('/', requireAuth, csrfProtection, upload.array('attachments'), async (req, res) => {
  if (!validate(req, res)) return;
  try {
    res.json(await deliver(req, smtpService.send));
  } catch (err) {
    logger.error('Send failed', { error: err.message });
    res.status(502).json({ error: 'Could not send message: ' + err.message });
  }
});

/* POST /api/send/reply */
router.post('/reply', requireAuth, csrfProtection, upload.array('attachments'), async (req, res) => {
  if (!validate(req, res)) return;
  try {
    res.json(await deliver(req, smtpService.reply));
  } catch (err) {
    logger.error('Reply failed', { error: err.message });
    res.status(502).json({ error: 'Could not send reply: ' + err.message });
  }
});

/* POST /api/send/forward */
router.post('/forward', requireAuth, csrfProtection, upload.array('attachments'), async (req, res) => {
  if (!validate(req, res)) return;
  try {
    res.json(await deliver(req, smtpService.forward));
  } catch (err) {
    logger.error('Forward failed', { error: err.message });
    res.status(502).json({ error: 'Could not forward message: ' + err.message });
  }
});

module.exports = router;

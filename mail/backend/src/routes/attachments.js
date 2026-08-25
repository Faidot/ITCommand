'use strict';

/**
 * Alternate attachment endpoint mounted at /api/attachments. The primary path
 * (/api/messages/:uid/attachments/:part) lives in messages.js; this provides a
 * flat URL form: /api/attachments/:uid/:part?folder=INBOX
 */

const express = require('express');
const { param } = require('express-validator');

const { requireAuth } = require('../middleware/auth');
const messageService = require('../imap/messageService');
const logger = require('../lib/logger');

const router = express.Router();

router.get(
  '/:uid/:part',
  requireAuth,
  param('uid').toInt().isInt({ min: 1 }),
  async (req, res) => {
    const folder = req.query.folder || 'INBOX';
    let release = () => {};
    try {
      const result = await messageService.downloadAttachment(req.sessionID, req.creds, {
        folder,
        uid: req.params.uid,
        part: req.params.part,
      });
      release = result.release;
      const filename = (result.meta && result.meta.filename) || `attachment-${req.params.part}`;
      res.setHeader('Content-Type', (result.meta && result.meta.contentType) || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
      result.content.on('end', release);
      result.content.on('error', release);
      result.content.pipe(res);
    } catch (err) {
      release();
      logger.error('Attachment download failed', { error: err.message });
      res.status(502).json({ error: 'Could not download attachment: ' + err.message });
    }
  }
);

module.exports = router;

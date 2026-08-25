'use strict';

const express = require('express');
const { query, param, body, validationResult } = require('express-validator');

const { requireAuth, csrfProtection } = require('../middleware/auth');
const messageService = require('../imap/messageService');
const idleService = require('../imap/idleService');
const logger = require('../lib/logger');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Invalid request', details: errors.array() });
    return false;
  }
  return true;
}

/* GET /api/messages/events — SSE stream for real-time new mail (IMAP IDLE) */
router.get('/events', requireAuth, async (req, res) => {
  await idleService.subscribe(req.sessionID, req.creds, res);
});

/* GET /api/messages — paginated listing */
router.get(
  '/',
  requireAuth,
  query('folder').optional().isString(),
  query('page').optional().toInt().isInt({ min: 1 }),
  query('limit').optional().toInt().isInt({ min: 1, max: 100 }),
  query('search').optional().isString(),
  query('state').optional().isIn(['all', 'read', 'unread']),
  async (req, res) => {
    if (!validate(req, res)) return;
    const folder = req.query.folder || 'INBOX';
    const page = req.query.page || 1;
    const limit = req.query.limit || 25;
    const search = req.query.search || '';
    const state = req.query.state || 'all';
    try {
      const result = await messageService.listMessages(req.sessionID, req.creds, {
        folder,
        page,
        limit,
        search,
        state,
      });
      res.json(result);
    } catch (err) {
      logger.error('List messages failed', { folder, error: err.message });
      res.status(502).json({ error: 'Could not load messages: ' + err.message });
    }
  }
);

/* GET /api/messages/:uid — full message body */
router.get(
  '/:uid',
  requireAuth,
  param('uid').toInt().isInt({ min: 1 }),
  query('folder').optional().isString(),
  async (req, res) => {
    if (!validate(req, res)) return;
    const folder = req.query.folder || 'INBOX';
    try {
      const message = await messageService.getMessage(req.sessionID, req.creds, {
        folder,
        uid: req.params.uid,
      });
      res.json(message);
    } catch (err) {
      const status = err.status || 502;
      logger.error('Get message failed', { folder, uid: req.params.uid, error: err.message });
      res.status(status).json({ error: err.message });
    }
  }
);

/* GET /api/messages/:uid/attachments/:part — stream an attachment */
router.get(
  '/:uid/attachments/:part',
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
      result.content.on('error', (e) => {
        logger.warn('Attachment stream error', { error: e.message });
        release();
      });
      result.content.pipe(res);
    } catch (err) {
      release();
      logger.error('Attachment download failed', { error: err.message });
      res.status(502).json({ error: 'Could not download attachment: ' + err.message });
    }
  }
);

/* POST /api/messages/move */
router.post(
  '/move',
  requireAuth,
  csrfProtection,
  body('folder').isString(),
  body('destination').isString(),
  body('uids').isArray({ min: 1 }),
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const result = await messageService.moveMessages(req.sessionID, req.creds, {
        folder: req.body.folder,
        destination: req.body.destination,
        uids: req.body.uids.map(Number),
      });
      res.json(result);
    } catch (err) {
      logger.error('Move failed', { error: err.message });
      res.status(502).json({ error: 'Could not move messages: ' + err.message });
    }
  }
);

/* POST /api/messages/copy */
router.post(
  '/copy',
  requireAuth,
  csrfProtection,
  body('folder').isString(),
  body('destination').isString(),
  body('uids').isArray({ min: 1 }),
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const result = await messageService.copyMessages(req.sessionID, req.creds, {
        folder: req.body.folder,
        destination: req.body.destination,
        uids: req.body.uids.map(Number),
      });
      res.json(result);
    } catch (err) {
      logger.error('Copy failed', { error: err.message });
      res.status(502).json({ error: 'Could not copy messages: ' + err.message });
    }
  }
);

/* POST /api/messages/delete */
router.post(
  '/delete',
  requireAuth,
  csrfProtection,
  body('folder').isString(),
  body('uids').isArray({ min: 1 }),
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const result = await messageService.deleteMessages(req.sessionID, req.creds, {
        folder: req.body.folder,
        uids: req.body.uids.map(Number),
      });
      res.json(result);
    } catch (err) {
      logger.error('Delete failed', { error: err.message });
      res.status(502).json({ error: 'Could not delete messages: ' + err.message });
    }
  }
);

/* POST /api/messages/flag */
router.post(
  '/flag',
  requireAuth,
  csrfProtection,
  body('folder').isString(),
  body('uids').isArray({ min: 1 }),
  body('add').optional().isArray(),
  body('remove').optional().isArray(),
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const result = await messageService.flagMessages(req.sessionID, req.creds, {
        folder: req.body.folder,
        uids: req.body.uids.map(Number),
        add: req.body.add || [],
        remove: req.body.remove || [],
      });
      res.json(result);
    } catch (err) {
      logger.error('Flag failed', { error: err.message });
      res.status(502).json({ error: 'Could not update flags: ' + err.message });
    }
  }
);

module.exports = router;

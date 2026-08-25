'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, csrfProtection } = require('../middleware/auth');
const { listFolders, createFolder } = require('../imap/folderService');
const logger = require('../lib/logger');

const router = express.Router();

/* GET /api/folders — folder tree with unread + total counts */
router.get('/', requireAuth, async (req, res) => {
  try {
    const folders = await listFolders(req.sessionID, req.creds);
    res.json({ folders });
  } catch (err) {
    logger.error('List folders failed', { error: err.message });
    res.status(502).json({ error: 'Could not load folders: ' + err.message });
  }
});

/* POST /api/folders — create a new mailbox/folder */
router.post(
  '/',
  requireAuth,
  csrfProtection,
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'A valid folder name is required' });
    }
    try {
      const result = await createFolder(req.sessionID, req.creds, req.body.name.trim());
      logger.info('Folder created', { path: result.path });
      res.json(result);
    } catch (err) {
      logger.error('Create folder failed', { error: err.message });
      res.status(502).json({ error: 'Could not create folder: ' + err.message });
    }
  }
);

module.exports = router;

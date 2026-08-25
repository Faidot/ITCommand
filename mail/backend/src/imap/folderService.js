'use strict';

/**
 * folderService — list the user's mailboxes with unread/total counts and map
 * them to logical roles (inbox, sent, drafts, trash, junk, archive) using
 * RFC 6154 special-use flags with name-based fallbacks.
 */

const { getClient } = require('./imapClient');
const logger = require('../lib/logger');

const SPECIAL_USE = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive',
  '\\All': 'all',
  '\\Flagged': 'flagged',
};

const NAME_FALLBACK = [
  [/^inbox$/i, 'inbox'],
  [/sent/i, 'sent'],
  [/draft/i, 'drafts'],
  [/trash|deleted/i, 'trash'],
  [/junk|spam/i, 'junk'],
  [/archive/i, 'archive'],
];

function roleFor(box) {
  if (box.specialUse && SPECIAL_USE[box.specialUse]) return SPECIAL_USE[box.specialUse];
  for (const [re, role] of NAME_FALLBACK) {
    if (re.test(box.path) || (box.name && re.test(box.name))) return role;
  }
  return null;
}

async function listFolders(sessionId, creds) {
  const client = await getClient(sessionId, creds);
  const boxes = await client.list();

  const folders = [];
  for (const box of boxes) {
    // Skip non-selectable container folders (\Noselect).
    const selectable = !(box.flags && box.flags.has && box.flags.has('\\Noselect'));
    let total = 0;
    let unread = 0;
    if (selectable) {
      try {
        const status = await client.status(box.path, { messages: true, unseen: true });
        total = status.messages || 0;
        unread = status.unseen || 0;
      } catch (err) {
        logger.warn('Could not status folder', { path: box.path, error: err.message });
      }
    }

    folders.push({
      path: box.path,
      name: box.name,
      delimiter: box.delimiter,
      parent: box.parentPath || null,
      role: roleFor(box),
      subscribed: !!box.subscribed,
      selectable,
      specialUse: box.specialUse || null,
      total,
      unread,
    });
  }

  return folders;
}

async function createFolder(sessionId, creds, path) {
  const client = await getClient(sessionId, creds);
  const result = await client.mailboxCreate(path);
  return { created: true, path: result.path || path };
}

module.exports = { listFolders, roleFor, createFolder };

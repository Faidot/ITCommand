'use strict';

/**
 * imapClient
 * ----------
 * One persistent ImapFlow connection per logged-in user, keyed by session id.
 * Connections are created lazily and re-created automatically if the socket
 * has dropped. Credentials are kept only for the lifetime of the session (in
 * the session store) so a dropped connection can be transparently re-opened.
 */

const { ImapFlow } = require('imapflow');
const config = require('../config/configManager');
const logger = require('../lib/logger');

/** sessionId -> { client, email, lastUsed } */
const pool = new Map();

function buildClient(email, password) {
  const imap = config.getSection('imap');
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: !!imap.tls,
    auth: { user: email, pass: password },
    socketTimeout: imap.timeout || 30000,
    // imapflow's own logger is very chatty; route fatal stuff through ours.
    logger: false,
    emitLogs: false,
  });

  client.on('error', (err) => {
    logger.error('IMAP client error', { email, error: err.message });
  });
  client.on('close', () => {
    logger.warn('IMAP connection closed', { email });
  });

  return client;
}

/**
 * Validate credentials by performing a real IMAP login. Returns true on
 * success, throws on auth/connection failure. Used by the login route before
 * a session is created.
 */
async function verifyCredentials(email, password) {
  const client = buildClient(email, password);
  try {
    await client.connect();
    await client.logout();
    return true;
  } catch (err) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Get a connected client for a session, creating/reconnecting as needed.
 * `creds` ({ email, password }) is required the first time and whenever a
 * reconnect is necessary.
 */
async function getClient(sessionId, creds) {
  const entry = pool.get(sessionId);
  if (entry && entry.client && entry.client.usable) {
    entry.lastUsed = Date.now();
    return entry.client;
  }

  if (!creds || !creds.email || !creds.password) {
    throw new Error('IMAP session expired and no credentials available to reconnect');
  }

  const max = config.getSection('imap').maxConnections || 50;
  if (pool.size >= max && !entry) {
    throw new Error('Maximum number of IMAP connections reached');
  }

  const client = buildClient(creds.email, creds.password);
  await client.connect();
  pool.set(sessionId, { client, email: creds.email, lastUsed: Date.now() });
  logger.info('IMAP connection opened', { email: creds.email, sessionId });
  return client;
}

/** Cleanly close and remove a session's connection (logout / force logout). */
async function closeClient(sessionId) {
  const entry = pool.get(sessionId);
  if (!entry) return;
  pool.delete(sessionId);
  try {
    if (entry.client && entry.client.usable) {
      await entry.client.logout();
    } else if (entry.client) {
      entry.client.close();
    }
  } catch (err) {
    logger.warn('Error while closing IMAP connection', { error: err.message });
  }
}

/** Run `fn(client)` inside a mailbox lock so operations are serialised. */
async function withMailbox(sessionId, creds, mailbox, fn) {
  const client = await getClient(sessionId, creds);
  const lock = await client.getMailboxLock(mailbox);
  try {
    return await fn(client);
  } finally {
    lock.release();
  }
}

/** Snapshot of the pool for the admin dashboard. */
function stats() {
  return {
    activeConnections: pool.size,
    connections: [...pool.entries()].map(([sid, e]) => ({
      sessionId: sid,
      email: e.email,
      lastUsed: e.lastUsed,
    })),
  };
}

module.exports = {
  buildClient,
  verifyCredentials,
  getClient,
  closeClient,
  withMailbox,
  stats,
  pool,
};

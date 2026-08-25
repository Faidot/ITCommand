'use strict';

/**
 * idleService — real-time new-mail notifications over Server-Sent Events.
 *
 * imapflow automatically issues IDLE whenever a mailbox is open and no command
 * is running, emitting `exists` / `expunge` events. We attach listeners to the
 * pooled client and fan those events out to any SSE subscribers for the session.
 */

const { getClient } = require('./imapClient');
const logger = require('../lib/logger');

/** sessionId -> Set<res> */
const subscribers = new Map();
/** sessionId -> true once listeners are wired on the client */
const wired = new Map();

function send(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* connection gone — cleanup happens on 'close' */
  }
}

async function wireClient(sessionId, creds) {
  if (wired.get(sessionId)) return;
  const client = await getClient(sessionId, creds);

  const broadcast = (event, payload) => {
    const subs = subscribers.get(sessionId);
    if (!subs) return;
    for (const res of subs) send(res, event, payload);
  };

  client.on('exists', (data) => {
    logger.info('IMAP exists event', { sessionId, path: data.path, count: data.count });
    broadcast('mail', { type: 'new', path: data.path, count: data.count });
  });
  client.on('expunge', (data) => {
    broadcast('mail', { type: 'expunge', path: data.path, seq: data.seq });
  });
  client.on('flags', (data) => {
    broadcast('mail', { type: 'flags', path: data.path });
  });

  // Make sure a mailbox is selected so IDLE actually runs.
  try {
    await client.mailboxOpen('INBOX');
  } catch (err) {
    logger.warn('idle: could not open INBOX', { error: err.message });
  }

  wired.set(sessionId, true);
}

/** Register an SSE response stream for a session. */
async function subscribe(sessionId, creds, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders && res.flushHeaders();
  send(res, 'ready', { ok: true });

  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
  subscribers.get(sessionId).add(res);

  // Heartbeat keeps proxies from closing the idle connection.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    const subs = subscribers.get(sessionId);
    if (subs) {
      subs.delete(res);
      if (subs.size === 0) subscribers.delete(sessionId);
    }
  };
  res.on('close', cleanup);

  try {
    await wireClient(sessionId, creds);
  } catch (err) {
    logger.warn('idle: failed to wire client', { error: err.message });
    send(res, 'error', { message: 'Could not start real-time updates' });
  }
}

/** Drop all subscribers + wiring state for a session (on logout). */
function teardown(sessionId) {
  const subs = subscribers.get(sessionId);
  if (subs) {
    for (const res of subs) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    subscribers.delete(sessionId);
  }
  wired.delete(sessionId);
}

module.exports = { subscribe, teardown };

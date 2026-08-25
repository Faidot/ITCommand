'use strict';

/**
 * messageService — FETCH (list + detail), SEARCH, MOVE, DELETE and FLAG
 * operations against a user's mailboxes. HTML bodies are parsed with mailparser
 * and sanitised before being returned to the client.
 */

const { simpleParser } = require('mailparser');
const { withMailbox, getClient } = require('./imapClient');
const { sanitizeEmailHtml } = require('../middleware/sanitize');

/* --------------------------------------------------------------------- */
/* Helpers                                                                */
/* --------------------------------------------------------------------- */

function addressList(addr) {
  if (!addr) return [];
  const arr = Array.isArray(addr) ? addr : [addr];
  return arr.map((a) => ({ name: a.name || '', address: a.address || '' }));
}

function envelopeToJson(env) {
  if (!env) return {};
  return {
    date: env.date || null,
    subject: env.subject || '(no subject)',
    from: addressList(env.from),
    to: addressList(env.to),
    cc: addressList(env.cc),
    bcc: addressList(env.bcc),
    replyTo: addressList(env.replyTo),
    messageId: env.messageId || null,
    inReplyTo: env.inReplyTo || null,
  };
}

function flagsToJson(flags) {
  const set = flags || new Set();
  return {
    seen: set.has('\\Seen'),
    flagged: set.has('\\Flagged'),
    answered: set.has('\\Answered'),
    draft: set.has('\\Draft'),
    deleted: set.has('\\Deleted'),
    raw: [...set],
  };
}

/** Walk a bodyStructure tree collecting downloadable parts. */
function collectAttachments(node, acc = []) {
  if (!node) return acc;
  const disposition = (node.disposition || '').toLowerCase();
  const filename =
    (node.dispositionParameters && node.dispositionParameters.filename) ||
    (node.parameters && node.parameters.name) ||
    null;

  const isAttachment = disposition === 'attachment' || (!!filename && node.part);
  const isInline = disposition === 'inline' && node.id;

  if ((isAttachment || isInline) && node.part) {
    acc.push({
      part: node.part,
      filename: filename || `part-${node.part}`,
      contentType: node.type || 'application/octet-stream',
      size: node.size || 0,
      contentId: node.id ? node.id.replace(/[<>]/g, '') : null,
      inline: isInline,
    });
  }

  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) collectAttachments(child, acc);
  }
  return acc;
}

/* --------------------------------------------------------------------- */
/* List                                                                   */
/* --------------------------------------------------------------------- */

/**
 * Paginated, newest-first listing. Supports a free-text `search` string which
 * is translated into an IMAP SEARCH across from/subject/body.
 */
async function listMessages(sessionId, creds, { folder, page = 1, limit = 25, search = '', state = 'all' }) {
  return withMailbox(sessionId, creds, folder, async (client) => {
    // Build IMAP SEARCH criteria. Keys on the object are ANDed together, so we
    // can combine a read/unread filter with a free-text OR search.
    const criteria = {};
    if (state === 'unread') criteria.seen = false;
    else if (state === 'read') criteria.seen = true;

    const q = (search || '').trim();
    if (q) criteria.or = [{ from: q }, { subject: q }, { body: q }, { to: q }];

    const hasCriteria = Object.keys(criteria).length > 0;
    let uids = await client.search(hasCriteria ? criteria : { all: true }, { uid: true });
    uids = (uids || []).sort((a, b) => b - a); // newest (highest uid) first

    const total = uids.length;
    const start = (page - 1) * limit;
    const pageUids = uids.slice(start, start + limit);

    const messages = [];
    if (pageUids.length) {
      for await (const msg of client.fetch(
        pageUids.join(','),
        { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true },
        { uid: true }
      )) {
        const attachments = collectAttachments(msg.bodyStructure);
        messages.push({
          uid: msg.uid,
          envelope: envelopeToJson(msg.envelope),
          flags: flagsToJson(msg.flags),
          internalDate: msg.internalDate || null,
          size: msg.size || 0,
          hasAttachments: attachments.some((a) => !a.inline),
        });
      }
      // fetch order is not guaranteed; restore newest-first by uid
      messages.sort((a, b) => b.uid - a.uid);
    }

    return {
      folder,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      messages,
    };
  });
}

/* --------------------------------------------------------------------- */
/* Detail                                                                 */
/* --------------------------------------------------------------------- */

async function getMessage(sessionId, creds, { folder, uid, markSeen = true }) {
  return withMailbox(sessionId, creds, folder, async (client) => {
    const msg = await client.fetchOne(
      String(uid),
      { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, source: true },
      { uid: true }
    );
    if (!msg || !msg.source) {
      const err = new Error('Message not found');
      err.status = 404;
      throw err;
    }

    const parsed = await simpleParser(msg.source);
    const attachments = collectAttachments(msg.bodyStructure);

    // Build cid -> attachment url map and rewrite inline image references.
    let html = parsed.html || (parsed.textAsHtml || '') || '';
    for (const att of attachments) {
      if (att.contentId) {
        const url = `/api/messages/${uid}/attachments/${encodeURIComponent(att.part)}?folder=${encodeURIComponent(folder)}`;
        html = html.split(`cid:${att.contentId}`).join(url);
      }
    }
    const safeHtml = sanitizeEmailHtml(html);

    if (markSeen && !(msg.flags && msg.flags.has('\\Seen'))) {
      try {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      } catch {
        /* non-fatal */
      }
    }

    return {
      uid: msg.uid,
      folder,
      envelope: envelopeToJson(msg.envelope),
      flags: flagsToJson(msg.flags),
      internalDate: msg.internalDate || null,
      html: safeHtml,
      text: parsed.text || '',
      headers: {
        messageId: parsed.messageId || null,
        inReplyTo: parsed.inReplyTo || null,
        references: parsed.references || null,
      },
      attachments: attachments
        .filter((a) => !a.inline)
        .map((a) => ({
          part: a.part,
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
    };
  });
}

/* --------------------------------------------------------------------- */
/* Attachment download                                                    */
/* --------------------------------------------------------------------- */

async function downloadAttachment(sessionId, creds, { folder, uid, part }) {
  const client = await getClient(sessionId, creds);
  const lock = await client.getMailboxLock(folder);
  try {
    const { meta, content } = await client.download(String(uid), part, { uid: true });
    // Caller is responsible for piping `content` and releasing the lock when done.
    return { meta, content, release: () => lock.release() };
  } catch (err) {
    lock.release();
    throw err;
  }
}

/* --------------------------------------------------------------------- */
/* Mutations                                                              */
/* --------------------------------------------------------------------- */

async function moveMessages(sessionId, creds, { folder, uids, destination }) {
  return withMailbox(sessionId, creds, folder, async (client) => {
    await client.messageMove(uids.join(','), destination, { uid: true });
    return { moved: uids.length, destination };
  });
}

async function copyMessages(sessionId, creds, { folder, uids, destination }) {
  return withMailbox(sessionId, creds, folder, async (client) => {
    await client.messageCopy(uids.join(','), destination, { uid: true });
    return { copied: uids.length, destination };
  });
}

async function deleteMessages(sessionId, creds, { folder, uids }) {
  return withMailbox(sessionId, creds, folder, async (client) => {
    await client.messageFlagsAdd(uids.join(','), ['\\Deleted'], { uid: true });
    await client.messageDelete(uids.join(','), { uid: true });
    return { deleted: uids.length };
  });
}

async function flagMessages(sessionId, creds, { folder, uids, add = [], remove = [] }) {
  return withMailbox(sessionId, creds, folder, async (client) => {
    if (add.length) await client.messageFlagsAdd(uids.join(','), add, { uid: true });
    if (remove.length) await client.messageFlagsRemove(uids.join(','), remove, { uid: true });
    return { updated: uids.length, add, remove };
  });
}

/* --------------------------------------------------------------------- */
/* Save a copy of an outgoing message to the Sent folder (IMAP APPEND)    */
/* --------------------------------------------------------------------- */

const SENT_NAME_RE = /^(sent|sent items|sent mail|sent messages|outbox)$/i;

async function resolveSentFolder(client) {
  const boxes = await client.list();
  // 1) RFC 6154 special-use flag.
  let sent = boxes.find((b) => b.specialUse === '\\Sent');
  if (sent) return sent.path;
  // 2) Well-known names (handles Dovecot/cPanel "Sent", "INBOX.Sent", etc.).
  sent = boxes.find((b) => SENT_NAME_RE.test(b.name || ''));
  if (sent) return sent.path;
  sent = boxes.find((b) => /(^|[./])sent($|[./])/i.test(b.path || ''));
  return sent ? sent.path : null;
}

/**
 * APPEND a raw RFC822 message to the user's Sent folder, flagged \Seen, so
 * sent mail appears in the Sent view. Best-effort: returns {appended:false}
 * (rather than throwing) when no Sent folder can be found.
 */
async function appendToSent(sessionId, creds, raw) {
  if (!raw) return { appended: false, reason: 'no raw message' };
  const client = await getClient(sessionId, creds);
  const sentPath = await resolveSentFolder(client);
  if (!sentPath) return { appended: false, reason: 'no Sent folder found' };
  await client.append(sentPath, raw, ['\\Seen']);
  return { appended: true, path: sentPath };
}

module.exports = {
  listMessages,
  getMessage,
  downloadAttachment,
  moveMessages,
  copyMessages,
  deleteMessages,
  flagMessages,
  appendToSent,
  envelopeToJson,
};

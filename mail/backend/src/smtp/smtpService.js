'use strict';

/**
 * smtpService — outbound mail via nodemailer. A transport is built per send
 * using the global SMTP config plus the authenticated user's own credentials,
 * so messages are sent as that user.
 */

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const config = require('../config/configManager');
const logger = require('../lib/logger');

function buildTransport(creds) {
  const smtp = config.getSection('smtp');
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: !!smtp.secure, // true for 465, false for 587 (STARTTLS)
    requireTLS: !!smtp.requireTLS,
    auth: { user: creds.email, pass: creds.password },
  });
}

function toAddressLine(list) {
  if (!list) return undefined;
  if (Array.isArray(list)) return list.filter(Boolean).join(', ');
  return list;
}

function fromHeader(creds) {
  const smtp = config.getSection('smtp');
  const name = smtp.fromName || config.getSection('app').name || '';
  return name ? { name, address: creds.email } : creds.email;
}

function mapAttachments(files) {
  if (!files || !files.length) return [];
  return files.map((f) => ({
    filename: f.originalname,
    content: f.buffer,
    contentType: f.mimetype,
  }));
}

/** Verify the SMTP server is reachable / auth works. */
async function verify(creds) {
  const transport = buildTransport(creds);
  await transport.verify();
  return true;
}

/** Build a stable Message-ID so the sent mail and the Sent-folder copy match. */
function makeMessageId(creds) {
  const domain = (creds.email.split('@')[1] || 'localhost').trim();
  return `<${crypto.randomBytes(16).toString('hex')}@${domain}>`;
}

function buildMailOptions(creds, message) {
  return {
    messageId: message.messageId, // pre-generated so SMTP + IMAP copy agree
    from: fromHeader(creds),
    to: toAddressLine(message.to),
    cc: toAddressLine(message.cc),
    bcc: toAddressLine(message.bcc),
    subject: message.subject || '(no subject)',
    text: message.text,
    html: message.html,
    attachments: mapAttachments(message.files),
    inReplyTo: message.inReplyTo,
    references: message.references,
    headers: message.headers,
  };
}

/** Compile the message to a raw RFC822 buffer (for the IMAP Sent copy). */
function compileRaw(mailOptions) {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOptions).compile().build((err, msg) => (err ? reject(err) : resolve(msg)));
  });
}

/**
 * Generic send. `message` = { to, cc, bcc, subject, html, text, files, headers }.
 * Returns { messageId, accepted, rejected, raw } where `raw` is the RFC822 buffer
 * the caller appends to the user's Sent folder over IMAP.
 */
async function send(creds, message) {
  const transport = buildTransport(creds);
  const mailOptions = buildMailOptions(creds, { ...message, messageId: message.messageId || makeMessageId(creds) });

  const info = await transport.sendMail(mailOptions);

  // Best-effort raw build for the Sent copy; never blocks the send result.
  let raw = null;
  try {
    raw = await compileRaw(mailOptions);
  } catch (err) {
    logger.warn('Could not compile raw message for Sent copy', { error: err.message });
  }

  logger.info('Mail sent', { from: creds.email, to: message.to, messageId: info.messageId });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, raw };
}

/** Reply: threads via In-Reply-To / References. */
async function reply(creds, message) {
  const references = [message.references, message.inReplyTo].filter(Boolean).join(' ').trim();
  return send(creds, {
    ...message,
    references: references || undefined,
  });
}

/** Forward: original body is expected to be quoted into message.html/text by caller or here. */
async function forward(creds, message) {
  return send(creds, message);
}

module.exports = { buildTransport, verify, send, reply, forward };

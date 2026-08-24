import { useCallback, useState } from 'react';
import client, { errorMessage } from '../api/client.js';

// Compose modes.
export const COMPOSE_MODE = {
  NEW: 'new',
  REPLY: 'reply',
  REPLY_ALL: 'replyAll',
  FORWARD: 'forward',
};

// Format an address object {name, address} into a display/header string.
function formatAddress(a) {
  if (!a) return '';
  if (a.name && a.address) return `${a.name} <${a.address}>`;
  return a.address || a.name || '';
}

function joinAddresses(list) {
  return (list || []).map(formatAddress).filter(Boolean).join(', ');
}

// Build a quoted HTML block from the original message for reply/forward.
function buildQuotedHtml(original, mode) {
  if (!original) return '';
  const env = original.envelope || {};
  const fromName = joinAddresses(env.from) || 'Unknown sender';
  const when = env.date
    ? new Date(env.date).toLocaleString()
    : '';
  const body = original.html || (original.text
    ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
        original.text
      )}</pre>`
    : '');

  if (mode === COMPOSE_MODE.FORWARD) {
    return `
<br><br>
<div class="forwarded">
  ---------- Forwarded message ----------<br>
  <b>From:</b> ${escapeHtml(fromName)}<br>
  <b>Date:</b> ${escapeHtml(when)}<br>
  <b>Subject:</b> ${escapeHtml(env.subject || '')}<br>
  <b>To:</b> ${escapeHtml(joinAddresses(env.to))}<br>
  <br>
  ${body}
</div>`;
  }

  // Reply / Reply All — Gmail-style attribution + blockquote.
  return `
<br><br>
<div class="gmail_quote">
  On ${escapeHtml(when)}, ${escapeHtml(fromName)} wrote:<br>
  <blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">
    ${body}
  </blockquote>
</div>`;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Prefix a subject for reply/forward without doubling existing prefixes.
function prefixSubject(subject = '', prefix) {
  const re = prefix === 'Re:' ? /^re:/i : /^fwd?:/i;
  if (re.test(subject.trim())) return subject;
  return `${prefix} ${subject}`.trim();
}

const EMPTY_DRAFT = {
  mode: COMPOSE_MODE.NEW,
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  html: '',
  inReplyTo: '',
  references: '',
  showCc: false,
  showBcc: false,
};

// Owns the ComposeModal state and the send logic.
// `selfEmail` is used to exclude the current user from Reply All recipients.
export default function useCompose(selfEmail) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [sending, setSending] = useState(false);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Open a blank compose window.
  const openNew = useCallback((prefill = {}) => {
    setDraft({ ...EMPTY_DRAFT, ...prefill });
    setIsOpen(true);
  }, []);

  // Open a reply / reply-all / forward window prefilled from `original`
  // (the full message object returned by GET /api/messages/:uid).
  const openReply = useCallback(
    (original, mode = COMPOSE_MODE.REPLY) => {
      const env = original?.envelope || {};
      const headers = original?.headers || {};

      // Recipients
      let to = '';
      let cc = '';
      if (mode === COMPOSE_MODE.FORWARD) {
        to = '';
      } else {
        // Reply goes to replyTo (if present) else from.
        const replyTargets =
          env.replyTo && env.replyTo.length ? env.replyTo : env.from;
        to = joinAddresses(replyTargets);

        if (mode === COMPOSE_MODE.REPLY_ALL) {
          // Include original To + Cc, minus self and minus the reply target.
          const self = (selfEmail || '').toLowerCase();
          const replyAddrs = new Set(
            (replyTargets || []).map((a) =>
              (a.address || '').toLowerCase()
            )
          );
          const extra = [...(env.to || []), ...(env.cc || [])].filter((a) => {
            const addr = (a.address || '').toLowerCase();
            return addr && addr !== self && !replyAddrs.has(addr);
          });
          cc = joinAddresses(extra);
        }
      }

      // Subject
      const subject =
        mode === COMPOSE_MODE.FORWARD
          ? prefixSubject(env.subject || '', 'Fwd:')
          : prefixSubject(env.subject || '', 'Re:');

      // Threading headers
      const inReplyTo = headers.messageId || env.messageId || '';
      const references = [headers.references, headers.messageId || env.messageId]
        .filter(Boolean)
        .join(' ')
        .trim();

      setDraft({
        ...EMPTY_DRAFT,
        mode,
        to,
        cc,
        showCc: !!cc,
        subject,
        html: buildQuotedHtml(original, mode),
        inReplyTo,
        references,
        // Keep the original uid/folder so forward could re-attach if needed.
        originalUid: original?.uid,
        originalFolder: original?.folder,
      });
      setIsOpen(true);
    },
    [selfEmail]
  );

  // Send the current draft (or a provided payload). `attachments` is a File[].
  // Returns the server response. Throws with a readable message on failure.
  const send = useCallback(
    async (payload, attachments = []) => {
      setSending(true);
      try {
        const form = new FormData();
        form.append('to', payload.to || '');
        form.append('cc', payload.cc || '');
        form.append('bcc', payload.bcc || '');
        form.append('subject', payload.subject || '');
        form.append('html', payload.html || '');
        // Provide a plain-text fallback derived from the HTML.
        form.append('text', htmlToText(payload.html || ''));
        if (payload.inReplyTo) form.append('inReplyTo', payload.inReplyTo);
        if (payload.references) form.append('references', payload.references);

        // The backend expects the file field name to be exactly "attachments".
        for (const file of attachments) {
          form.append('attachments', file, file.name);
        }

        // Choose endpoint by mode.
        let url = '/api/send';
        if (
          payload.mode === COMPOSE_MODE.REPLY ||
          payload.mode === COMPOSE_MODE.REPLY_ALL
        ) {
          url = '/api/send/reply';
        } else if (payload.mode === COMPOSE_MODE.FORWARD) {
          url = '/api/send/forward';
        }

        // Let the browser set the multipart boundary; only override Content-Type.
        const { data } = await client.post(url, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
      } catch (err) {
        throw new Error(errorMessage(err, 'Failed to send message'));
      } finally {
        setSending(false);
      }
    },
    []
  );

  return {
    isOpen,
    draft,
    sending,
    openNew,
    openReply,
    close,
    send,
    setDraft,
  };
}

// Very small HTML -> text fallback for the multipart text part.
function htmlToText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

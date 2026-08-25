'use strict';

/**
 * Server-side HTML sanitisation for rendered email bodies. Uses
 * isomorphic-dompurify (DOMPurify + jsdom). Email HTML is hostile by default,
 * so we strip scripts/forms/event handlers and force links to open safely.
 */

const DOMPurify = require('isomorphic-dompurify');

const EMAIL_CONFIG = {
  WHOLE_DOCUMENT: false,
  ALLOWED_TAGS: [
    'a', 'b', 'i', 'u', 'em', 'strong', 'p', 'br', 'div', 'span', 'ul', 'ol', 'li',
    'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead',
    'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'hr', 'sub', 'sup', 'small', 'font',
    'center', 'figure', 'figcaption', 'caption', 'col', 'colgroup',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'width', 'height', 'align', 'valign', 'style',
    'colspan', 'rowspan', 'color', 'bgcolor', 'border', 'cellpadding', 'cellspacing',
    'target', 'rel', 'class',
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

// Force external links to open in a new tab without leaking the opener.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

function sanitizeEmailHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, EMAIL_CONFIG);
}

/** Generic sanitiser for arbitrary user-supplied HTML (e.g. compose body). */
function sanitizeHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, EMAIL_CONFIG);
}

module.exports = { sanitizeEmailHtml, sanitizeHtml };

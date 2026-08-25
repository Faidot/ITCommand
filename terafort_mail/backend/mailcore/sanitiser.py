"""Making a message body safe to render.

This is not the only defence and must not be treated as one. Blueprint
section 10 puts a sandboxed iframe on a separate origin, with no scripts and
`default-src 'none'`, in front of whatever comes out of here. Two independent
mechanisms have to fail before a message can run code.

**Why this file does not implement its own sanitiser.** Hand-rolled HTML
allowlisting is where XSS lives: mutation XSS, mXSS through namespace
confusion, `<svg><style>` parser differentials, attribute smuggling. These are
subtle enough that the people who find them write papers. So we use a
maintained library, and when it is absent we fall back to **stripping HTML
entirely and rendering plain text** — degraded, never unsafe.
"""
from __future__ import annotations

import html
import logging
import re

log = logging.getLogger("mailcore.sanitiser")

try:  # pragma: no cover - import shape depends on the deployment
    import bleach
    HAVE_BLEACH = True
except ImportError:  # pragma: no cover
    bleach = None
    HAVE_BLEACH = False

#: What a message body is allowed to contain. Deliberately dull: mail is
#: formatted text, not an application. No <form>, no <iframe>, no <object>,
#: no <svg> (mXSS), no <style> (CSS exfiltration and layout escape).
ALLOWED_TAGS = [
    "p", "br", "div", "span", "a", "b", "strong", "i", "em", "u", "s",
    "ul", "ol", "li", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "img", "hr", "sub", "sup", "small",
]

ALLOWED_ATTRS = {
    "*": ["title", "dir", "lang"],
    "a": ["href", "title", "rel", "target"],
    "img": ["src", "alt", "width", "height"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
}

#: `data:` is absent on purpose: a data URI image is a fine way to smuggle
#: SVG, and an inline payload we would then be serving from our own frame.
ALLOWED_PROTOCOLS = ["http", "https", "mailto", "cid"]

_IMG_REMOTE = re.compile(r'<img[^>]+src=["\']https?://', re.I)
_ANCHOR = re.compile(r'<a\b[^>]*href=["\'](?P<href>[^"\']*)["\'][^>]*>(?P<text>.*?)</a>',
                     re.I | re.S)
_TAG = re.compile(r"<[^>]+>")
_DOMAIN = re.compile(r"^(?:https?://)?(?:www\.)?([^/:?#\s]+)", re.I)


def _domain(value: str) -> str:
    match = _DOMAIN.match((value or "").strip())
    return match.group(1).lower() if match else ""


def detect_link_mismatch(raw_html: str) -> bool:
    """True when a link's visible text claims a different destination.

    Only fires when the text *looks like* a URL or a domain. A link reading
    "click here" is not a mismatch, it is just a link, and flagging those
    would train people to ignore the warning — which is worse than not having
    one.
    """
    for match in _ANCHOR.finditer(raw_html or ""):
        href = match.group("href")
        text = html.unescape(_TAG.sub("", match.group("text"))).strip()
        if not text or "." not in text or " " in text:
            continue
        shown, actual = _domain(text), _domain(href)
        if not shown or not actual:
            continue
        # A subdomain of the claimed host is not a lie: news.example.com under
        # text saying example.com is normal marketing mail.
        if shown == actual or actual.endswith("." + shown) or shown.endswith("." + actual):
            continue
        return True
    return False


def _harden_links(clean: str) -> str:
    """Every surviving link opens away from us and carries no referrer."""
    def fix(match):
        tag = match.group(0)
        if "target=" not in tag.lower():
            tag = tag[:-1] + ' target="_blank">'
        if "rel=" not in tag.lower():
            tag = tag[:tag.rindex(">")] + ' rel="noopener noreferrer nofollow">'
        return tag
    return re.sub(r"<a\b[^>]*>", fix, clean, flags=re.I)


def clean(raw_html: str) -> tuple:
    """Return ``(safe_html, findings)``.

    `findings` carries `remote_images` and `link_mismatch`, computed on the
    ORIGINAL html — after cleaning, a stripped-out tracking pixel would look
    like a message that never had one.
    """
    raw_html = raw_html or ""
    findings = {
        "remote_images": bool(_IMG_REMOTE.search(raw_html)),
        "link_mismatch": detect_link_mismatch(raw_html),
        "sanitiser": "bleach" if HAVE_BLEACH else "text-only",
    }

    if not raw_html.strip():
        return "", findings

    if not HAVE_BLEACH:
        # Fail safe, loudly. Text is a worse reading experience; rendering
        # unsanitised HTML would be a vulnerability.
        log.error(
            "bleach is not installed — message HTML is being reduced to text. "
            "Install it (see requirements.txt) to restore formatted mail.")
        text = html.unescape(_TAG.sub(" ", raw_html))
        return "<pre>%s</pre>" % html.escape(" ".join(text.split())), findings

    safe = bleach.clean(
        raw_html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )
    return _harden_links(safe), findings


def to_preview(text: str, html_body: str = "", length: int = 140) -> str:
    """The one-line snippet in the message list."""
    source = text or html.unescape(_TAG.sub(" ", html_body or ""))
    flat = " ".join(source.split())
    return flat[:length] + ("…" if len(flat) > length else "")

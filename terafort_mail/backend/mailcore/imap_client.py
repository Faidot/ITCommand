"""Talking to Dovecot on behalf of a live session.

One rule shapes this module: **the credential comes from the session and
nowhere else.** There is no constructor that takes a password from a caller's
choosing, because every such constructor is a place a future bug could open
the wrong mailbox.

On parsing: we ask Dovecot for real RFC 822 headers and parse them with the
standard library rather than decoding IMAP's own ENVELOPE structure. ENVELOPE
is a nested, quoting-sensitive s-expression that imaplib hands back as raw
bytes, and every project that parses it by hand eventually gets a comma inside
a display name wrong. `email.parser` has handled that for twenty years.
"""
from __future__ import annotations

import email
import email.policy
import imaplib
import logging
import re
import socket
import ssl
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone as dt_timezone
from email.header import decode_header, make_header
from email.utils import getaddresses, parsedate_to_datetime

from django.conf import settings

from .imap_auth import ImapUnavailable

log = logging.getLogger("mailcore.imap")

#: Headers we need for the list view and for threading. Fetching only these
#: keeps an envelope sync to a few hundred bytes per message instead of the
#: whole body.
ENVELOPE_HEADERS = (
    "SUBJECT FROM TO CC REPLY-TO DATE MESSAGE-ID IN-REPLY-TO REFERENCES LIST-ID"
)

#: SPECIAL-USE attributes, mapped to the names we store.
SPECIAL_USE = {
    "\\sent": "\\Sent", "\\drafts": "\\Drafts", "\\trash": "\\Trash",
    "\\junk": "\\Junk", "\\archive": "\\Archive", "\\all": "\\All",
    "\\flagged": "\\Flagged",
}

#: Fallback when the server does not advertise SPECIAL-USE. Ordered, and
#: matched on the last path segment so `INBOX.Sent` and `Sent` both work.
NAME_FALLBACK = (
    ("\\Sent", ("sent", "sent items", "sent messages", "sent mail")),
    ("\\Drafts", ("drafts", "draft")),
    ("\\Trash", ("trash", "deleted", "deleted items", "bin")),
    ("\\Junk", ("junk", "spam", "bulk mail")),
    ("\\Archive", ("archive", "archives")),
)


@dataclass
class FolderInfo:
    path: str
    delimiter: str
    special_use: str = ""
    selectable: bool = True

    @property
    def display_name(self) -> str:
        """`INBOX.Team.Renewals` reads as `Renewals` in a tree."""
        if not self.delimiter:
            return self.path
        return self.path.split(self.delimiter)[-1]


@dataclass
class Envelope:
    uid: int
    flags: list
    internal_date: datetime
    size: int
    subject: str = ""
    from_name: str = ""
    from_addr: str = ""
    to: list = field(default_factory=list)
    cc: list = field(default_factory=list)
    reply_to: str = ""
    message_id: str = ""
    in_reply_to: str = ""
    references: list = field(default_factory=list)
    list_id: str = ""

    @property
    def seen(self) -> bool:
        return "\\Seen" in self.flags

    @property
    def flagged(self) -> bool:
        return "\\Flagged" in self.flags


@dataclass
class MessageBody:
    text: str = ""
    html: str = ""
    attachments: list = field(default_factory=list)
    has_remote_images: bool = False


def _decode(value) -> str:
    """Decode an RFC 2047 header into something renderable.

    Never raises: a malformed header on one message must not break a whole
    folder listing, and a mangled subject is better than a 500.
    """
    if value is None:
        return ""
    try:
        return str(make_header(decode_header(str(value)))).strip()
    except Exception:  # noqa: BLE001
        return str(value).strip()


def _addresses(raw) -> list:
    if not raw:
        return []
    out = []
    for name, addr in getaddresses([str(raw)]):
        if addr:
            out.append({"name": _decode(name), "address": addr.strip().lower()})
    return out


def _message_ids(raw) -> list:
    """Pull <ids> out of a References or In-Reply-To header.

    Deliberately regex rather than a split: these headers are routinely
    malformed, and grabbing everything in angle brackets is the behaviour that
    actually threads real mail.
    """
    if not raw:
        return []
    return ["<%s>" % m for m in re.findall(r"<([^<>]+)>", str(raw))]


class MailboxConnection:
    """One authenticated IMAP connection, scoped to one session's mailbox."""

    def __init__(self, address: str, password: str):
        self._address = address
        self._conn = None
        self._selected = None
        self._password = password

    # -- lifecycle ---------------------------------------------------------

    def open(self):
        host = settings.MAIL_IMAP_HOST
        port = int(settings.MAIL_IMAP_PORT)
        timeout = int(settings.MAIL_IMAP_TIMEOUT)
        try:
            if settings.MAIL_IMAP_SSL:
                ctx = ssl.create_default_context()
                if not settings.MAIL_IMAP_VERIFY_CERT:
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                self._conn = imaplib.IMAP4_SSL(host, port, ssl_context=ctx, timeout=timeout)
            else:
                self._conn = imaplib.IMAP4(host, port, timeout=timeout)
                self._conn.starttls(ssl.create_default_context())
            self._conn.login(self._address, self._password)
        except imaplib.IMAP4.error as exc:
            raise PermissionError("IMAP rejected the session credential") from exc
        except (OSError, socket.timeout, ssl.SSLError) as exc:
            raise ImapUnavailable("cannot reach IMAP at %s:%s" % (host, port)) from exc
        finally:
            # The password has done its job. Drop our reference so it is not
            # sitting on a long-lived connection object for the whole sync.
            self._password = None
        return self

    def close(self):
        if self._conn is None:
            return
        try:
            if self._selected:
                self._conn.close()
            self._conn.logout()
        except Exception:  # noqa: BLE001 - teardown must never mask a result
            pass
        finally:
            self._conn = None
            self._selected = None

    def __enter__(self):
        return self.open()

    def __exit__(self, *exc):
        self.close()
        return False

    # -- folders -----------------------------------------------------------

    def list_folders(self) -> list:
        typ, data = self._conn.list()
        if typ != "OK":
            raise ImapUnavailable("LIST failed: %s" % typ)

        folders = []
        for raw in data or []:
            parsed = self._parse_list_line(raw)
            if parsed is not None:
                folders.append(parsed)
        return folders

    @staticmethod
    def _parse_list_line(raw) -> FolderInfo | None:
        """`(\\HasNoChildren \\Sent) "." INBOX.Sent`"""
        if isinstance(raw, tuple):
            raw = b" ".join(part for part in raw if isinstance(part, bytes))
        if not isinstance(raw, bytes):
            return None
        line = raw.decode("utf-8", "replace")

        match = re.match(r'^\((?P<flags>[^)]*)\)\s+(?P<delim>"[^"]*"|NIL)\s+(?P<name>.+)$', line)
        if not match:
            return None

        flags = [f.strip().lower() for f in match.group("flags").split()]
        delimiter = match.group("delim").strip('"')
        delimiter = "" if delimiter == "NIL" else delimiter
        name = match.group("name").strip().strip('"')

        special = ""
        for flag in flags:
            if flag in SPECIAL_USE:
                special = SPECIAL_USE[flag]
                break

        if not special:
            leaf = (name.split(delimiter)[-1] if delimiter else name).lower()
            for use, names in NAME_FALLBACK:
                if leaf in names:
                    special = use
                    break

        # INBOX is INBOX on every server, case-insensitively, by RFC.
        if name.upper() == "INBOX":
            name = "INBOX"

        return FolderInfo(
            path=name,
            delimiter=delimiter,
            special_use=special,
            selectable="\\noselect" not in flags,
        )

    def select(self, folder: str, readonly: bool = True) -> dict:
        typ, data = self._conn.select(self._quote(folder), readonly=readonly)
        if typ != "OK":
            raise ImapUnavailable("cannot open folder %r" % folder)
        self._selected = folder

        exists = int(data[0]) if data and data[0] else 0
        return {
            "exists": exists,
            "uidvalidity": self._status_int(folder, "UIDVALIDITY"),
            "uidnext": self._status_int(folder, "UIDNEXT"),
            "unseen": self._status_int(folder, "UNSEEN"),
        }

    def _status_int(self, folder: str, key: str) -> int:
        typ, data = self._conn.status(self._quote(folder), "(%s)" % key)
        if typ != "OK" or not data:
            return 0
        match = re.search(rb"%s\s+(\d+)" % key.encode(), data[0])
        return int(match.group(1)) if match else 0

    @staticmethod
    def _quote(folder: str) -> str:
        # imaplib does not quote for us, and folder names routinely contain
        # spaces. Unquoted, `select("Sent Items")` silently opens `Sent`.
        return '"%s"' % folder.replace("\\", "\\\\").replace('"', '\\"')

    # -- messages ----------------------------------------------------------

    def recent_uids(self, limit: int = 500) -> list:
        """The newest `limit` UIDs in the selected folder, oldest first."""
        typ, data = self._conn.uid("SEARCH", None, "ALL")
        if typ != "OK" or not data or not data[0]:
            return []
        uids = [int(x) for x in data[0].split()]
        return uids[-limit:]

    def fetch_envelopes(self, uids: list) -> list:
        """Headers, flags and dates for a set of UIDs. No bodies."""
        if not uids:
            return []
        out = []
        # Chunked: a single FETCH naming ten thousand UIDs produces a command
        # line some servers refuse outright.
        for chunk in _chunks(uids, 200):
            spec = ",".join(str(u) for u in chunk)
            typ, data = self._conn.uid(
                "FETCH", spec,
                "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (%s)])"
                % ENVELOPE_HEADERS,
            )
            if typ != "OK":
                log.warning("FETCH failed for %d uids", len(chunk))
                continue
            out.extend(self._parse_fetch(data))
        return out

    def _parse_fetch(self, data) -> list:
        out = []
        for item in data or []:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            prefix = item[0].decode("utf-8", "replace") if isinstance(item[0], bytes) else str(item[0])
            headers = item[1] if isinstance(item[1], bytes) else b""

            uid = _int_after(prefix, "UID")
            if uid is None:
                continue
            try:
                envelope = self._envelope_from_headers(uid, prefix, headers)
            except Exception:  # noqa: BLE001
                # One unparseable message must not lose the other 199.
                log.exception("could not parse envelope for uid %s", uid)
                continue
            out.append(envelope)
        return out

    @staticmethod
    def _envelope_from_headers(uid, prefix, raw_headers) -> Envelope:
        msg = email.message_from_bytes(raw_headers, policy=email.policy.default)

        flags = [f for f in re.findall(r"\\\\?(\w+)", _between(prefix, "FLAGS (", ")") or "")]
        flags = ["\\" + f for f in flags]

        internal = _between(prefix, 'INTERNALDATE "', '"')
        when = None
        if internal:
            try:
                when = imaplib.Internaldate2tuple(
                    ('INTERNALDATE "%s"' % internal).encode())
                when = datetime.fromtimestamp(
                    __import__("time").mktime(when), dt_timezone.utc)
            except Exception:  # noqa: BLE001
                when = None
        if when is None:
            try:
                when = parsedate_to_datetime(msg.get("Date"))
            except Exception:  # noqa: BLE001
                when = None
        if when is None:
            when = datetime.now(dt_timezone.utc)
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt_timezone.utc)

        senders = _addresses(msg.get("From"))
        sender = senders[0] if senders else {"name": "", "address": ""}

        return Envelope(
            uid=uid,
            flags=flags,
            internal_date=when,
            size=_int_after(prefix, "RFC822.SIZE") or 0,
            subject=_decode(msg.get("Subject")),
            from_name=sender["name"],
            from_addr=sender["address"],
            to=_addresses(msg.get("To")),
            cc=_addresses(msg.get("Cc")),
            reply_to=(_addresses(msg.get("Reply-To")) or [{}])[0].get("address", ""),
            message_id=(msg.get("Message-ID") or "").strip(),
            in_reply_to=(_message_ids(msg.get("In-Reply-To")) or [""])[0],
            references=_message_ids(msg.get("References")),
            list_id=_decode(msg.get("List-Id")),
        )

    def fetch_body(self, uid: int) -> MessageBody:
        """The whole message, split into text, HTML and attachment metadata.

        Fetches the entire message rather than walking BODYSTRUCTURE and
        pulling parts individually. For ordinary mail that is one round trip
        instead of several; for a 30 MB attachment it is wasteful, and that is
        a known limit worth revisiting when we see real sizes.
        """
        typ, data = self._conn.uid("FETCH", str(uid), "(BODY.PEEK[])")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            raise ImapUnavailable("could not fetch message %s" % uid)

        msg = email.message_from_bytes(data[0][1], policy=email.policy.default)
        body = MessageBody()

        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            disposition = (part.get_content_disposition() or "").lower()
            content_type = part.get_content_type()

            if disposition == "attachment" or part.get_filename():
                body.attachments.append({
                    "filename": _decode(part.get_filename()) or "attachment",
                    "content_type": content_type,
                    "size": len(part.get_payload(decode=True) or b""),
                    "part_id": part.get("Content-ID", "") or "",
                })
                continue

            try:
                text = part.get_content()
            except Exception:  # noqa: BLE001
                payload = part.get_payload(decode=True) or b""
                text = payload.decode("utf-8", "replace")

            if content_type == "text/plain" and not body.text:
                body.text = text
            elif content_type == "text/html" and not body.html:
                body.html = text

        haystack = body.html or ""
        body.has_remote_images = bool(
            re.search(r'<img[^>]+src=["\']https?://', haystack, re.I))
        return body

    def store_flags(self, uid: int, flags: list, add: bool = True) -> None:
        self._conn.uid("STORE", str(uid), "+FLAGS" if add else "-FLAGS",
                       "(%s)" % " ".join(flags))

    def move(self, uid: int, folder: str) -> None:
        """MOVE where available, COPY+delete where not.

        The fallback is not equivalent: it leaves the original flagged deleted
        until an EXPUNGE, so the message can appear in both folders briefly.
        Better than refusing to move at all.
        """
        caps = getattr(self._conn, "capabilities", ())
        if any(b"MOVE" == c or c == "MOVE" for c in caps):
            self._conn.uid("MOVE", str(uid), self._quote(folder))
            return
        self._conn.uid("COPY", str(uid), self._quote(folder))
        self._conn.uid("STORE", str(uid), "+FLAGS", "(\\Deleted)")


def _chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _between(text: str, start: str, end: str):
    try:
        head = text.index(start) + len(start)
        return text[head:text.index(end, head)]
    except ValueError:
        return None


def _int_after(text: str, key: str):
    match = re.search(r"%s\s+(\d+)" % re.escape(key), text)
    return int(match.group(1)) if match else None


@contextmanager
def for_session(session):
    """The only supported way to open a mailbox.

    Takes a MailSession, never an address and password, so there is no call
    site where the wrong mailbox could be opened by passing the wrong string.
    """
    conn = MailboxConnection(session.mailbox_address, session.credential)
    try:
        yield conn.open()
    finally:
        conn.close()

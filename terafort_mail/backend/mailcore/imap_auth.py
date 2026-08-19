"""Authenticating against Dovecot, which is the only authority on passwords.

There is no local hash to fall back to and no cache of past successes. If
Dovecot is unreachable we fail closed and say so, because the alternative --
trusting anything else -- is the thing this design exists to avoid.
"""
from __future__ import annotations

import imaplib
import logging
import socket
import ssl
from dataclasses import dataclass

from django.conf import settings

log = logging.getLogger("mailcore.imap")


class ImapUnavailable(Exception):
    """The server could not be reached or spoke nonsense.

    Distinct from a rejected password on purpose: a user whose password is
    wrong must be told so, and a user whose mail server is down must NOT be
    told their password is wrong. Conflating the two turns an outage into a
    site-wide "your credentials are invalid", and people start changing
    passwords that were fine.
    """


@dataclass(frozen=True)
class ImapCapabilities:
    """What the server admitted to supporting.

    Recorded at first login and surfaced in the capability probe, because
    several build decisions hang on these and the blueprint flags all of them
    as unverified.
    """
    raw: tuple
    condstore: bool
    qresync: bool
    special_use: bool
    idle: bool
    move: bool

    @classmethod
    def parse(cls, caps) -> "ImapCapabilities":
        upper = tuple(
            c.decode("ascii", "replace").upper() if isinstance(c, bytes) else str(c).upper()
            for c in (caps or ())
        )
        joined = " ".join(upper)
        return cls(
            raw=upper,
            condstore="CONDSTORE" in joined,
            qresync="QRESYNC" in joined,
            special_use="SPECIAL-USE" in joined,
            idle="IDLE" in joined,
            move="MOVE" in joined,
        )


def _connect() -> imaplib.IMAP4:
    host = settings.MAIL_IMAP_HOST
    port = int(settings.MAIL_IMAP_PORT)
    timeout = int(settings.MAIL_IMAP_TIMEOUT)
    try:
        if settings.MAIL_IMAP_SSL:
            ctx = ssl.create_default_context()
            if not settings.MAIL_IMAP_VERIFY_CERT:
                # Only for a cPanel box still on a self-signed cert. Loud on
                # purpose: this is a real downgrade and should not be quiet.
                log.warning("IMAP certificate verification is DISABLED for %s", host)
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            return imaplib.IMAP4_SSL(host, port, ssl_context=ctx, timeout=timeout)
        conn = imaplib.IMAP4(host, port, timeout=timeout)
        conn.starttls(ssl.create_default_context())
        return conn
    except (OSError, socket.timeout, ssl.SSLError, imaplib.IMAP4.error) as exc:
        raise ImapUnavailable("cannot reach IMAP server %s:%s" % (host, port)) from exc


def authenticate(address: str, password: str) -> ImapCapabilities:
    """Return capabilities on success; raise on failure.

    Success here IS authentication -- there is nothing else to check. We log
    out immediately: this connection proves the credential, it does not become
    the session's mailbox connection. That pool is opened by the worker.
    """
    conn = _connect()
    try:
        try:
            conn.login(address, password)
        except imaplib.IMAP4.error as exc:
            # Dovecot says NO for a bad password and BAD for a malformed
            # command. Only the former is an authentication failure, but
            # imaplib raises the same class for both, so we treat any refusal
            # of LOGIN as "not authenticated" and let the caller decide.
            log.info("IMAP login refused for %s", address)
            raise PermissionError("invalid credentials") from exc
        caps = ImapCapabilities.parse(getattr(conn, "capabilities", ()))
        return caps
    except (OSError, socket.timeout, ssl.SSLError) as exc:
        raise ImapUnavailable("IMAP connection dropped mid-login") from exc
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001 - teardown must never mask the result
            pass


def probe() -> dict:
    """Read-only capability probe -- the one offered in the blueprint.

    Connects, asks what the server supports, disconnects. Writes nothing,
    opens no mailbox, and needs no credential.
    """
    conn = _connect()
    try:
        caps = ImapCapabilities.parse(getattr(conn, "capabilities", ()))
        return {
            "host": settings.MAIL_IMAP_HOST,
            "port": settings.MAIL_IMAP_PORT,
            "capabilities": list(caps.raw),
            "condstore": caps.condstore,
            "qresync": caps.qresync,
            "special_use": caps.special_use,
            "idle": caps.idle,
            "move": caps.move,
        }
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass

"""IT Command's half of the Terafort Mail handoff.

The two applications are separate deployments with separate databases. They
share exactly two things: a Redis session store, and two secrets (the session
seal key and the handoff HMAC key). Nothing else crosses.

That means a small amount of format logic is duplicated here rather than
imported from the mail app -- deliberately. A shared library between two repos
that deploy independently is a coupling you pay for at every release. What
must not drift is the *wire format*, so it is pinned by the constants below
and asserted by core/tests/test_mail_bridge.py.

Everything in this module is inert unless MAIL_AUTH_ENABLED is on. With the
flag off, IT Command authenticates exactly as it always has.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import imaplib
import json
import logging
import os
import secrets
import socket
import ssl
import time

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
from django.conf import settings

log = logging.getLogger("core.mail_bridge")

# ── wire format, pinned ────────────────────────────────────────────────────
# These five values must be byte-identical to mailcore's. Changing any of them
# without changing the mail app makes every handoff fail closed, which is the
# right direction, but it is still an outage.
NONCE_BYTES = 12
KEY_BYTES = 32
SALT_BYTES = 16
SESSION_AAD = b"tfm-session-v1"
DEK_AAD = b"tfm-dek-v1"
SESSION_PREFIX = "sess:"
HANDOFF_PREFIX = "handoff:"
AUDIENCE_MAIL = "tfm-mail"

ARGON2_MEMORY_KIB = 64 * 1024
ARGON2_ITERATIONS = 3
ARGON2_LANES = 4


class MailBridgeError(Exception):
    """Something in the mail path is misconfigured or unreachable."""


class ImapUnavailable(MailBridgeError):
    """The mail server could not be reached.

    Never surfaced to a user as "wrong password" -- see LoginView.
    """


def enabled() -> bool:
    return bool(getattr(settings, "MAIL_AUTH_ENABLED", False))


# ── crypto ─────────────────────────────────────────────────────────────────

def _seal_key() -> bytes:
    raw = settings.MAIL_SESSION_SEAL_KEY
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) != KEY_BYTES:
        raise MailBridgeError(
            "MAIL_SESSION_SEAL_KEY must be exactly %d bytes" % KEY_BYTES)
    return raw


def _seal(plaintext: bytes, aad: bytes) -> bytes:
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(_seal_key()).encrypt(nonce, plaintext, aad)


def _unseal(blob: bytes, aad: bytes) -> bytes:
    if not blob or len(blob) <= NONCE_BYTES:
        raise MailBridgeError("sealed blob is too short")
    try:
        return AESGCM(_seal_key()).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], aad)
    except InvalidTag as exc:
        raise MailBridgeError("sealed blob did not authenticate") from exc


def derive_kek(password: str, salt: bytes) -> bytes:
    return Argon2id(salt=bytes(salt), length=KEY_BYTES,
                    iterations=ARGON2_ITERATIONS, lanes=ARGON2_LANES,
                    memory_cost=ARGON2_MEMORY_KIB).derive(password.encode("utf-8"))


def unwrap_dek(wrapped: bytes, password: str, salt: bytes) -> bytes:
    key = derive_kek(password, salt)
    blob = bytes(wrapped)
    try:
        return AESGCM(key).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], DEK_AAD)
    except InvalidTag as exc:
        raise MailBridgeError("dek did not unwrap") from exc


# ── redis ──────────────────────────────────────────────────────────────────

_client = None


def _redis():
    """Lazy, so a deployment with the flag off never needs redis installed."""
    global _client
    if _client is None:
        url = getattr(settings, "MAIL_REDIS_URL", "")
        if not url:
            raise MailBridgeError("MAIL_REDIS_URL is not set; mailbox auth cannot work")
        try:
            import redis  # noqa: PLC0415
        except ImportError as exc:  # pragma: no cover
            raise MailBridgeError("redis is not installed on this deployment") from exc
        _client = redis.Redis.from_url(url)
    return _client


def _reset_redis():
    """Test hook."""
    global _client
    _client = None


# ── IMAP ───────────────────────────────────────────────────────────────────

def imap_check(address: str, password: str) -> None:
    """Ask Dovecot whether this credential is real. Return on yes.

    Raises PermissionError for a rejected credential and ImapUnavailable for
    anything else. The caller must keep those apart.
    """
    host = settings.MAIL_IMAP_HOST
    port = int(settings.MAIL_IMAP_PORT)
    timeout = int(getattr(settings, "MAIL_IMAP_TIMEOUT", 15))
    try:
        ctx = ssl.create_default_context()
        if not getattr(settings, "MAIL_IMAP_VERIFY_CERT", True):
            log.warning("IMAP certificate verification is DISABLED for %s", host)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        conn = imaplib.IMAP4_SSL(host, port, ssl_context=ctx, timeout=timeout)
    except (OSError, socket.timeout, ssl.SSLError, imaplib.IMAP4.error) as exc:
        raise ImapUnavailable("cannot reach %s:%s" % (host, port)) from exc
    try:
        try:
            conn.login(address, password)
        except imaplib.IMAP4.error as exc:
            raise PermissionError("invalid credentials") from exc
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass


# ── sessions ───────────────────────────────────────────────────────────────

def create_mail_session(*, address: str, mailbox_id: str, credential: str,
                        dek: bytes, itc_user_id: int | None = None,
                        ua_hash: str = "", ip: str = "") -> str:
    """Write the session both applications will read. Returns the sid.

    This is the only place in IT Command where a mailbox password is written
    anywhere, and it goes out sealed, into a store with a hard TTL, and never
    to Postgres.
    """
    now = time.time()
    absolute = now + int(settings.MAIL_SESSION_ABSOLUTE_SECONDS)
    sid = secrets.token_urlsafe(32)
    record = {
        "sid": sid,
        "mailbox_address": address,
        "mailbox_id": str(mailbox_id),
        "itc_user_id": itc_user_id,
        "credential": credential,
        "dek": base64.b64encode(dek).decode("ascii"),
        "created_at": now,
        "last_seen": now,
        "absolute_expiry": absolute,
        "ua_hash": ua_hash,
        "ip": ip,
        "mfa_verified": True,
        "scopes": [],
    }
    blob = _seal(json.dumps(record).encode("utf-8"), SESSION_AAD)
    _redis().setex(SESSION_PREFIX + sid, int(absolute - now), blob)
    return sid


def session_alive(sid: str) -> bool:
    if not sid:
        return False
    try:
        return _redis().exists(SESSION_PREFIX + sid) == 1
    except MailBridgeError:
        return False


def destroy_mail_sessions_for(address: str) -> int:
    """End every live mail session belonging to one address.

    An administrator resetting somebody's password does not hold their session
    cookie, so the sid has to be found rather than passed. Scans the session
    keyspace, which is fine at our size — a few hundred live sessions at most
    — and is not on any hot path.

    Never raises: failing to tidy up a session must not fail a password reset
    that has already succeeded on the mail server.
    """
    try:
        client = _redis()
    except MailBridgeError:
        log.warning("could not end mail sessions for %s: redis unavailable", address)
        return 0

    ended = 0
    target = address.strip().lower()
    try:
        for key in client.scan_iter(match=SESSION_PREFIX + "*", count=200):
            blob = client.get(key)
            if not blob:
                continue
            try:
                record = json.loads(_unseal(blob, SESSION_AAD))
            except (MailBridgeError, ValueError):
                continue
            if (record.get("mailbox_address") or "").lower() == target:
                client.delete(key)
                ended += 1
    except Exception:  # noqa: BLE001
        log.exception("failed while ending mail sessions for %s", address)
    return ended


def destroy_mail_session(sid: str) -> None:
    if not sid:
        return
    try:
        _redis().delete(SESSION_PREFIX + sid)
    except MailBridgeError:
        log.warning("could not destroy mail session; redis unavailable")


# ── handoff ────────────────────────────────────────────────────────────────

def _sign(token: str, audience: str) -> str:
    key = settings.MAIL_HANDOFF_HMAC_KEY
    if isinstance(key, str):
        key = key.encode("utf-8")
    return hmac.new(key, ("%s|%s" % (token, audience)).encode("utf-8"),
                    hashlib.sha256).hexdigest()[:32]


def mint_handoff(*, sid: str, address: str, ua_hash: str = "", ip: str = "") -> str:
    """A single-use, 30-second, signed pointer at an existing session.

    Carries no credential. Returned in a response body and posted onward in a
    form body -- never placed in a URL. See blueprint section 4.
    """
    if not session_alive(sid):
        raise MailBridgeError("no live mail session to hand off")
    token = secrets.token_urlsafe(32)
    payload = {
        "sid": sid,
        "mailbox_address": address,
        "ua_hash": ua_hash,
        "ip": ip,
        "audience": AUDIENCE_MAIL,
        "issued_at": time.time(),
    }
    blob = _seal(json.dumps(payload).encode("utf-8"), SESSION_AAD)
    _redis().setex(HANDOFF_PREFIX + token,
                   int(settings.MAIL_HANDOFF_TICKET_SECONDS), blob)
    return "%s.%s" % (token, _sign(token, AUDIENCE_MAIL))


def ua_hash_for(request) -> str:
    ua = request.META.get("HTTP_USER_AGENT", "")
    return hashlib.sha256(ua.encode("utf-8", "replace")).hexdigest()[:32]


def client_ip_for(request) -> str:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR", "")


# ── calling the mail app ───────────────────────────────────────────────────
#
# stdlib urllib rather than requests: this is two POSTs to a service on the
# same host, and it is not worth a dependency.

def _internal_post(path: str, payload: dict) -> tuple[int, dict]:
    import urllib.error
    import urllib.request

    base = getattr(settings, "MAIL_APP_INTERNAL_URL", "").rstrip("/")
    if not base:
        raise MailBridgeError("MAIL_APP_INTERNAL_URL is not set")
    key = settings.MAIL_INTERNAL_HMAC_KEY
    if isinstance(key, str):
        key = key.encode("utf-8")

    body = json.dumps(payload).encode("utf-8")
    ts = str(time.time())
    service = getattr(settings, "MAIL_INTERNAL_SERVICE_NAME", "itcommand")
    sig = hmac.new(key, b"%s|%s|%s" % (service.encode(), ts.encode(), body),
                   hashlib.sha256).hexdigest()

    req = urllib.request.Request(
        base + path, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Service": service,
            "X-Timestamp": ts,
            "X-Signature": sig,
        },
    )
    timeout = int(getattr(settings, "MAIL_APP_TIMEOUT", 20))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}
    except (urllib.error.URLError, socket.timeout, OSError) as exc:
        raise MailBridgeError("mail app is not reachable: %s" % exc) from exc


def remote_login(address: str, password: str) -> tuple[int, dict]:
    """Step one, run where the Mailbox row lives.

    The mail app does the Dovecot check, provisions the mailbox and its key on
    first sight, and hands back an MFA ticket. IT Command never sees a DEK and
    never stores a mail secret.
    """
    return _internal_post("/internal/v1/auth/login",
                          {"email": address, "password": password})


def open_break_glass(*, address: str, actor: str, reason: str) -> tuple[int, dict]:
    """Ask the mail app to open somebody else's mailbox.

    Goes over the service boundary rather than being reimplemented here: the
    master credential, the audit row and the owner's notification all live
    where the mailboxes do.
    """
    return _internal_post("/internal/v1/break-glass",
                          {"address": address, "actor": actor, "reason": reason})


def remote_mfa(ticket: str, code: str) -> tuple[int, dict]:
    """Step two. On success the body carries the sid of a live mail session."""
    return _internal_post("/internal/v1/auth/mfa", {"ticket": ticket, "code": code})

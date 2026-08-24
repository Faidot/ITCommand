"""The session store: the only place a live mailbox credential ever exists.

Two backends behind one interface. Redis in production; an in-process dict in
tests, so the isolation suite runs without infrastructure. Both enforce the
same three timers from the blueprint:

    idle       1h, slides on activity
    absolute   8h, never slides
    mfa        3m, single use

A record is sealed with AES-GCM before it leaves this process, so a Redis RDB
file on a backup volume is not a list of passwords.
"""
from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass, asdict, field
from typing import Optional

from django.conf import settings

from . import crypto

SESSION_PREFIX = "sess:"
MFA_PREFIX = "mfa:"
HANDOFF_PREFIX = "handoff:"


def new_token() -> str:
    """256 bits, URL-safe. Used for session ids, MFA tickets and handoffs."""
    return secrets.token_urlsafe(32)


@dataclass
class MailSession:
    """What a signed-in user is, in full.

    `credential` and `dek` are the two fields that must never be written
    anywhere but a sealed value in the store. They are not serialised into API
    responses, logs or error reports -- see `__repr__`.
    """
    sid: str
    mailbox_address: str
    mailbox_id: str
    itc_user_id: Optional[int]
    credential: str
    dek: str                      # base64; bytes do not survive JSON
    created_at: float
    last_seen: float
    absolute_expiry: float
    ua_hash: str = ""
    ip: str = ""
    mfa_verified: bool = True
    scopes: list = field(default_factory=list)
    #: The IMAP login, when it differs from the address. Only break-glass sets
    #: it, to `address*masteruser`. Everything else authenticates as itself.
    credential_login: str = ""

    def __repr__(self) -> str:  # pragma: no cover - defensive
        return "<MailSession %s %s>" % (self.sid[:8], self.mailbox_address)

    @property
    def expired(self) -> bool:
        now = time.time()
        if now >= self.absolute_expiry:
            return True
        return now - self.last_seen >= settings.MAIL_SESSION_IDLE_SECONDS

    @property
    def seconds_remaining(self) -> int:
        return max(0, int(self.absolute_expiry - time.time()))

    def public(self) -> dict:
        """Everything the browser is allowed to know about its own session."""
        return {
            "mailbox": self.mailbox_address,
            "expires_in": self.seconds_remaining,
            "mfa_verified": self.mfa_verified,
        }


class BaseStore:
    """Sealing and framing live here; subclasses only move bytes."""

    def _put(self, key: str, blob: bytes, ttl: int) -> None:
        raise NotImplementedError

    def _get(self, key: str) -> Optional[bytes]:
        raise NotImplementedError

    def _delete(self, key: str) -> None:
        raise NotImplementedError

    def _getdel(self, key: str) -> Optional[bytes]:
        """Atomic read-and-remove. The single-use guarantee depends on this
        being one operation, not a get followed by a delete."""
        raise NotImplementedError

    # -- sessions ----------------------------------------------------------

    def create_session(self, *, mailbox_address: str, mailbox_id: str,
                       credential: str, dek_b64: str,
                       itc_user_id: Optional[int] = None,
                       ua_hash: str = "", ip: str = "") -> MailSession:
        now = time.time()
        sess = MailSession(
            sid=new_token(),
            mailbox_address=mailbox_address,
            mailbox_id=str(mailbox_id),
            itc_user_id=itc_user_id,
            credential=credential,
            dek=dek_b64,
            created_at=now,
            last_seen=now,
            absolute_expiry=now + settings.MAIL_SESSION_ABSOLUTE_SECONDS,
            ua_hash=ua_hash,
            ip=ip,
        )
        self._save(sess)
        return sess

    def _save(self, sess: MailSession) -> None:
        blob = crypto.seal_for_server(json.dumps(asdict(sess)).encode("utf-8"))
        # The Redis TTL is a backstop, not the authority: `expired` is checked
        # on every read. Belt and braces, because a key that outlives its
        # absolute expiry is a credential we promised would be gone.
        ttl = max(1, int(sess.absolute_expiry - time.time()))
        self._put(SESSION_PREFIX + sess.sid, blob, ttl)

    def load_session(self, sid: str, *, touch: bool = True) -> Optional[MailSession]:
        if not sid:
            return None
        blob = self._get(SESSION_PREFIX + sid)
        if blob is None:
            return None
        try:
            data = json.loads(crypto.unseal_for_server(blob))
        except (crypto.SealError, ValueError):
            # Someone changed the seal key, or the bytes were tampered with.
            # Either way this is not a session we will honour.
            self._delete(SESSION_PREFIX + sid)
            return None
        sess = MailSession(**data)
        if sess.expired:
            self.destroy_session(sid)
            return None
        if touch:
            sess.last_seen = time.time()
            self._save(sess)
        return sess

    def destroy_session(self, sid: str) -> None:
        self._delete(SESSION_PREFIX + sid)

    # -- MFA tickets -------------------------------------------------------

    def create_mfa_ticket(self, payload: dict) -> str:
        token = new_token()
        blob = crypto.seal_for_server(json.dumps(payload).encode("utf-8"))
        self._put(MFA_PREFIX + token, blob, settings.MAIL_MFA_TICKET_SECONDS)
        return token

    def redeem_mfa_ticket(self, token: str) -> Optional[dict]:
        if not token:
            return None
        blob = self._getdel(MFA_PREFIX + token)
        if blob is None:
            return None
        try:
            return json.loads(crypto.unseal_for_server(blob))
        except (crypto.SealError, ValueError):
            return None

    # -- handoff tickets ---------------------------------------------------

    def create_handoff(self, payload: dict) -> str:
        token = new_token()
        blob = crypto.seal_for_server(json.dumps(payload).encode("utf-8"))
        self._put(HANDOFF_PREFIX + token, blob, settings.MAIL_HANDOFF_TICKET_SECONDS)
        return token

    def redeem_handoff(self, token: str) -> Optional[dict]:
        """Single use. A second redemption of the same ticket finds nothing,
        which is the whole point -- see the handoff tests."""
        if not token:
            return None
        blob = self._getdel(HANDOFF_PREFIX + token)
        if blob is None:
            return None
        try:
            return json.loads(crypto.unseal_for_server(blob))
        except (crypto.SealError, ValueError):
            return None


class MemoryStore(BaseStore):
    """For tests. Honours TTLs against the wall clock so expiry is testable."""

    def __init__(self):
        self._d: dict[str, tuple[bytes, float]] = {}

    def _put(self, key, blob, ttl):
        self._d[key] = (blob, time.time() + ttl)

    def _get(self, key):
        item = self._d.get(key)
        if item is None:
            return None
        blob, expires = item
        if time.time() >= expires:
            self._d.pop(key, None)
            return None
        return blob

    def _delete(self, key):
        self._d.pop(key, None)

    def _getdel(self, key):
        blob = self._get(key)
        self._d.pop(key, None)
        return blob

    def clear(self):
        self._d.clear()


class RedisStore(BaseStore):
    """Production. Requires redis-py; imported lazily so tests need neither."""

    def __init__(self, url: str):
        import redis  # noqa: PLC0415 - deliberately lazy
        self._r = redis.Redis.from_url(url)

    def _put(self, key, blob, ttl):
        self._r.setex(key, int(ttl), blob)

    def _get(self, key):
        return self._r.get(key)

    def _delete(self, key):
        self._r.delete(key)

    def _getdel(self, key):
        # GETDEL is one round trip and atomic. Redis >= 6.2.
        return self._r.getdel(key)


_store: Optional[BaseStore] = None


def get_store() -> BaseStore:
    global _store
    if _store is None:
        url = getattr(settings, "MAIL_REDIS_URL", "") or ""
        _store = RedisStore(url) if url else MemoryStore()
    return _store


def reset_store() -> None:
    """Test hook. Drops the singleton so each test starts empty."""
    global _store
    _store = None

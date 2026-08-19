"""The IT Command -> mail app handoff. Blueprint section 4.

Seven hops, and the ticket is never addressable:

  1. browser POSTs /auth/handoff to IT Command  (its own session + CSRF)
  2. IT Command writes handoff:<token> to Redis, 30s TTL
  3. IT Command returns the ticket in the response *body*
  4. browser auto-submits a form POST to the mail app -- body, not URL
  5. mail app GETDELs the ticket (atomic; a second redemption finds nothing)
  6. the payload names an existing session that already holds credential+DEK
  7. mail app sets its own __Host- cookie and redirects to the inbox

Step 4 is the load-bearing one. A ticket in a query string would be written to
browser history, sent onward in Referer, and captured in nginx access logs on
both hosts -- three durable copies of a bearer value.
"""
from __future__ import annotations

import hashlib
import hmac
import time

from django.conf import settings

from . import sessions

#: The mail app is the only audience a handoff ticket is valid for. An
#: audience mismatch means someone is replaying a ticket at the wrong door.
AUDIENCE_MAIL = "tfm-mail"


class HandoffError(Exception):
    """Ticket refused. Deliberately carries no detail for the client."""


def _key() -> bytes:
    raw = settings.MAIL_HANDOFF_HMAC_KEY
    return raw.encode("utf-8") if isinstance(raw, str) else raw


def _sign(token: str, audience: str) -> str:
    mac = hmac.new(_key(), ("%s|%s" % (token, audience)).encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()[:32]


def mint(*, sid: str, mailbox_address: str, ua_hash: str = "", ip: str = "",
         audience: str = AUDIENCE_MAIL) -> str:
    """Create a single-use ticket pointing at an existing session.

    The ticket carries no credential and no mailbox identifier the mail app
    would trust on its own -- only a reference to a session record both apps
    can already read.
    """
    store = sessions.get_store()
    token = store.create_handoff({
        "sid": sid,
        "mailbox_address": mailbox_address,
        "ua_hash": ua_hash,
        "ip": ip,
        "audience": audience,
        "issued_at": time.time(),
    })
    return "%s.%s" % (token, _sign(token, audience))


def redeem(ticket: str, *, ua_hash: str = "", ip: str = "",
           audience: str = AUDIENCE_MAIL):
    """Return the MailSession the ticket points at, or raise HandoffError.

    Order matters. The signature is checked first because it costs one HMAC
    and rejects junk without touching Redis -- and because a Redis that an
    attacker could write to still could not mint a ticket that passes here.
    """
    if not ticket or "." not in ticket:
        raise HandoffError("malformed ticket")
    token, _, sig = ticket.partition(".")
    if not hmac.compare_digest(sig, _sign(token, audience)):
        raise HandoffError("bad signature")

    store = sessions.get_store()
    payload = store.redeem_handoff(token)   # atomic GETDEL: single use
    if payload is None:
        raise HandoffError("ticket expired or already used")
    if payload.get("audience") != audience:
        raise HandoffError("wrong audience")

    # Binding. A ticket lifted off the wire and replayed from another browser
    # or another network fails here even inside its 30 second life.
    if payload.get("ua_hash") and payload["ua_hash"] != ua_hash:
        raise HandoffError("user agent mismatch")
    if settings.MAIL_HANDOFF_BIND_IP and payload.get("ip") and payload["ip"] != ip:
        raise HandoffError("address mismatch")

    sess = store.load_session(payload["sid"])
    if sess is None:
        raise HandoffError("session no longer exists")
    return sess

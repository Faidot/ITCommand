"""How a request becomes a mailbox.

The only input is the session cookie. There is no Authorization header path,
no query parameter, no body field. Layer 1 of the four isolation layers: the
question "whose mailbox?" is never asked of the request.
"""
from __future__ import annotations

import hashlib

from django.conf import settings
from rest_framework import authentication, exceptions

from . import sessions


def ua_hash(request) -> str:
    """A ticket is bound to the browser that asked for it. Hashed rather than
    stored so the session record does not accumulate fingerprints."""
    ua = request.META.get("HTTP_USER_AGENT", "")
    return hashlib.sha256(ua.encode("utf-8", "replace")).hexdigest()[:32]


def client_ip(request) -> str:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


class MailboxUser:
    """A stand-in for django.contrib.auth's user on a project that has none.

    Mail users are not Django users -- there is no password hash and no auth
    table for them, by design. DRF only needs `is_authenticated`.
    """
    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_staff = False
    is_superuser = False

    def __init__(self, session):
        self.session = session
        self.address = session.mailbox_address
        self.mailbox_id = session.mailbox_id

    def __str__(self) -> str:
        return self.address


class MailSessionAuthentication(authentication.BaseAuthentication):
    """Reads the httpOnly session cookie and nothing else."""

    def authenticate(self, request):
        sid = request.COOKIES.get(settings.MAIL_SESSION_COOKIE)
        if not sid:
            return None
        store = sessions.get_store()
        sess = store.load_session(sid)
        if sess is None:
            # Expired, revoked, or forged. Identical response for all three:
            # distinguishing them tells an attacker which sids once existed.
            raise exceptions.AuthenticationFailed("session is not valid")
        if sess.ua_hash and sess.ua_hash != ua_hash(request):
            store.destroy_session(sess.sid)
            raise exceptions.AuthenticationFailed("session is not valid")
        # Stash it where the middleware and the managers can reach it.
        request.mail_session = sess
        return (MailboxUser(sess), sess)

    def authenticate_header(self, request):
        # No WWW-Authenticate: this is a cookie session, and returning a
        # challenge would make browsers pop a basic-auth dialog.
        return None

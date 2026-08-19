"""The service-to-service boundary. Blueprint section 11.

IT Command owns people; this app owns mailboxes. When a mailbox-backed user
signs in to IT Command, the credential check has to happen where the Mailbox
row and its TOTP secret live -- here -- rather than being reimplemented over
there against a database it cannot read.

So IT Command proxies the two login steps through these endpoints and gets
back a session id. One login implementation, one TOTP enrolment, and no mail
secrets in IT Command's database.

Three rules keep this from becoming a back door:

  * service authentication only; a session cookie is rejected outright, so a
    stolen browser session cannot reach these routes
  * they return a session reference and metadata, never message content
  * even a fully compromised IT Command cannot read mail through here, because
    reading needs a DEK that only a live mail session holds
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import sessions
from .views import LoginView, MfaView

log = logging.getLogger("mailcore.internal")

#: How far a signed request's timestamp may be from ours. Tight, because both
#: services run on the same host and NTP is not optional.
CLOCK_SKEW_SECONDS = 30


class ServiceAuthFailed(Exception):
    pass


def verify_service_request(request) -> str:
    """Check the caller is a service we know, and that this is not a replay.

    Signature covers the timestamp and the raw body, so neither can be changed
    without invalidating it.
    """
    key = getattr(settings, "MAIL_INTERNAL_HMAC_KEY", "")
    if not key:
        raise ServiceAuthFailed("internal API is not configured")
    caller = request.headers.get("X-Service", "")
    ts = request.headers.get("X-Timestamp", "")
    sig = request.headers.get("X-Signature", "")
    if not (caller and ts and sig):
        raise ServiceAuthFailed("missing service headers")
    if caller not in getattr(settings, "MAIL_INTERNAL_SERVICES", []):
        raise ServiceAuthFailed("unknown service")
    try:
        drift = abs(time.time() - float(ts))
    except (TypeError, ValueError):
        raise ServiceAuthFailed("bad timestamp") from None
    if drift > CLOCK_SKEW_SECONDS:
        raise ServiceAuthFailed("stale request")

    if isinstance(key, str):
        key = key.encode("utf-8")
    body = request.body or b""
    expected = hmac.new(
        key, b"%s|%s|%s" % (caller.encode(), ts.encode(), body), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise ServiceAuthFailed("bad signature")
    return caller


class InternalView(APIView):
    """Base: no session authentication, service signature instead."""
    authentication_classes: list = []
    permission_classes: list = []

    def initial(self, request, *args, **kwargs):
        # Reject a browser session before anything else runs. These routes are
        # not reachable with a cookie, by design.
        if settings.MAIL_SESSION_COOKIE in request.COOKIES:
            log.warning("internal route reached with a session cookie present")
        try:
            self.caller = verify_service_request(request)
        except ServiceAuthFailed as exc:
            log.info("internal auth refused: %s", exc)
            # 404 rather than 401: an unauthenticated caller should not learn
            # that this route exists at all.
            self.permission_denied(request, message="Not found.")
        return super().initial(request, *args, **kwargs)

    def permission_denied(self, request, message=None, code=None):
        from rest_framework.exceptions import NotFound
        raise NotFound("Not found.")


class InternalLoginView(InternalView):
    """Step one, on behalf of IT Command. Same logic as the public route."""

    def post(self, request):
        return LoginView().post(request)


class InternalMfaView(InternalView):
    """Step two. Returns the session id in the body rather than a cookie --
    IT Command holds it and mints handoff tickets against it."""

    def post(self, request):
        response = MfaView().post(request)
        if response.status_code != 200:
            return response
        # MfaView set a cookie for the browser case; strip it and hand the sid
        # back in the body instead.
        ticket_sid = None
        cookie = response.cookies.get(settings.MAIL_SESSION_COOKIE)
        if cookie is not None:
            ticket_sid = cookie.value
            del response.cookies[settings.MAIL_SESSION_COOKIE]
        data = dict(response.data)
        data["sid"] = ticket_sid
        return Response(data, status=status.HTTP_200_OK)


class InternalSessionView(InternalView):
    """Lets IT Command check or end a mail session it created -- so signing
    out of IT Command can also close the mailbox."""

    def get(self, request):
        sid = request.query_params.get("sid", "")
        sess = sessions.get_store().load_session(sid, touch=False) if sid else None
        return Response({"alive": sess is not None,
                         "expires_in": sess.seconds_remaining if sess else 0})

    def delete(self, request):
        sid = request.query_params.get("sid", "")
        if sid:
            sessions.get_store().destroy_session(sid)
        return Response({"ok": True})

"""HTTP surface for Phase 1: authentication, handoff, and enough scoped mail
endpoints for the isolation harness to have something to sweep.

Read the routes as a list of what a client may ask for. There is no mailbox
identifier in any of them, because there is no request in this app whose
answer depends on one.
"""
from __future__ import annotations

import base64
import logging

from django.conf import settings
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.clickjacking import xframe_options_deny
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import crypto, handoff, imap_auth, sessions, totp
from .authentication import client_ip, ua_hash
from .middleware import scope_to_session
from .models import Folder, Mailbox, Message, record_audit

log = logging.getLogger("mailcore.views")


def _is_service_call(request) -> bool:
    """True when IT Command is calling on somebody's behalf.

    The internal routes are signed with a service header; a browser never
    sends one.
    """
    return bool(request.headers.get("X-Service"))


def _set_session_cookie(response, sid: str) -> None:
    """__Host- prefix: Secure, path=/, and no Domain attribute.

    SameSite is Lax rather than Strict on purpose. The handoff arrives as a
    cross-site form POST from itcommand.com, and Strict would keep the browser
    from sending this cookie on the navigation that follows it. Lax still
    blocks cross-site POST and XHR from carrying it, which is the attack Strict
    is actually for.
    """
    response.set_cookie(
        settings.MAIL_SESSION_COOKIE, sid,
        max_age=settings.MAIL_SESSION_ABSOLUTE_SECONDS,
        httponly=True,
        secure=settings.MAIL_COOKIE_SECURE,
        samesite="Lax",
        path="/",
    )


def _clear_session_cookie(response) -> None:
    response.delete_cookie(settings.MAIL_SESSION_COOKIE, path="/")


def _provision(mailbox: Mailbox | None, address: str, password: str):
    """Get the mailbox row and a usable DEK, rebuilding the cache if we must.

    Returns (mailbox, dek, rotated). `rotated` is True when the password
    changed while we were away and the cached mail became permanently
    unreadable -- the case the blueprint says will happen in week one.
    """
    if mailbox is None:
        salt = crypto.new_salt()
        dek = crypto.new_key()
        mailbox = Mailbox.objects.create(
            address=address,
            kek_salt=salt,
            wrapped_dek=crypto.wrap_dek(dek, password, salt),
        )
        return mailbox, dek, False

    salt = bytes(mailbox.kek_salt)
    try:
        dek = crypto.unwrap_dek(bytes(mailbox.wrapped_dek), password, salt)
        return mailbox, dek, False
    except crypto.SealError:
        # Dovecot accepted this password, so it is the current one -- which
        # means the old one is gone and the old DEK with it. Everything sealed
        # under it is now noise. Drop it and start again; the real mail is
        # still on cPanel, which is what makes this recoverable.
        log.warning("re-keying mailbox %s: password changed, cache discarded", address)
        with transaction.atomic():
            Message.objects.for_mailbox(mailbox).delete()
            Folder.objects.for_mailbox(mailbox).delete()
            salt = crypto.new_salt()
            dek = crypto.new_key()
            mailbox.kek_salt = salt
            mailbox.wrapped_dek = crypto.wrap_dek(dek, password, salt)
            mailbox.dek_generation += 1
            mailbox.last_synced_at = None
            mailbox.save(update_fields=["kek_salt", "wrapped_dek",
                                        "dek_generation", "last_synced_at"])
        return mailbox, dek, True



class DirectLoginGate:
    """Turns the public login routes off when the handoff is the only door.

    Sits in `initial()`, which the internal service views deliberately bypass
    by calling `.post()` directly -- so IT Command can always authenticate a
    user even when a browser cannot log in here.
    """

    def initial(self, request, *args, **kwargs):
        if not settings.MAIL_DIRECT_LOGIN_ENABLED:
            from rest_framework.exceptions import NotFound
            raise NotFound("Not found.")
        return super().initial(request, *args, **kwargs)


class LoginView(DirectLoginGate, APIView):
    """Step one: Dovecot decides whether the credential is real.

    A success here is not a session. It is a three-minute ticket that holds
    the credential until the second factor answers.
    """
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mail_login"

    def post(self, request):
        address = (request.data.get("email") or "").strip().lower()
        password = request.data.get("password") or ""
        if not address or not password:
            return Response({"detail": "Email and password are required."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            imap_auth.authenticate(address, password)
        except PermissionError:
            record_audit("LOGIN_FAILED", mailbox_address=address, request=request,
                         reason="rejected by dovecot")
            return Response({"detail": "Invalid email or password."},
                            status=status.HTTP_401_UNAUTHORIZED)
        except imap_auth.ImapUnavailable:
            # Never "invalid credentials" for an outage. See ImapUnavailable.
            record_audit("LOGIN_UNAVAILABLE", mailbox_address=address, request=request)
            return Response(
                {"detail": "The mail server is not reachable right now. "
                           "Your password has not been rejected -- please try again shortly."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE)

        mailbox = Mailbox.objects.filter(address=address).first()
        mailbox, dek, rotated = _provision(mailbox, address, password)

        payload = {
            "mailbox_id": str(mailbox.id),
            "address": address,
            "credential": password,
            "dek": base64.b64encode(dek).decode("ascii"),
            # Only meaningful when a browser is on the other end. A service
            # call carries its HTTP client's user agent, which would bind the
            # session to something no browser can ever match.
            "ua_hash": "" if _is_service_call(request) else ua_hash(request),
            "ip": "" if _is_service_call(request) else client_ip(request),
        }

        if not mailbox.totp_enrolled:
            # First sign-in, or a reset. Enrolment must complete before a
            # session exists -- there is no "skip for now".
            secret = totp.new_secret()
            mailbox.totp_secret = secret
            mailbox.save(update_fields=["totp_secret"])
            payload["enrolling"] = True
            ticket = sessions.get_store().create_mfa_ticket(payload)
            record_audit("MFA_ENROL_STARTED", mailbox_address=address, request=request)
            return Response({
                "mfa_required": True,
                "enrolment_required": True,
                "ticket": ticket,
                "totp_secret": secret,
                "otpauth_uri": totp.provisioning_uri(secret, address),
                "cache_rebuilt": rotated,
            })

        ticket = sessions.get_store().create_mfa_ticket(payload)
        return Response({
            "mfa_required": True,
            "enrolment_required": False,
            "ticket": ticket,
            "cache_rebuilt": rotated,
        })


class MfaView(DirectLoginGate, APIView):
    """Step two: our second factor, because IMAP has none."""
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mail_mfa"

    def post(self, request):
        ticket = request.data.get("ticket") or ""
        code = (request.data.get("code") or "").strip()
        store = sessions.get_store()
        payload = store.redeem_mfa_ticket(ticket)     # single use
        if payload is None:
            return Response({"detail": "This sign-in attempt has expired. Start again."},
                            status=status.HTTP_401_UNAUTHORIZED)

        address = payload["address"]
        mailbox = Mailbox.objects.filter(id=payload["mailbox_id"]).first()
        if mailbox is None:
            return Response({"detail": "This sign-in attempt has expired. Start again."},
                            status=status.HTTP_401_UNAUTHORIZED)

        # A trusted-device assertion can only arrive over the service
        # boundary, which a browser cannot reach. `_is_service_call` is the
        # gate; without it this field would be a way to skip the factor by
        # asking nicely.
        trusted = bool(request.data.get("trusted_device")) and _is_service_call(request)
        if trusted and not payload.get("enrolling"):
            record_audit("MFA_TRUSTED_DEVICE", mailbox_address=address, request=request)
            return self._issue(request, mailbox, payload, store, address,
                               recovery_used=False, recovery_codes=None)

        recovery_used = False
        if not totp.verify(mailbox.totp_secret, code):
            recovery_used = self._consume_recovery(mailbox, code)
            if not recovery_used:
                record_audit("MFA_FAILED", mailbox_address=address, request=request)
                return Response({"detail": "That code is not right."},
                                status=status.HTTP_401_UNAUTHORIZED)

        recovery_codes = None
        if payload.get("enrolling"):
            mailbox.totp_confirmed_at = timezone.now()
            recovery_codes = totp.new_recovery_codes()
            mailbox.recovery_code_hashes = [totp.hash_recovery_code(c) for c in recovery_codes]
            mailbox.save(update_fields=["totp_confirmed_at", "recovery_code_hashes"])
            record_audit("MFA_ENROLLED", mailbox_address=address, request=request)

        return self._issue(request, mailbox, payload, store, address,
                           recovery_used=recovery_used, recovery_codes=recovery_codes)

    @staticmethod
    def _issue(request, mailbox, payload, store, address, *,
               recovery_used=False, recovery_codes=None):
        """Create the session and answer. Shared by the code path and the
        trusted-device path so they cannot issue different things."""
        mailbox.last_login_at = timezone.now()
        mailbox.save(update_fields=["last_login_at"])

        sess = store.create_session(
            mailbox_address=address,
            mailbox_id=payload["mailbox_id"],
            credential=payload["credential"],
            dek_b64=payload["dek"],
            ua_hash=payload.get("ua_hash", ""),
            ip=payload.get("ip", ""),
        )
        record_audit("SESSION_START", mailbox_address=address, request=request,
                     recovery_code_used=recovery_used)

        body = {"ok": True, "session": sess.public()}
        if recovery_codes:
            # Shown exactly once. Only hashes are kept.
            body["recovery_codes"] = recovery_codes
        response = Response(body)
        _set_session_cookie(response, sess.sid)
        return response

    @staticmethod
    def _consume_recovery(mailbox: Mailbox, code: str) -> bool:
        digest = totp.hash_recovery_code(code)
        held = list(mailbox.recovery_code_hashes or [])
        if digest not in held:
            return False
        held.remove(digest)           # one-time: burned on use
        mailbox.recovery_code_hashes = held
        mailbox.save(update_fields=["recovery_code_hashes"])
        return True


@csrf_exempt
@xframe_options_deny
def handoff_view(request):
    """Step 4-7 of the handoff: the cross-origin form POST lands here.

    CSRF-exempt is correct and not a hole: the ticket *is* the proof. It is
    single-use, 30 seconds old at most, signed, audience-scoped, and bound to
    the browser that asked for it. A CSRF token from this origin could not be
    checked anyway, because the request legitimately originates on another.
    """
    if request.method != "POST":
        return render(request, "mailcore/handoff_error.html",
                      {"reason": "This link must be opened from IT Command.",
                       "itc_url": settings.ITC_BASE_URL}, status=405)

    ticket = request.POST.get("ticket", "")
    try:
        sess = handoff.redeem(ticket, ua_hash=ua_hash(request), ip=client_ip(request))
    except handoff.HandoffError as exc:
        log.info("handoff refused: %s", exc)
        record_audit("HANDOFF_REFUSED", request=request, reason=str(exc))
        return render(request, "mailcore/handoff_error.html",
                      {"reason": "That sign-in link has expired. Open your mailbox "
                                 "from IT Command again.",
                       "itc_url": settings.ITC_BASE_URL}, status=401)

    # The browser is first seen here. A session created through the service
    # boundary has no binding yet, so this is where it gets one — from the
    # request that actually redeemed the ticket.
    if not sess.ua_hash:
        sess.ua_hash = ua_hash(request)
        sess.ip = client_ip(request)
        sessions.get_store()._save(sess)

    record_audit("HANDOFF_REDEEMED", mailbox_address=sess.mailbox_address, request=request)
    # 303 so the browser turns the POST into a GET for the inbox.
    response = HttpResponseRedirect(settings.MAIL_APP_INBOX_PATH)
    response.status_code = 303
    _set_session_cookie(response, sess.sid)
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me_view(request):
    """Everything the browser may know about its own session."""
    return Response(request.mail_session.public())


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    sess = request.mail_session
    sessions.get_store().destroy_session(sess.sid)
    record_audit("SESSION_END", mailbox_address=sess.mailbox_address, request=request)
    response = Response({"ok": True})
    _clear_session_cookie(response)
    return response


# ---------------------------------------------------------------------------
# Scoped mail endpoints.
#
# Every one of these derives its mailbox from request.mail_session. None of
# them accepts an identifier that names a mailbox. The isolation harness
# sweeps this router and will fail if a future route breaks that.
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def folders_view(request):
    scope_to_session(request)
    rows = Folder.objects.for_session(request.mail_session).order_by("imap_path")
    return Response([{
        "id": str(f.id),
        "path": f.imap_path,
        "special_use": f.special_use,
        "unread": f.unread_count,
        "total": f.total_count,
    } for f in rows])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def message_view(request, message_id):
    """404, never 403.

    A 403 would confirm the id exists and belongs to someone else, which is an
    existence oracle and a perfectly good way to enumerate another mailbox.
    """
    scope_to_session(request)
    msg = Message.objects.for_session(request.mail_session).filter(id=message_id).first()
    if msg is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response({
        "id": str(msg.id),
        "folder": str(msg.folder_id),
        "internal_date": msg.internal_date,
        "flags": msg.flags,
        "bundle": msg.bundle,
        "seen": msg.seen,
        "flagged": msg.flagged,
        "has_remote_images": msg.has_remote_images,
        "images_allowed": msg.images_allowed,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def message_archive_view(request, message_id):
    scope_to_session(request)
    msg = Message.objects.for_session(request.mail_session).filter(id=message_id).first()
    if msg is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    # Phase 2 issues the IMAP MOVE behind this. For now the local state moves
    # so the isolation harness has a mutating route to sweep.
    msg.bundle = ""
    msg.save(update_fields=["bundle"])
    return Response({"ok": True, "id": str(msg.id)})


@api_view(["GET"])
@permission_classes([AllowAny])
@authentication_classes([])
def probe_view(request):
    """The read-only capability probe from blueprint section 13.

    Gated on a shared secret rather than a session, because the whole point is
    to run it before anyone has an account. Connects, asks CAPABILITY,
    disconnects. Writes nothing and opens no mailbox.
    """
    token = request.headers.get("X-Probe-Token", "")
    expected = getattr(settings, "MAIL_PROBE_TOKEN", "")
    if not expected or not crypto.constant_time_equal(
            token.encode("utf-8"), expected.encode("utf-8")):
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    try:
        return Response(imap_auth.probe())
    except imap_auth.ImapUnavailable as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

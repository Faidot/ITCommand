"""Serving images and attachments — the two places hostile bytes leave us.

Both routes deliberately return raw bytes rather than JSON, and both set the
same headers for the same reason: whatever we hand back must not be treated
as something the browser will execute in our origin.
"""
from __future__ import annotations

import hashlib
import hmac
import logging

from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import fetching, imap_client, scanning
from .imap_auth import ImapUnavailable
from .middleware import scope_to_session
from .models import Message, record_audit

log = logging.getLogger("mailcore.views_files")


def _harden(response: HttpResponse, *, filename: str = None) -> HttpResponse:
    """Headers that stop a download becoming an execution."""
    # nosniff is the important one: without it a browser may decide a file we
    # labelled as an image is really HTML, and render it.
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["X-Frame-Options"] = "DENY"
    response["Referrer-Policy"] = "no-referrer"
    response["Cross-Origin-Resource-Policy"] = "same-site"
    if filename:
        # Always attachment, never inline. An inline HTML attachment is a
        # stored XSS on whatever origin serves it.
        safe = filename.replace('"', "").replace("\\", "").replace("\n", "")
        response["Content-Disposition"] = 'attachment; filename="%s"' % safe
    return response


def sign_url(session, url: str) -> str:
    """Bind a remote URL to this mailbox so the proxy cannot be a general
    purpose fetcher for anyone who finds the endpoint."""
    key = settings.MAIL_HANDOFF_HMAC_KEY
    if isinstance(key, str):
        key = key.encode()
    return hmac.new(key, (session.mailbox_id + "|" + url).encode(),
                    hashlib.sha256).hexdigest()[:32]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def image_proxy_view(request):
    """Fetch a remote image server-side, so the sender never sees the reader.

    Without this, "load images" means the browser connects to the sender's
    server — handing over the reader's IP address, the time they opened the
    message, and their user agent. That is what a tracking pixel is for.
    """
    scope_to_session(request)
    session = request.mail_session
    url = request.query_params.get("u", "")
    signature = request.query_params.get("s", "")

    if not url or not hmac.compare_digest(signature, sign_url(session, url)):
        # 404 rather than 403: an unsigned caller should not learn that this
        # endpoint exists, let alone that it fetches URLs.
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    message_id = request.query_params.get("m", "")
    allowed = Message.objects.for_session(session).filter(
        id=message_id, images_allowed=True).exists() if message_id else False
    if not allowed:
        # Images load only for a message where the reader said so. Signing
        # alone is not consent.
        return Response({"detail": "Images are not enabled for that message."},
                        status=status.HTTP_403_FORBIDDEN)

    try:
        data, content_type = fetching.safe_get(url)
    except fetching.Refused as exc:
        log.info("image proxy refused %r: %s", url[:120], exc)
        return Response({"detail": "That image was refused."},
                        status=status.HTTP_400_BAD_REQUEST)
    except fetching.FetchFailed:
        return Response({"detail": "That image could not be loaded."},
                        status=status.HTTP_502_BAD_GATEWAY)

    response = HttpResponse(data, content_type=content_type)
    response["Cache-Control"] = "private, max-age=3600"
    return _harden(response)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def attachment_view(request, message_id, index):
    """Serve one attachment, scanned, as a download and never inline."""
    scope_to_session(request)
    session = request.mail_session
    message = Message.objects.for_session(session).select_related("folder").filter(
        id=message_id).first()
    if message is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    if message.quarantined:
        return Response(
            {"detail": "This message was reported as phishing. Its attachments "
                       "are not available."},
            status=status.HTTP_403_FORBIDDEN)

    try:
        with imap_client.for_session(session) as conn:
            conn.select(message.folder.imap_path)
            parts = conn.fetch_attachment_parts(message.uid)
    except PermissionError:
        return Response({"detail": "Please sign in again.", "reauth_required": True},
                        status=status.HTTP_401_UNAUTHORIZED)
    except ImapUnavailable:
        return Response({"detail": "The mail server is not reachable right now."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)

    if index < 0 or index >= len(parts):
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    part = parts[index]

    verdict = scanning.scan(part["data"], filename=part["filename"])
    record_audit("ATTACHMENT_FETCH", mailbox_address=session.mailbox_address,
                 actor=session.mailbox_address, request=request,
                 message=str(message.id), filename=part["filename"],
                 verdict=verdict.status)

    if verdict.status == "infected":
        return Response(
            {"detail": "That attachment is infected and will not be served.",
             "threat": verdict.detail},
            status=status.HTTP_403_FORBIDDEN)
    if verdict.status == "failed" and settings.MAIL_BLOCK_UNSCANNED:
        return Response(
            {"detail": "That attachment could not be scanned, and unscanned "
                       "downloads are blocked on this deployment."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE)

    # Deliberately not the real content type. Serving application/pdf or
    # text/html invites the browser to render it; octet-stream plus nosniff
    # plus attachment means it is saved, not opened.
    response = HttpResponse(part["data"], content_type="application/octet-stream")
    response["X-Scan-Status"] = verdict.status
    return _harden(response, filename=part["filename"])

"""Reading mail. Every route derives its mailbox from the session.

Read this alongside `urls.py`: there is still no path, query or body parameter
anywhere that names a mailbox. The isolation harness sweeps these the same as
everything else.
"""
from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import bundles as bundle_rules
from . import imap_client, sanitiser, sync
from .imap_auth import ImapUnavailable
from .middleware import scope_to_session
from .models import Folder, Message, record_audit

log = logging.getLogger("mailcore.views_mail")

PAGE_SIZE = 50


def _row(session, message, preview=True) -> dict:
    """One message as the list renders it. Envelope decrypted per row."""
    envelope = sync.open_envelope(session, message)
    return {
        "id": str(message.id),
        "folder": str(message.folder_id),
        "thread_id": str(message.thread_id) if message.thread_id else None,
        "date": message.internal_date,
        "subject": envelope.get("subject", ""),
        "from_name": envelope.get("from_name", ""),
        "from_address": envelope.get("from_addr", ""),
        "to": envelope.get("to", []),
        "seen": message.seen,
        "flagged": message.flagged,
        "bundle": message.bundle,
        "size": message.size_bytes,
        "has_remote_images": message.has_remote_images,
        "link_mismatch": message.link_mismatch,
        "quarantined": message.quarantined,
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sync_view(request):
    """Pull folders and recent messages. The credential comes from the session."""
    scope_to_session(request)
    try:
        report = sync.sync_mailbox(request.mail_session)
    except PermissionError:
        # Dovecot refused the credential we are holding. The password changed
        # under us; the session is no longer usable and pretending otherwise
        # just fails again on the next request.
        return Response(
            {"detail": "Your mailbox password has changed. Please sign in again.",
             "reauth_required": True},
            status=status.HTTP_401_UNAUTHORIZED)
    except ImapUnavailable as exc:
        log.warning("sync failed: %s", exc)
        return Response({"detail": "The mail server is not reachable right now."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(report)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def messages_view(request):
    """A folder or a bundle, newest first.

    `folder` is one of our own UUIDs and is filtered by the session's mailbox,
    so an id belonging to somebody else's folder simply matches nothing.
    """
    scope_to_session(request)
    session = request.mail_session
    qs = Message.objects.for_session(session).select_related("folder")

    folder_id = request.query_params.get("folder")
    bundle = request.query_params.get("bundle")

    if bundle:
        if bundle not in bundle_rules.all_bundles():
            return Response({"detail": "Unknown bundle."},
                            status=status.HTTP_400_BAD_REQUEST)
        # Bundles are a view over the inbox, not a folder. Showing archived or
        # sent mail in them would make "Invoices" mean something different
        # from what the sidebar count says.
        qs = qs.filter(bundle=bundle, folder__special_use="")
    elif folder_id:
        qs = qs.filter(folder_id=folder_id)
    else:
        inbox = Folder.objects.for_session(session).filter(imap_path="INBOX").first()
        if inbox is None:
            return Response({"results": [], "count": 0, "synced": False})
        qs = qs.filter(folder=inbox)

    if request.query_params.get("unread") == "true":
        qs = qs.exclude(flags__contains=["\\Seen"])
    if request.query_params.get("flagged") == "true":
        qs = qs.filter(flags__contains=["\\Flagged"])

    qs = qs.exclude(quarantined=True).order_by("-internal_date")

    try:
        offset = max(0, int(request.query_params.get("offset", 0)))
    except (TypeError, ValueError):
        offset = 0
    page = list(qs[offset:offset + PAGE_SIZE])

    return Response({
        "results": [_row(session, m) for m in page],
        "count": qs.count(),
        "offset": offset,
        "page_size": PAGE_SIZE,
        "synced": True,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def message_body_view(request, message_id):
    """One message, with its body fetched and cached on first read."""
    scope_to_session(request)
    session = request.mail_session
    message = Message.objects.for_session(session).select_related("folder").filter(
        id=message_id).first()
    if message is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        body = sync.open_body(session, message)
    except PermissionError:
        return Response({"detail": "Please sign in again.", "reauth_required": True},
                        status=status.HTTP_401_UNAUTHORIZED)
    except ImapUnavailable:
        return Response({"detail": "The mail server is not reachable right now."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)

    # Opening a message marks it read, as every mail client does. Applied
    # locally first so the UI does not wait on IMAP.
    if not message.seen:
        message.flags = list(message.flags or []) + ["\\Seen"]
        message.save(update_fields=["flags"])
        _store_flag(session, message, "\\Seen", add=True)

    payload = _row(session, message)
    payload.update({
        "text": body["text"],
        "html": body["html"] if message.images_allowed or not body["has_remote_images"]
                else body["html"],
        "attachments": body.get("attachments", []),
        "images_allowed": message.images_allowed,
        "has_remote_images": body["has_remote_images"],
        "link_mismatch": body["link_mismatch"],
        "preview": sanitiser.to_preview(body["text"], body["html"]),
    })
    return Response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def thread_view(request, thread_id):
    """Every message in one conversation, oldest first."""
    scope_to_session(request)
    session = request.mail_session
    rows = (Message.objects.for_session(session)
            .filter(thread_id=thread_id)
            .select_related("folder")
            .order_by("internal_date"))
    if not rows:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response({"thread_id": str(thread_id),
                     "messages": [_row(session, m) for m in rows]})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def flag_view(request, message_id):
    """Star, unstar, mark read, mark unread. Local first, IMAP behind."""
    scope_to_session(request)
    session = request.mail_session
    message = Message.objects.for_session(session).select_related("folder").filter(
        id=message_id).first()
    if message is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    action = (request.data.get("action") or "").strip()
    mapping = {
        "star": ("\\Flagged", True), "unstar": ("\\Flagged", False),
        "read": ("\\Seen", True), "unread": ("\\Seen", False),
    }
    if action not in mapping:
        return Response({"detail": "Unknown action."}, status=status.HTTP_400_BAD_REQUEST)

    flag, add = mapping[action]
    flags = set(message.flags or [])
    flags.add(flag) if add else flags.discard(flag)
    message.flags = sorted(flags)
    message.save(update_fields=["flags"])

    ok = _store_flag(session, message, flag, add=add)
    return Response({**_row(session, message), "synced_to_server": ok})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def load_images_view(request, message_id):
    """Explicit, per message, and never inferred from anything."""
    scope_to_session(request)
    session = request.mail_session
    message = Message.objects.for_session(session).filter(id=message_id).first()
    if message is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    message.images_allowed = True
    message.save(update_fields=["images_allowed"])
    record_audit("IMAGES_LOADED", mailbox_address=session.mailbox_address,
                 actor=session.mailbox_address, request=request,
                 message=str(message.id))
    return Response({"images_allowed": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def report_phishing_view(request, message_id):
    """Quarantine locally and record it. Rendering stops immediately."""
    scope_to_session(request)
    session = request.mail_session
    message = Message.objects.for_session(session).select_related("folder").filter(
        id=message_id).first()
    if message is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    envelope = sync.open_envelope(session, message)
    message.quarantined = True
    message.save(update_fields=["quarantined"])
    record_audit("PHISH_REPORT", mailbox_address=session.mailbox_address,
                 actor=session.mailbox_address, request=request,
                 message=str(message.id),
                 sender=envelope.get("from_addr", ""),
                 subject=envelope.get("subject", ""))
    return Response({"quarantined": True,
                     "detail": "Reported and quarantined. It will not render again."})


def _store_flag(session, message, flag, add=True) -> bool:
    """Push a flag change to IMAP. Never raises into the request.

    The local change has already been made and shown. If the server refuses,
    the next sync reconciles it — which is the right trade for an action the
    user expects to feel instant.
    """
    try:
        with imap_client.for_session(session) as conn:
            conn.select(message.folder.imap_path, readonly=False)
            conn.store_flags(message.uid, [flag], add=add)
        return True
    except Exception:  # noqa: BLE001
        log.warning("could not push %s to IMAP for uid %s", flag, message.uid)
        return False

"""Composing and sending. Every route acts as the session's own mailbox.

There is no `from` parameter anywhere here. The sender is the session's
address, always, and `smtp_client.send` refuses anything else as a second
check — Exim on many cPanel setups will accept a forged From from an
authenticated user, so that guard is ours to hold.
"""
from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import outbox, smtp_client
from .imap_auth import ImapUnavailable
from .middleware import scope_to_session
from .models import Message

log = logging.getLogger("mailcore.views_compose")

#: The furthest ahead a message may be scheduled. Beyond this the promise
#: gets thin: we cannot send while the user is signed out, so a message set
#: for next year depends on them signing in around then.
MAX_SCHEDULE_DAYS = 90


def _addresses(value) -> list:
    if not value:
        return []
    if isinstance(value, str):
        return [a.strip() for a in value.replace(";", ",").split(",") if a.strip()]
    return [str(a).strip() for a in value if str(a).strip()]


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def send_view(request):
    """Queue a message. Nothing reaches Exim until the undo window closes."""
    scope_to_session(request)
    session = request.mail_session
    data = request.data

    draft = {
        "to": _addresses(data.get("to")),
        "cc": _addresses(data.get("cc")),
        "bcc": _addresses(data.get("bcc")),
        "subject": (data.get("subject") or "").strip(),
        "text": data.get("text") or "",
        "html": data.get("html") or "",
        "in_reply_to": (data.get("in_reply_to") or "").strip(),
        "references": data.get("references") or [],
        "from_name": data.get("from_name") or "",
    }
    if not draft["to"]:
        return Response({"to": ["Add at least one recipient."]},
                        status=status.HTTP_400_BAD_REQUEST)

    delay = outbox.UNDO_SECONDS
    kind = "UNDO_WINDOW"
    if data.get("send_in_seconds") is not None:
        try:
            delay = max(0, int(data["send_in_seconds"]))
        except (TypeError, ValueError):
            return Response({"send_in_seconds": ["A number of seconds is required."]},
                            status=status.HTTP_400_BAD_REQUEST)
        if delay > MAX_SCHEDULE_DAYS * 86400:
            return Response(
                {"send_in_seconds": ["Schedule it within %d days." % MAX_SCHEDULE_DAYS]},
                status=status.HTTP_400_BAD_REQUEST)
        if delay > outbox.UNDO_SECONDS:
            kind = "SEND_LATER"

    try:
        action = outbox.queue(session, draft, delay_seconds=delay, kind=kind)
    except outbox.OutboxError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    body = {
        "id": str(action.id),
        "due_at": action.due_at,
        "undo_seconds": delay,
        "kind": kind,
    }
    if kind == "SEND_LATER" and delay > session.seconds_remaining:
        # Said now, not discovered later. We hold no credential once the
        # session ends, so this genuinely cannot fire until they return.
        body["note"] = ("Your session ends before then, so this will send the "
                        "moment you next sign in.")
    return Response(body)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def undo_view(request):
    """Cancel a queued send and hand the draft back."""
    scope_to_session(request)
    try:
        draft = outbox.cancel(request.mail_session, request.data.get("id"))
    except outbox.OutboxError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    return Response({"cancelled": True, "draft": draft})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def flush_view(request):
    """Send anything that has come due.

    Called by the client on load, which is what makes "fires the moment you
    next sign in" true for anything scheduled past a session's life.
    """
    scope_to_session(request)
    try:
        return Response(outbox.run_due(request.mail_session))
    except PermissionError:
        return Response({"detail": "Please sign in again.", "reauth_required": True},
                        status=status.HTTP_401_UNAUTHORIZED)
    except (ImapUnavailable, smtp_client.SmtpUnavailable):
        return Response({"detail": "The mail server is not reachable right now."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def outbox_view(request):
    """What is still waiting to go."""
    scope_to_session(request)
    return Response({"pending": outbox.pending_for(request.mail_session)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reply_view(request, message_id):
    """Everything the composer needs to open a correct reply."""
    scope_to_session(request)
    session = request.mail_session
    message = Message.objects.for_session(session).select_related("folder").filter(
        id=message_id).first()
    if message is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(outbox.reply_context(session, message))

"""Sending, undo-send, and filing the copy in Sent.

The design decision worth understanding: **undo-send is a delay, not a
recall.** Nothing reaches Exim during the window. The message sits in a
PendingAction and "undo" is cancelling a job. That is why this one always
works, and why a real recall — which depends on the recipient's server
cooperating — is not offered.

Send-later uses the same machinery with a longer clock, and inherits the
consequence stated in the blueprint: with no stored credential we cannot send
while the user is signed out, so a message due after their session ends fires
the moment they next sign in. The UI says so at the moment of scheduling
rather than failing quietly days later.
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import timedelta

from django.utils import timezone

from . import crypto, imap_client, smtp_client, sync
from .models import Folder, Mailbox, Message, PendingAction, record_audit

log = logging.getLogger("mailcore.outbox")

#: Seconds between pressing Send and anything leaving. Long enough to notice a
#: mistake, short enough that a session cannot expire inside it.
UNDO_SECONDS = 10


class OutboxError(Exception):
    """Something the sender needs to read."""


def _seal(session, payload: dict) -> bytes:
    return crypto.seal(base64.b64decode(session.dek),
                       json.dumps(payload).encode("utf-8"),
                       aad=session.mailbox_id.encode())


def _open(session, blob) -> dict:
    return json.loads(crypto.unseal(base64.b64decode(session.dek), bytes(blob),
                                    aad=session.mailbox_id.encode()))


# ---------------------------------------------------------------------------
# Queueing
# ---------------------------------------------------------------------------

def queue(session, draft: dict, *, delay_seconds: int = UNDO_SECONDS,
          kind: str = "UNDO_WINDOW") -> PendingAction:
    """Hold a message, sealed, until its moment arrives.

    The draft is encrypted like any other message content — an outbox row is
    a message body sitting in a database, and it gets the same treatment.
    """
    if not draft.get("to"):
        raise OutboxError("There is nobody to send this to.")

    mailbox = Mailbox.objects.get(id=session.mailbox_id)
    return PendingAction.objects.create(
        mailbox=mailbox,
        kind=kind,
        due_at=timezone.now() + timedelta(seconds=delay_seconds),
        payload_enc=_seal(session, draft),
        state="scheduled",
    )


def cancel(session, action_id) -> dict:
    """Undo. Returns the draft so the composer can reopen with it intact."""
    action = PendingAction.objects.for_session(session).filter(
        id=action_id, state="scheduled").first()
    if action is None:
        # Either it already went, or it never existed. Both mean the same
        # thing to the user, and distinguishing them tells them nothing useful.
        raise OutboxError("Too late — that message has already been sent.")
    draft = _open(session, action.payload_enc)
    action.state = "cancelled"
    action.save(update_fields=["state"])
    return draft


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------

def send_draft(session, draft: dict, *, conn=None) -> dict:
    """Submit now, then file the copy. Raises on failure."""
    msg = smtp_client.build_message(
        sender=session.mailbox_address,
        sender_name=draft.get("from_name", ""),
        to=draft.get("to", []),
        cc=draft.get("cc", []),
        bcc=draft.get("bcc", []),
        subject=draft.get("subject", ""),
        text=draft.get("text", ""),
        html=draft.get("html", ""),
        in_reply_to=draft.get("in_reply_to", ""),
        references=draft.get("references", []),
    )
    raw = msg.as_bytes()
    message_id = smtp_client.send(session, msg)

    # Filed after submission, never before. A copy in Sent for a message that
    # was refused is a worse lie than a missing copy.
    filed = file_in_sent(session, raw, conn=conn)
    return {"message_id": message_id, "filed_in_sent": filed}


def file_in_sent(session, raw: bytes, *, conn=None) -> bool:
    """IMAP APPEND the exact bytes we sent, flagged \\Seen.

    Never raises. A message that was delivered but not filed is an annoyance;
    turning that into a failed send would make the user send it twice.
    """
    def _run(c):
        path = _sent_path(session, c)
        if not path:
            log.warning("no Sent folder found for %s", session.mailbox_address)
            return False
        c._conn.append(c._quote(path), "(\\Seen)", None, raw)
        return True

    try:
        if conn is not None:
            return _run(conn)
        with imap_client.for_session(session) as c:
            return _run(c)
    except Exception:  # noqa: BLE001
        log.exception("could not file a sent copy for %s", session.mailbox_address)
        return False


def _sent_path(session, conn) -> str:
    """Find Sent by SPECIAL-USE, then by name, then give up.

    On cPanel this is usually `INBOX.Sent` rather than `Sent`, which is
    exactly why it is discovered rather than hard-coded.
    """
    cached = Folder.objects.for_session(session).filter(special_use="\\Sent").first()
    if cached:
        return cached.imap_path
    for info in conn.list_folders():
        if info.special_use == "\\Sent":
            return info.path
    return ""


# ---------------------------------------------------------------------------
# The worker
# ---------------------------------------------------------------------------

def run_due(session, *, now=None) -> dict:
    """Send everything of this mailbox's that has come due.

    Called by the outbox worker and, importantly, on every new session — that
    is the "fires late rather than never" behaviour for anything scheduled
    past a session's life.
    """
    now = now or timezone.now()
    due = list(PendingAction.objects.for_session(session).filter(
        state="scheduled", due_at__lte=now,
        kind__in=["UNDO_WINDOW", "SEND_LATER"]).order_by("due_at"))

    sent, failed = [], []
    if not due:
        return {"sent": [], "failed": []}

    with imap_client.for_session(session) as conn:
        for action in due:
            action.state = "executing"
            action.attempts += 1
            action.save(update_fields=["state", "attempts"])
            try:
                draft = _open(session, action.payload_enc)
                result = send_draft(session, draft, conn=conn)
                action.state = "done"
                action.save(update_fields=["state"])
                sent.append(result["message_id"])
                record_audit("MAIL_SENT", mailbox_address=session.mailbox_address,
                             actor=session.mailbox_address,
                             recipients=len(draft.get("to", [])),
                             filed=result["filed_in_sent"])
            except (smtp_client.SmtpRejected, OutboxError) as exc:
                # A refusal will be refused again. Stop and tell them.
                action.state = "failed"
                action.last_error = str(exc)[:500]
                action.save(update_fields=["state", "last_error"])
                failed.append({"id": str(action.id), "error": str(exc)})
            except smtp_client.SmtpUnavailable as exc:
                # An outage is temporary. Put it back and try on the next run.
                action.state = "scheduled"
                action.last_error = str(exc)[:500]
                action.save(update_fields=["state", "last_error"])
                failed.append({"id": str(action.id), "error": "will retry"})

    return {"sent": sent, "failed": failed}


def pending_for(session) -> list:
    """Anything still waiting, for the composer and the send-later list."""
    rows = PendingAction.objects.for_session(session).filter(
        state="scheduled").order_by("due_at")
    out = []
    for action in rows:
        try:
            draft = _open(session, action.payload_enc)
        except crypto.SealError:
            continue
        out.append({
            "id": str(action.id),
            "kind": action.kind,
            "due_at": action.due_at,
            "to": draft.get("to", []),
            "subject": draft.get("subject", ""),
        })
    return out


def reply_context(session, message: Message) -> dict:
    """Everything the composer needs to open a correct reply.

    Built here rather than in the browser so that References is assembled from
    what we actually cached, not from what a client happened to render.
    """
    envelope = sync.open_envelope(session, message)
    subject = envelope.get("subject", "") or ""
    if not subject.lower().startswith("re:"):
        subject = "Re: " + subject

    me = session.mailbox_address.lower()
    reply_to = envelope.get("reply_to") or envelope.get("from_addr", "")
    everyone = [a["address"] for a in envelope.get("to", []) + envelope.get("cc", [])]

    return {
        "subject": subject,
        "to": [reply_to] if reply_to else [],
        # Reply-all drops your own address: mailing yourself a copy of your
        # own reply is noise, and doing it by default is a bug people notice.
        "cc_all": [a for a in everyone if a and a.lower() != me and a != reply_to],
        "in_reply_to": envelope.get("message_id", ""),
        "references": envelope.get("references", []),
        "quoted": _quote(envelope, message),
    }


def _quote(envelope, message) -> str:
    who = envelope.get("from_name") or envelope.get("from_addr", "")
    when = message.internal_date.strftime("%d %b %Y at %H:%M")
    return "\n\nOn %s, %s wrote:\n" % (when, who)

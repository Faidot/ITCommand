"""Pulling mail from Dovecot into the encrypted cache.

Everything here runs inside a live session, because everything here needs the
credential. There is no path that syncs a signed-out user's mailbox, by
design — that trade-off was accepted in the blueprint and this module is
where it becomes concrete.

Two invariants worth stating before the code:

* **The cache is disposable.** cPanel holds the mail. If anything here is
  wrong, the repair is always "drop it and re-sync", never "patch the rows".
  That is what makes UIDVALIDITY handling and re-keying safe.
* **Nothing is written unsealed.** Subject, sender and body go through
  `crypto.seal` with the mailbox id as authenticated data before they touch
  Postgres.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging

from django.db import transaction
from django.utils import timezone

from . import bundles, crypto, imap_client, search, threading as threads
from .models import Folder, Mailbox, Message, SearchToken

log = logging.getLogger("mailcore.sync")

#: How many messages per folder to pull on a first sync. Enough to fill a
#: screen many times over; the rest backfills later.
INITIAL_DEPTH = 300


def _dek(session) -> bytes:
    return base64.b64decode(session.dek)


def _search_key(dek: bytes) -> bytes:
    """A key for keyed digests, derived from the DEK rather than reusing it.

    Using the DEK directly for both encryption and HMAC is the kind of reuse
    that is fine until it is not; deriving costs one hash.
    """
    return hashlib.sha256(b"tfm-search-v1" + dek).digest()


def digest(dek: bytes, value: str) -> bytes:
    """Keyed digest, so a value can be matched without being stored."""
    return hmac.new(_search_key(dek), (value or "").encode("utf-8"),
                    hashlib.sha256).digest()


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

def sync_folders(session, conn=None) -> list:
    """Discover folders and record them. Cheap; safe to run on every session."""
    mailbox = Mailbox.objects.get(id=session.mailbox_id)

    def _run(c):
        found = [f for f in c.list_folders() if f.selectable]
        seen = []
        for info in found:
            folder, _ = Folder.objects.get_or_create(
                mailbox=mailbox, imap_path=info.path,
                defaults={"special_use": info.special_use},
            )
            if folder.special_use != info.special_use:
                folder.special_use = info.special_use
                folder.save(update_fields=["special_use"])
            seen.append(folder)

        # A folder that vanished is removed here, unlike a whole mailbox
        # vanishing in IT Command — the difference is that this cache is
        # rebuildable in seconds and holds no record anyone relies on.
        Folder.objects.for_mailbox(mailbox).exclude(
            imap_path__in=[f.path for f in found]).delete()
        return seen

    if conn is not None:
        return _run(conn)
    with imap_client.for_session(session) as c:
        return _run(c)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

def sync_folder(session, folder: Folder, *, depth: int = INITIAL_DEPTH, conn=None) -> dict:
    """Bring one folder's cached envelopes up to date."""
    if conn is not None:
        return _sync_folder(session, folder, depth, conn)
    with imap_client.for_session(session) as c:
        return _sync_folder(session, folder, depth, c)


def _sync_folder(session, folder: Folder, depth: int, conn) -> dict:
    mailbox = Mailbox.objects.get(id=session.mailbox_id)
    dek = _dek(session)
    aad = str(mailbox.id).encode()

    state = conn.select(folder.imap_path)

    # UIDVALIDITY changed: every cached UID for this folder now points at a
    # different message, or at nothing. There is no partial recovery — the
    # numbers are meaningless — so the whole folder is dropped and refetched.
    if folder.uidvalidity and state["uidvalidity"] != folder.uidvalidity:
        log.warning("UIDVALIDITY changed for %s (%s -> %s); dropping cache",
                    folder.imap_path, folder.uidvalidity, state["uidvalidity"])
        Message.objects.for_mailbox(mailbox).filter(folder=folder).delete()

    folder.uidvalidity = state["uidvalidity"]

    uids = conn.recent_uids(limit=depth)
    if not uids:
        folder.total_count = 0
        folder.unread_count = 0
        folder.save(update_fields=["uidvalidity", "total_count", "unread_count"])
        return {"folder": folder.imap_path, "fetched": 0, "new": 0}

    known = dict(
        Message.objects.for_mailbox(mailbox).filter(folder=folder, uid__in=uids)
        .values_list("uid", "id")
    )
    missing = [u for u in uids if u not in known]

    # Flags change on messages we already have, so envelopes for those are
    # refetched too — cheaply, because it is headers only.
    envelopes = conn.fetch_envelopes(missing) if missing else []
    flag_rows = conn.fetch_envelopes([u for u in uids if u in known]) if known else []

    thread_ids = threads.assign(envelopes) if envelopes else []

    created = 0
    with transaction.atomic():
        for envelope, thread_id in zip(envelopes, thread_ids):
            payload = {
                "subject": envelope.subject,
                "from_name": envelope.from_name,
                "from_addr": envelope.from_addr,
                "to": envelope.to,
                "cc": envelope.cc,
                "reply_to": envelope.reply_to,
                "list_id": envelope.list_id,
            }
            row, _ = Message.objects.update_or_create(
                folder=folder, uid=envelope.uid,
                defaults={
                    "mailbox": mailbox,
                    "thread_id": thread_id,
                    "message_id_hmac": digest(dek, envelope.message_id),
                    "internal_date": envelope.internal_date,
                    "size_bytes": envelope.size,
                    "flags": envelope.flags,
                    "bundle": bundles.classify(envelope),
                    "envelope_enc": crypto.seal(
                        dek, _json(payload).encode("utf-8"), aad=aad),
                },
            )
            # Index the envelope now; the body is indexed when it is first
            # fetched, since we do not have it yet.
            _index(dek, mailbox, row, subject=envelope.subject,
                   sender="%s %s" % (envelope.from_name, envelope.from_addr))
            created += 1

        for envelope in flag_rows:
            Message.objects.for_mailbox(mailbox).filter(
                folder=folder, uid=envelope.uid).update(flags=envelope.flags)

        # Anything cached that the server no longer lists in this window has
        # been expunged elsewhere — another client, or webmail.
        Message.objects.for_mailbox(mailbox).filter(folder=folder).exclude(
            uid__in=uids).filter(uid__gte=min(uids)).delete()

    folder.total_count = state["exists"]
    folder.unread_count = Message.objects.for_mailbox(mailbox).filter(
        folder=folder).exclude(flags__contains=["\\Seen"]).count()
    folder.save(update_fields=["uidvalidity", "total_count", "unread_count"])

    mailbox.last_synced_at = timezone.now()
    mailbox.save(update_fields=["last_synced_at"])

    return {"folder": folder.imap_path, "fetched": len(uids), "new": created}


def sync_mailbox(session, *, depth: int = INITIAL_DEPTH) -> dict:
    """Folders, then INBOX, then everything else."""
    with imap_client.for_session(session) as conn:
        folders = sync_folders(session, conn=conn)
        # INBOX first so the screen the user is looking at fills before the
        # folders they are not.
        folders.sort(key=lambda f: (f.imap_path.upper() != "INBOX", f.imap_path))
        results = []
        for folder in folders:
            try:
                results.append(sync_folder(session, folder, depth=depth, conn=conn))
            except Exception:  # noqa: BLE001
                log.exception("could not sync %s", folder.imap_path)
                results.append({"folder": folder.imap_path, "error": True})
    return {"folders": len(results), "detail": results}


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def open_envelope(session, message: Message) -> dict:
    """Decrypt one message's envelope for display."""
    aad = str(message.mailbox_id).encode()
    raw = crypto.unseal(_dek(session), bytes(message.envelope_enc), aad=aad)
    return _unjson(raw.decode("utf-8"))


def fetch_and_cache_body(session, message: Message, conn=None) -> dict:
    """Fetch a message body from IMAP, sanitise it, and cache it sealed."""
    from . import sanitiser

    def _run(c):
        c.select(message.folder.imap_path)
        return c.fetch_body(message.uid)

    body = _run(conn) if conn is not None else _with_conn(session, _run)

    clean_html, findings = sanitiser.clean(body.html) if body.html else ("", {})
    dek = _dek(session)
    aad = str(message.mailbox_id).encode()

    message.body_text_enc = crypto.seal(dek, (body.text or "").encode("utf-8"), aad=aad)
    message.body_html_enc = crypto.seal(dek, (clean_html or "").encode("utf-8"), aad=aad)
    message.has_remote_images = body.has_remote_images or findings.get("remote_images", False)
    message.link_mismatch = findings.get("link_mismatch", False)
    message.save(update_fields=["body_text_enc", "body_html_enc",
                                "has_remote_images", "link_mismatch"])

    # Now that we have the body, re-index with it. The envelope terms are
    # regenerated rather than merged, so the row set always matches the
    # message rather than accumulating from earlier passes.
    envelope = open_envelope(session, message)
    _index(dek, message.mailbox, message,
           subject=envelope.get("subject", ""),
           sender="%s %s" % (envelope.get("from_name", ""), envelope.get("from_addr", "")),
           body=body.text or sanitiser.to_preview(body.text, clean_html, length=20000))

    return {
        "text": body.text,
        "html": clean_html,
        "attachments": body.attachments,
        "has_remote_images": message.has_remote_images,
        "link_mismatch": message.link_mismatch,
    }


def open_body(session, message: Message) -> dict:
    """Cached body if we have it, otherwise fetch it."""
    if not message.body_html_enc and not message.body_text_enc:
        return fetch_and_cache_body(session, message)
    dek = _dek(session)
    aad = str(message.mailbox_id).encode()

    def _open(blob):
        if not blob:
            return ""
        try:
            return crypto.unseal(dek, bytes(blob), aad=aad).decode("utf-8")
        except crypto.SealError:
            # Sealed under a DEK we no longer hold. Refetching is always
            # correct here, because cPanel still has the real message.
            return None

    text, html = _open(message.body_text_enc), _open(message.body_html_enc)
    if text is None or html is None:
        return fetch_and_cache_body(session, message)

    return {
        "text": text, "html": html, "attachments": [],
        "has_remote_images": message.has_remote_images,
        "link_mismatch": message.link_mismatch,
    }


def _with_conn(session, fn):
    with imap_client.for_session(session) as conn:
        return fn(conn)


def _index(dek, mailbox, message, *, subject="", sender="", body=""):
    """Replace a message's search rows. Cheap, and idempotent on re-sync."""
    SearchToken.objects.for_mailbox(mailbox).filter(message=message).delete()
    terms = search.index_terms(dek, subject=subject, sender=sender, body=body)
    if not terms:
        return
    SearchToken.objects.bulk_create([
        SearchToken(mailbox=mailbox, message=message, token_hmac=d, field=f)
        for d, f in terms
    ], ignore_conflicts=True)


def _json(value) -> str:
    import json
    return json.dumps(value, default=str)


def _unjson(value):
    import json
    return json.loads(value)

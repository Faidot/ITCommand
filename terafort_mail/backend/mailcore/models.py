"""The schema from blueprint section 8.

Nothing here is a source of truth. cPanel holds the mail; this is a
disposable, rebuildable projection of it that exists so the UI can be fast.
That is what makes it safe to drop a mailbox's entire cache when a password
change makes it unreadable.
"""
from __future__ import annotations

import uuid

from django.db import models

from .managers import ScopedManager, UnscopedManager


class Mailbox(models.Model):
    """One person's mailbox. The identity that every other row hangs off.

    `address` is set once, from the credential Dovecot accepted, and is never
    written from a client request.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    address = models.CharField(max_length=320, unique=True)

    #: Soft link to IT Command's user id. Not a ForeignKey -- separate
    #: database, separate deployment, and a mailbox must keep working if IT
    #: Command is down.
    itc_user_id = models.IntegerField(null=True, blank=True, db_index=True)

    kek_salt = models.BinaryField()
    wrapped_dek = models.BinaryField()
    #: Bumped when a password change forces the cache to be rebuilt, so log
    #: lines and metrics can tell "new mailbox" from "re-keyed mailbox".
    dek_generation = models.IntegerField(default=1)

    totp_secret = models.CharField(max_length=64, blank=True, default="")
    totp_confirmed_at = models.DateTimeField(null=True, blank=True)
    recovery_code_hashes = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    objects = UnscopedManager()

    class Meta:
        db_table = "mail_mailbox"
        verbose_name_plural = "mailboxes"

    def __str__(self) -> str:
        return self.address

    @property
    def totp_enrolled(self) -> bool:
        return bool(self.totp_secret and self.totp_confirmed_at)


class Folder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="folders")
    imap_path = models.CharField(max_length=512)
    #: \Sent, \Drafts, \Trash, \Junk, \Archive -- from SPECIAL-USE when the
    #: server offers it, guessed from the name when it does not.
    special_use = models.CharField(max_length=32, blank=True, default="")
    uidvalidity = models.BigIntegerField(default=0)
    highest_modseq = models.BigIntegerField(null=True, blank=True)
    unread_count = models.IntegerField(default=0)
    total_count = models.IntegerField(default=0)

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_folder"
        unique_together = [("mailbox", "imap_path")]


class Message(models.Model):
    """Envelope in plaintext only where it must be; everything else sealed.

    `internal_date` stays readable because it is the sort key and an index on
    ciphertext is useless. Subject and sender live in `envelope_enc`.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="messages")
    folder = models.ForeignKey(Folder, on_delete=models.CASCADE, related_name="messages")

    uid = models.BigIntegerField()
    thread_id = models.UUIDField(null=True, blank=True, db_index=True)
    #: Keyed digest, not the Message-ID itself: threading works without
    #: holding correspondents' identifiers in the clear.
    message_id_hmac = models.BinaryField(null=True, blank=True)

    internal_date = models.DateTimeField(db_index=True)
    size_bytes = models.IntegerField(default=0)
    flags = models.JSONField(default=list, blank=True)
    bundle = models.CharField(max_length=32, blank=True, default="", db_index=True)

    envelope_enc = models.BinaryField()
    body_text_enc = models.BinaryField(null=True, blank=True)
    body_html_enc = models.BinaryField(null=True, blank=True)

    has_remote_images = models.BooleanField(default=False)
    #: Only ever set by an explicit user action on this one message.
    images_allowed = models.BooleanField(default=False)
    link_mismatch = models.BooleanField(default=False)
    quarantined = models.BooleanField(default=False)

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_message"
        unique_together = [("folder", "uid")]
        indexes = [
            models.Index(fields=["mailbox", "-internal_date"]),
            models.Index(fields=["mailbox", "bundle"]),
        ]

    @property
    def seen(self) -> bool:
        return "\\Seen" in (self.flags or [])

    @property
    def flagged(self) -> bool:
        return "\\Flagged" in (self.flags or [])


class SearchToken(models.Model):
    """The blind index. One row per (message, distinct token)."""
    id = models.BigAutoField(primary_key=True)
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="search_tokens")
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="tokens")
    token_hmac = models.BinaryField()
    #: 1 subject, 2 sender, 3 body -- for weighting, not for filtering.
    field = models.SmallIntegerField(default=3)

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_search_token"
        indexes = [models.Index(fields=["mailbox", "token_hmac"])]


class Attachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="attachments")
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    part_id = models.CharField(max_length=32)
    filename_enc = models.BinaryField()
    content_type = models.CharField(max_length=128, blank=True, default="")
    size_bytes = models.IntegerField(default=0)

    SCAN_CHOICES = [("pending", "pending"), ("clean", "clean"),
                    ("infected", "infected"), ("failed", "failed")]
    scan_status = models.CharField(max_length=16, choices=SCAN_CHOICES, default="pending")
    scan_at = models.DateTimeField(null=True, blank=True)
    blob_key = models.CharField(max_length=256, blank=True, default="")

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_attachment"


class PendingAction(models.Model):
    """Snooze wake-ups, send-later, and the undo-send window.

    Anything still `scheduled` when a new session starts is flushed then --
    the "fires late rather than never" behaviour signed off in the blueprint.
    """
    KIND_CHOICES = [("SNOOZE_WAKE", "snooze wake"), ("SEND_LATER", "send later"),
                    ("UNDO_WINDOW", "undo window")]
    STATE_CHOICES = [("scheduled", "scheduled"), ("executing", "executing"),
                     ("done", "done"), ("failed", "failed"), ("cancelled", "cancelled")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="pending_actions")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    due_at = models.DateTimeField(db_index=True)
    payload_enc = models.BinaryField()
    state = models.CharField(max_length=16, choices=STATE_CHOICES, default="scheduled")
    attempts = models.IntegerField(default=0)
    last_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_pending_action"
        indexes = [models.Index(fields=["mailbox", "state", "due_at"])]


class Signature(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="signatures")
    name = models.CharField(max_length=120)
    body_enc = models.BinaryField()
    is_default = models.BooleanField(default=False)

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_signature"


class Template(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="templates")
    name = models.CharField(max_length=120)
    body_enc = models.BinaryField()

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_template"


class SharedMailboxGrant(models.Model):
    """v1 ships the grant, the revocation and the audit trail. Reading a
    shared mailbox lands in v1.1 -- see the blueprint decision."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shared_address = models.CharField(max_length=320)
    grantee_mailbox = models.ForeignKey(Mailbox, on_delete=models.CASCADE, related_name="grants")
    granted_by = models.CharField(max_length=320)
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    objects = ScopedManager()
    #: Django's internals -- related descriptors, deserialization, the
    #: test runner -- need a manager that does not raise. Naming it
    #: explicitly keeps it grep-able in a security review.
    all_objects = UnscopedManager()

    class Meta:
        base_manager_name = "all_objects"
        default_manager_name = "objects"
        db_table = "mail_shared_grant"
        unique_together = [("shared_address", "grantee_mailbox")]

    @property
    def active(self) -> bool:
        return self.revoked_at is None


class MailAuditLog(models.Model):
    """Deliberately readable by an administrator, and deliberately holds no
    message content -- only that something happened, to which mailbox, when.

    This is what lets you audit shared-mailbox access without handing anyone a
    way to read mail.
    """
    id = models.BigAutoField(primary_key=True)
    at = models.DateTimeField(auto_now_add=True, db_index=True)
    mailbox_address = models.CharField(max_length=320, db_index=True)
    actor = models.CharField(max_length=320, blank=True, default="")
    action = models.CharField(max_length=48, db_index=True)
    detail = models.JSONField(default=dict, blank=True)
    ip = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=256, blank=True, default="")

    objects = UnscopedManager()

    class Meta:
        db_table = "mail_audit_log"
        ordering = ["-at"]


def record_audit(action: str, *, mailbox_address: str = "", actor: str = "",
                 request=None, **detail) -> MailAuditLog:
    """Append-only. Never raises into the caller: a failed audit write must not
    break the action it was recording, but it must be visible in the logs."""
    ip = ua = ""
    if request is not None:
        ip = (request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
              or request.META.get("REMOTE_ADDR", ""))
        ua = request.META.get("HTTP_USER_AGENT", "")[:256]
    try:
        return MailAuditLog.objects.create(
            action=action, mailbox_address=mailbox_address, actor=actor,
            detail=detail, ip=ip[:64], user_agent=ua,
        )
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger("mailcore.audit").exception("audit write failed: %s", action)
        return None

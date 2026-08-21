"""IT Command's view of the mailboxes on the cPanel server.

cPanel is the source of truth. These rows are a cached projection of it, so
the console can render instantly and so a mailbox can be managed even when
nobody in IT Command owns it -- info@, support@, a leaver's archive.

Three states worth keeping apart:

    linked      a mailbox that belongs to an IT Command user
    unlinked    a real mailbox with no user (shared address, archive)
    orphaned    a row for a mailbox that has since vanished from cPanel

The last one matters: we never silently delete rows when a mailbox disappears,
because "it stopped appearing in list_pops" is also what a cPanel outage looks
like partway through a sync.
"""
from django.db import models
from django.utils import timezone

from .users import User


class ManagedMailbox(models.Model):
    """One mailbox on the mail server."""

    #: Grace period before a mailbox marked for deletion is actually purged.
    #: A month is long enough for "we still need their mail" to surface, and
    #: short enough that leavers do not accumulate forever.
    PURGE_GRACE_DAYS = 30

    address = models.EmailField(max_length=320, unique=True, db_index=True)
    domain = models.CharField(max_length=253, db_index=True)

    #: Null when the mailbox belongs to nobody in IT Command. That is a normal
    #: state, not an error -- shared addresses are not people.
    user = models.OneToOneField(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="mailbox",
    )

    #: None means unlimited, which is NOT the same as 0. Zero would mean the
    #: mailbox has no space at all.
    quota_mb = models.IntegerField(null=True, blank=True)
    disk_used_mb = models.IntegerField(default=0)

    suspended = models.BooleanField(default=False)

    #: False once a sync could not find it on the server. The row is kept so
    #: an operator can see what happened; a mailbox vanishing is also what a
    #: half-failed sync looks like, so we never delete rows automatically.
    exists_in_cpanel = models.BooleanField(default=True)
    missing_since = models.DateTimeField(null=True, blank=True)

    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    #: When IT Command created it, as opposed to when we first saw it. Null
    #: for mailboxes that already existed before this app touched the server.
    provisioned_at = models.DateTimeField(null=True, blank=True)

    # ── two-stage deletion ────────────────────────────────────────────────
    #
    # Nothing is destroyed at the moment somebody clicks delete. The mailbox
    # is marked, stays suspended and fully recoverable, and a job purges it
    # after the grace period. Every mistake is reversible for a month.
    deletion_requested_at = models.DateTimeField(null=True, blank=True)
    deletion_requested_by = models.CharField(max_length=320, blank=True, default="")
    deletion_reason = models.TextField(blank=True, default="")
    purge_after = models.DateTimeField(null=True, blank=True, db_index=True)
    purged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["address"]
        verbose_name = "managed mailbox"
        verbose_name_plural = "managed mailboxes"

    def __str__(self):
        return self.address

    # ── derived state ─────────────────────────────────────────────────────

    @property
    def local_part(self):
        return self.address.split("@")[0]

    @property
    def is_shared(self):
        """No user owns it. Shared and role addresses land here."""
        return self.user_id is None

    @property
    def pending_deletion(self):
        return self.deletion_requested_at is not None and self.purged_at is None

    @property
    def days_until_purge(self):
        if not self.pending_deletion or not self.purge_after:
            return None
        return max(0, (self.purge_after - timezone.now()).days)

    @property
    def purge_due(self):
        """Ready for the purge job to destroy it."""
        return (
            self.pending_deletion
            and self.purge_after is not None
            and timezone.now() >= self.purge_after
        )

    @property
    def usage_percent(self):
        """None for an unlimited mailbox, rather than a misleading 0."""
        if not self.quota_mb:
            return None
        return round(self.disk_used_mb / self.quota_mb * 100, 1)

    @property
    def status(self):
        """One word for the console, in order of what matters most."""
        if self.purged_at:
            return "PURGED"
        if not self.exists_in_cpanel:
            return "MISSING"
        if self.pending_deletion:
            return "PENDING_DELETION"
        if self.suspended:
            return "SUSPENDED"
        return "ACTIVE"

    # ── transitions ───────────────────────────────────────────────────────

    def mark_for_deletion(self, *, by: str, reason: str = "", grace_days: int = None):
        """Start the clock. Destroys nothing."""
        now = timezone.now()
        self.deletion_requested_at = now
        self.deletion_requested_by = by
        self.deletion_reason = reason or ""
        days = self.PURGE_GRACE_DAYS if grace_days is None else grace_days
        self.purge_after = now + timezone.timedelta(days=days)
        self.save(update_fields=[
            "deletion_requested_at", "deletion_requested_by",
            "deletion_reason", "purge_after",
        ])

    def cancel_deletion(self):
        self.deletion_requested_at = None
        self.deletion_requested_by = ""
        self.deletion_reason = ""
        self.purge_after = None
        self.save(update_fields=[
            "deletion_requested_at", "deletion_requested_by",
            "deletion_reason", "purge_after",
        ])

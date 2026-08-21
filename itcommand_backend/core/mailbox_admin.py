"""Managing mailboxes from IT Command: sync, passwords, quotas, deletion.

Creation lives in `mailbox_provisioning`. This is everything you do to a
mailbox afterwards.

The rule that shapes this file: **cPanel acts first, then we record it.** Every
operation calls the mail server, and only updates the local row once the
server has accepted. A local row that claims a mailbox is suspended when it is
not is worse than no row at all -- it is a lie an operator will act on.
"""
from __future__ import annotations

import logging
import re

from django.db import transaction
from django.utils import timezone

from core import cpanel
from core.models.mailboxes import ManagedMailbox
from core.models.users import User

log = logging.getLogger("core.mailbox_admin")


class MailboxAdminError(Exception):
    """Something an operator needs to read."""


class PasswordPolicyError(MailboxAdminError):
    """The password was refused before it ever reached cPanel."""


# ---------------------------------------------------------------------------
# Password policy
# ---------------------------------------------------------------------------

MIN_PASSWORD_LENGTH = 12

#: Not a serious dictionary -- cPanel runs its own strength check too. This
#: catches the handful that get typed when somebody is in a hurry, which is
#: exactly when a weak mailbox password gets set.
_COMMON = {
    "password", "password1", "password123", "passw0rd", "letmein", "welcome",
    "welcome1", "qwerty", "qwerty123", "abc123", "123456", "12345678",
    "123456789", "1234567890", "iloveyou", "admin", "admin123", "root",
    "changeme", "temp1234", "test1234", "terafort", "terafort1", "terafort123",
}


def validate_password(password: str, *, address: str = "", full_name: str = "") -> None:
    """Refuse a password we would regret. Raises PasswordPolicyError.

    Applied to admin-set and self-set passwords alike. A mailbox password is
    the single credential for both applications, so a weak one here is not a
    mail problem -- it is a platform problem.
    """
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            "Use at least %d characters." % MIN_PASSWORD_LENGTH)

    classes = sum([
        bool(re.search(r"[a-z]", password)),
        bool(re.search(r"[A-Z]", password)),
        bool(re.search(r"[0-9]", password)),
        bool(re.search(r"[^A-Za-z0-9]", password)),
    ])
    if classes < 3:
        raise PasswordPolicyError(
            "Use at least three of: lower case, upper case, numbers, symbols.")

    lowered = password.lower()

    if lowered in _COMMON or re.sub(r"[^a-z]", "", lowered) in _COMMON:
        raise PasswordPolicyError("That password is too common to use.")

    # Anything derived from the address or the person's name is the first
    # thing an attacker tries, and it is what people reach for under pressure.
    local = (address or "").split("@")[0].lower()
    parts = [p for p in re.split(r"[^a-z0-9]+", local) if len(p) >= 4]
    parts += [p for p in re.split(r"[^a-z]+", (full_name or "").lower()) if len(p) >= 4]
    for part in parts:
        if part in lowered:
            raise PasswordPolicyError(
                "The password must not contain %r." % part)

    if len(set(password)) < 5:
        raise PasswordPolicyError("That password repeats too few characters.")


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

def sync_mailboxes(*, client: cpanel.CpanelClient | None = None) -> dict:
    """Refresh the local mailbox list from cPanel.

    Never deletes rows. A mailbox that stops appearing is flagged, not
    removed, because "it vanished from list_pops" is also what a cPanel
    outage looks like halfway through a sync.
    """
    try:
        client = client or cpanel.CpanelClient.from_integration()
    except cpanel.CpanelNotConfigured as exc:
        raise MailboxAdminError(str(exc)) from exc

    try:
        rows = client.list_mailboxes()
    except cpanel.CpanelError as exc:
        raise MailboxAdminError("Could not read mailboxes from cPanel: %s" % exc) from exc

    now = timezone.now()
    seen, created, updated = set(), 0, 0

    users_by_email = {
        u.email.strip().lower(): u
        for u in User.objects.filter(is_active=True)
    }

    with transaction.atomic():
        for raw in rows:
            parsed = client.parse_mailbox_row(raw)
            address = parsed["address"]
            if not address or "@" not in address:
                continue
            seen.add(address)

            box, was_created = ManagedMailbox.objects.get_or_create(
                address=address,
                defaults={"domain": address.split("@")[1]},
            )
            box.domain = address.split("@")[1]
            box.quota_mb = parsed["quota_mb"]
            box.disk_used_mb = parsed["disk_used_mb"]
            box.suspended = parsed["suspended_login"]
            box.exists_in_cpanel = True
            box.missing_since = None
            box.last_synced_at = now
            # Link to a user by exact address. Never guessed, never fuzzy --
            # attaching the wrong person to a mailbox is an access-control bug.
            if box.user_id is None and address in users_by_email:
                box.user = users_by_email[address]
            box.save()
            created += 1 if was_created else 0
            updated += 0 if was_created else 1

        vanished = (ManagedMailbox.objects
                    .filter(exists_in_cpanel=True, purged_at__isnull=True)
                    .exclude(address__in=seen))
        gone = list(vanished.values_list("address", flat=True))
        vanished.update(exists_in_cpanel=False, missing_since=now)

    if gone:
        log.warning("mailboxes no longer on the server: %s", ", ".join(gone))

    return {
        "on_server": len(seen),
        "created": created,
        "updated": updated,
        "missing": gone,
        "synced_at": now,
    }


def refresh_one(box: ManagedMailbox, *, client: cpanel.CpanelClient | None = None) -> ManagedMailbox:
    """Re-read a single mailbox after we changed it, so the row is not stale."""
    try:
        client = client or cpanel.CpanelClient.from_integration()
        for raw in client.list_mailboxes():
            parsed = client.parse_mailbox_row(raw)
            if parsed["address"] == box.address:
                box.quota_mb = parsed["quota_mb"]
                box.disk_used_mb = parsed["disk_used_mb"]
                box.suspended = parsed["suspended_login"]
                box.exists_in_cpanel = True
                box.last_synced_at = timezone.now()
                box.save(update_fields=["quota_mb", "disk_used_mb", "suspended",
                                        "exists_in_cpanel", "last_synced_at"])
                break
    except cpanel.CpanelError as exc:
        log.warning("could not refresh %s: %s", box.address, exc)
    return box


# ---------------------------------------------------------------------------
# Operations. cPanel first, then the local row.
# ---------------------------------------------------------------------------

def _client(client=None):
    try:
        return client or cpanel.CpanelClient.from_integration()
    except cpanel.CpanelNotConfigured as exc:
        raise MailboxAdminError(str(exc)) from exc


def set_password(box: ManagedMailbox, password: str, *, actor: str = "",
                 client=None) -> None:
    """Change the mailbox password -- which is the single credential.

    There is no IT Command-side password to keep in step, because mailbox
    users have no local hash. That is what makes this one call sufficient.
    """
    validate_password(
        password,
        address=box.address,
        full_name=box.user.full_name if box.user_id else "",
    )
    try:
        _client(client).change_password(box.address, password)
    except cpanel.CpanelRejected as exc:
        # cPanel runs its own strength policy on top of ours.
        raise MailboxAdminError("cPanel refused the new password: %s" % exc) from exc
    except cpanel.CpanelError as exc:
        raise MailboxAdminError("Could not change the password: %s" % exc) from exc
    log.info("mailbox password changed for %s by %s", box.address, actor or "self")


def set_quota(box: ManagedMailbox, quota_mb: int, *, client=None) -> ManagedMailbox:
    if quota_mb is not None and int(quota_mb) <= 0:
        raise MailboxAdminError(
            "Refusing a quota of %s. cPanel reads 0 as unlimited, so it has to "
            "be chosen deliberately rather than fallen into." % quota_mb)
    try:
        _client(client).set_quota(box.address, int(quota_mb))
    except cpanel.CpanelError as exc:
        raise MailboxAdminError("Could not change the quota: %s" % exc) from exc
    box.quota_mb = int(quota_mb)
    box.save(update_fields=["quota_mb"])
    return box


def suspend(box: ManagedMailbox, *, client=None) -> ManagedMailbox:
    try:
        _client(client).suspend_mailbox(box.address)
    except cpanel.CpanelError as exc:
        raise MailboxAdminError("Could not suspend the mailbox: %s" % exc) from exc
    box.suspended = True
    box.save(update_fields=["suspended"])
    return box


def unsuspend(box: ManagedMailbox, *, client=None) -> ManagedMailbox:
    try:
        _client(client).unsuspend_mailbox(box.address)
    except cpanel.CpanelError as exc:
        raise MailboxAdminError("Could not restore the mailbox: %s" % exc) from exc
    box.suspended = False
    box.save(update_fields=["suspended"])
    return box


def create_standalone(address: str, password: str, *, quota_mb: int | None = None,
                      actor: str = "", client=None) -> ManagedMailbox:
    """A mailbox with no IT Command user -- info@, support@, an archive."""
    address = address.strip().lower()
    validate_password(password, address=address)
    c = _client(client)
    try:
        c.create_mailbox(address, password, quota_mb=quota_mb)
    except cpanel.MailboxExists as exc:
        raise MailboxAdminError("%s already exists on the server." % address) from exc
    except cpanel.CpanelError as exc:
        raise MailboxAdminError("cPanel refused to create %s: %s" % (address, exc)) from exc

    box, _ = ManagedMailbox.objects.get_or_create(
        address=address, defaults={"domain": address.split("@")[1]})
    box.domain = address.split("@")[1]
    box.exists_in_cpanel = True
    box.provisioned_at = timezone.now()
    box.quota_mb = quota_mb or c.quota_mb
    box.save()
    log.info("standalone mailbox %s created by %s", address, actor)
    return box


# ---------------------------------------------------------------------------
# Two-stage deletion
# ---------------------------------------------------------------------------

def request_deletion(box: ManagedMailbox, *, by: str, reason: str = "",
                     client=None) -> ManagedMailbox:
    """Mark for deletion and suspend. Destroys nothing.

    Suspending immediately is the point: access stops now, while the mail
    itself stays recoverable for the whole grace period.
    """
    if box.pending_deletion:
        raise MailboxAdminError("%s is already marked for deletion." % box.address)
    try:
        suspend(box, client=client)
    except MailboxAdminError:
        # A mailbox we cannot suspend can still be marked -- but say so, since
        # the person may still be reading mail.
        log.warning("marked %s for deletion but could not suspend it", box.address)
    box.mark_for_deletion(by=by, reason=reason)
    return box


def cancel_deletion(box: ManagedMailbox, *, restore: bool = True,
                    client=None) -> ManagedMailbox:
    if not box.pending_deletion:
        raise MailboxAdminError("%s is not marked for deletion." % box.address)
    box.cancel_deletion()
    if restore:
        try:
            unsuspend(box, client=client)
        except MailboxAdminError as exc:
            log.warning("cancelled deletion of %s but could not unsuspend: %s",
                        box.address, exc)
    return box


def purge(box: ManagedMailbox, *, actor: str, confirm_address: str,
          force: bool = False, client=None) -> ManagedMailbox:
    """Destroy the mailbox and every message in it. There is no undo.

    Three separate things must line up: the mailbox must be marked for
    deletion, the grace period must have elapsed (unless forced), and the
    caller must type the address back. None of them is decoration -- this is
    the only operation in the application that loses data permanently.
    """
    if confirm_address.strip().lower() != box.address:
        raise MailboxAdminError(
            "Type the full address to confirm. Expected %r." % box.address)
    if not box.pending_deletion:
        raise MailboxAdminError(
            "%s must be marked for deletion first, so there is a record of who "
            "asked and why." % box.address)
    if not box.purge_due and not force:
        raise MailboxAdminError(
            "%s is still inside its %d-day grace period (%d day(s) left). "
            "Wait, or force it deliberately."
            % (box.address, ManagedMailbox.PURGE_GRACE_DAYS, box.days_until_purge or 0))

    try:
        _client(client).delete_mailbox(box.address, i_understand_this_deletes_mail=True)
    except cpanel.CpanelError as exc:
        raise MailboxAdminError("cPanel refused to delete %s: %s" % (box.address, exc)) from exc

    box.purged_at = timezone.now()
    box.exists_in_cpanel = False
    box.save(update_fields=["purged_at", "exists_in_cpanel"])
    log.warning("PURGED mailbox %s by %s -- mail destroyed", box.address, actor)
    return box


def purge_due(*, client=None, dry_run: bool = True) -> dict:
    """Purge every mailbox whose grace period has run out.

    Run from a scheduled job. Dry run by default so that wiring it up wrongly
    cannot destroy anything.
    """
    due = [b for b in ManagedMailbox.objects.filter(
        purged_at__isnull=True, purge_after__isnull=False) if b.purge_due]

    purged, failed = [], []
    if not dry_run:
        c = _client(client)
        for box in due:
            try:
                purge(box, actor="scheduled purge", confirm_address=box.address, client=c)
                purged.append(box.address)
            except MailboxAdminError as exc:
                failed.append((box.address, str(exc)))

    return {
        "due": [b.address for b in due],
        "purged": purged,
        "failed": failed,
        "dry_run": dry_run,
    }

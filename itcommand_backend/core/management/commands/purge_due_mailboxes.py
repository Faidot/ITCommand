"""Destroy mailboxes whose deletion grace period has run out.

This is the only scheduled job in IT Command that loses data permanently, so
it is a dry run unless you pass --apply. Wiring it into cron wrongly cannot
delete anything by itself.

Each mailbox it touches was explicitly marked for deletion by a named person,
suspended at that moment, and left recoverable for the whole grace period.
"""
from django.core.management.base import BaseCommand, CommandError

from core import mailbox_admin
from core.models.mailboxes import ManagedMailbox


class Command(BaseCommand):
    help = ("Purge mailboxes past their deletion grace period. "
            "Dry run unless --apply.")

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Actually delete. Permanent and irreversible.")

    def handle(self, *args, **opts):
        apply_changes = opts["apply"]
        try:
            report = mailbox_admin.purge_due(dry_run=not apply_changes)
        except mailbox_admin.MailboxAdminError as exc:
            raise CommandError(str(exc)) from exc

        if not report["due"]:
            self.stdout.write("No mailboxes are past their grace period.")
            return

        verb = "Purged" if apply_changes else "Would purge"
        self.stdout.write(self.style.WARNING(
            "%s %d mailbox(es):" % (verb, len(report["due"]))))
        for address in report["due"]:
            self.stdout.write("    %s" % address)

        if report["failed"]:
            self.stdout.write("")
            self.stdout.write(self.style.ERROR("Failed:"))
            for address, err in report["failed"]:
                self.stdout.write(self.style.ERROR("    %s — %s" % (address, err)))

        self.stdout.write("")
        if apply_changes:
            self.stdout.write(self.style.SUCCESS(
                "%d mailbox(es) permanently deleted." % len(report["purged"])))
        else:
            pending = ManagedMailbox.objects.filter(
                deletion_requested_at__isnull=False, purged_at__isnull=True).count()
            self.stdout.write(
                "Dry run — nothing was deleted. %d mailbox(es) are marked for "
                "deletion in total. Re-run with --apply to purge those past "
                "their grace period." % pending)

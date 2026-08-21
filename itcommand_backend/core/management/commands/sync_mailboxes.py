"""Refresh IT Command's mailbox list from cPanel.

Read-only against the mail server: it lists mailboxes and updates local rows.
It never creates, changes or deletes anything in cPanel.

Run it on a schedule so the console stays close to reality when somebody edits
a mailbox in cPanel directly.
"""
from django.core.management.base import BaseCommand, CommandError

from core import mailbox_admin


class Command(BaseCommand):
    help = "Sync the mailbox list from cPanel. Read-only against the mail server."

    def handle(self, *args, **opts):
        try:
            report = mailbox_admin.sync_mailboxes()
        except mailbox_admin.MailboxAdminError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS(
            "Synced %d mailbox(es): %d new, %d updated."
            % (report["on_server"], report["created"], report["updated"])))

        if report["missing"]:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "%d row(s) no longer appear on the server:" % len(report["missing"])))
            for address in report["missing"]:
                self.stdout.write("    %s" % address)
            self.stdout.write(
                "\nThese rows were flagged, not deleted. A mailbox vanishing is "
                "also what a half-failed sync looks like, so removing them is "
                "left to you.")

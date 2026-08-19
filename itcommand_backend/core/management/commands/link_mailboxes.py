"""Match existing IT Command users to mailboxes cPanel already has.

The backfill for accounts that predate mailbox provisioning. It creates
nothing on the mail server -- it only connects users to mailboxes that are
already there, by exact email match.

Defaults to a dry run. Nothing changes until you pass --apply.
"""
from django.core.management.base import BaseCommand, CommandError

from core import cpanel, mailbox_provisioning


class Command(BaseCommand):
    help = "Link users to existing cPanel mailboxes. Dry run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Actually switch matched users to mailbox authentication.")

    def handle(self, *args, **opts):
        apply_changes = opts["apply"]
        try:
            report = mailbox_provisioning.link_existing_mailboxes(
                dry_run=not apply_changes)
        except cpanel.CpanelError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write("Mailboxes on the server: %d" % report["mailboxes_on_server"])
        self.stdout.write("")

        if report["linked"]:
            verb = "Linked" if apply_changes else "Would link"
            self.stdout.write(self.style.SUCCESS(
                "%s %d user(s) to mailbox authentication:" % (verb, len(report["linked"]))))
            for address in report["linked"]:
                self.stdout.write("    %s" % address)
        else:
            self.stdout.write("No users matched an existing mailbox.")

        if report["no_mailbox"]:
            self.stdout.write("")
            self.stdout.write(
                "%d user(s) have no mailbox and stay on local passwords:"
                % len(report["no_mailbox"]))
            for address in report["no_mailbox"][:20]:
                self.stdout.write("    %s" % address)
            if len(report["no_mailbox"]) > 20:
                self.stdout.write("    … and %d more" % (len(report["no_mailbox"]) - 20))

        self.stdout.write("")
        if apply_changes:
            self.stdout.write(self.style.WARNING(
                "Linked users now authenticate against Dovecot and their local "
                "password hash has been made unusable. They cannot sign in until "
                "MAIL_AUTH_ENABLED is true. To undo: set auth_source back to "
                "LOCAL and issue a password reset."))
        else:
            self.stdout.write("Dry run. Nothing changed. Re-run with --apply.")

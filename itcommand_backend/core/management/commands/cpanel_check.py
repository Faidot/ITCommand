"""Read-only probe of the cPanel integration.

Run this before relying on mailbox provisioning. It creates nothing, deletes
nothing and changes nothing -- it authenticates, lists the mailboxes that
already exist, and reports what it found.

Several UAPI parameter names have moved between cPanel releases and are marked
`# VERIFY` in core/cpanel.py. This command is how you find out which ones your
host actually accepts, rather than discovering it while creating a real user.
"""
from django.core.management.base import BaseCommand, CommandError

from core import cpanel


class Command(BaseCommand):
    help = "Verify the cPanel API token works. Read-only; creates nothing."

    def add_arguments(self, parser):
        parser.add_argument("--list", action="store_true",
                            help="Print every mailbox found, not just a sample.")

    def handle(self, *args, **opts):
        try:
            client = cpanel.CpanelClient.from_integration()
        except cpanel.CpanelNotConfigured as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write("Connecting to %s as %s…" % (client.host, client.username))
        try:
            report = client.check()
        except cpanel.CpanelUnavailable as exc:
            raise CommandError(
                "Could not reach cPanel. The token has NOT been rejected — this "
                "is a connectivity problem.\n  %s" % exc) from exc
        except cpanel.CpanelRejected as exc:
            raise CommandError(
                "cPanel answered, and refused us.\n  %s\n"
                "Check the token, the cPanel username, and that the token has "
                "access to the Email module." % exc) from exc

        self.stdout.write(self.style.SUCCESS("Connected."))
        self.stdout.write("  domain            %s" % report["domain"])
        self.stdout.write("  mailboxes found   %d" % report["mailbox_count"])
        self.stdout.write("  default quota     %d MB" % report["default_quota_mb"])

        if opts["list"]:
            for address in sorted(client.mailbox_addresses()):
                self.stdout.write("    %s" % address)
        elif report["sample"]:
            self.stdout.write("  sample            %s" % ", ".join(report["sample"]))

        self.stdout.write("")
        self.stdout.write(self.style.WARNING(
            "This proved authentication and Email::list_pops only. Mailbox "
            "creation uses Email::add_pop, whose parameter names differ between "
            "cPanel releases — create one real user and confirm before a bulk "
            "rollout."))

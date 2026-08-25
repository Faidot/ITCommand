"""End-to-end check of the cPanel mailbox lifecycle, on a throwaway address.

`cpanel_check` proves authentication and Email::list_pops. It does not touch
Email::add_pop or Email::suspend_login, and those are the calls whose parameter
names differ between cPanel releases -- the ones marked `# VERIFY` in
core/cpanel.py.

This command exercises them for real, so you find out on an address nobody
cares about rather than on a new colleague's first morning.

    python manage.py cpanel_verify --address itcommand-selftest@terafort.com

IT CREATES A REAL MAILBOX. It does not delete it afterwards unless you ask,
because leaving it lets you confirm it in cPanel and try the password in
webmail. Pass --cleanup once you have looked.
"""
import sys

from django.core.management.base import BaseCommand, CommandError

from core import cpanel, mailbox_provisioning

STEPS = [
    ("Email::add_pop", "creating the mailbox"),
    ("Email::list_pops", "confirming it exists"),
    ("Email::suspend_login", "suspending it"),
    ("Email::unsuspend_login", "unsuspending it"),
]


class Command(BaseCommand):
    help = ("Create, find, suspend and unsuspend a throwaway mailbox to verify "
            "the cPanel calls actually work. Creates a real mailbox.")

    def add_arguments(self, parser):
        parser.add_argument(
            "--address", required=True,
            help="A throwaway address on your mail domain, e.g. "
                 "itcommand-selftest@terafort.com")
        parser.add_argument(
            "--cleanup", action="store_true",
            help="Delete the test mailbox at the end. Permanent.")
        parser.add_argument(
            "--yes", action="store_true",
            help="Skip the confirmation prompt.")

    def handle(self, *args, **opts):
        address = opts["address"].strip().lower()

        try:
            client = cpanel.CpanelClient.from_integration(require_enabled=False)
        except cpanel.CpanelNotConfigured as exc:
            raise CommandError(str(exc)) from exc

        # Refuse anything that looks like it might be a person. A self-test
        # that clobbers a real mailbox is worse than no self-test.
        local = address.split("@")[0]
        if not any(token in local for token in ("test", "selftest", "check", "verify")):
            raise CommandError(
                "Refusing %r: the local part does not look like a test address. "
                "Use something obviously disposable such as "
                "itcommand-selftest@%s, so this can never collide with a real "
                "person." % (address, client.domain))

        if address in client.mailbox_addresses():
            raise CommandError(
                "%s already exists. Pick an address that does not, so this "
                "command can never touch a mailbox holding real mail." % address)

        self.stdout.write(self.style.WARNING(
            "\nThis creates a REAL mailbox at %s on %s." % (address, client.host)))
        if opts["cleanup"]:
            self.stdout.write(self.style.WARNING(
                "It will then be PERMANENTLY DELETED (--cleanup)."))
        else:
            self.stdout.write(
                "It will be left in place so you can check it in cPanel. "
                "Re-run with --cleanup to remove it.")

        if not opts["yes"]:
            if input("\nContinue? [y/N] ").strip().lower() not in ("y", "yes"):
                self.stdout.write("Nothing was done.")
                return

        password = mailbox_provisioning.generate_password()
        results = []

        def step(name, what, fn):
            self.stdout.write("  %-26s %s… " % (name, what), ending="")
            sys.stdout.flush()
            try:
                fn()
            except cpanel.CpanelError as exc:
                self.stdout.write(self.style.ERROR("FAILED"))
                results.append((name, False, str(exc)))
                return False
            self.stdout.write(self.style.SUCCESS("ok"))
            results.append((name, True, ""))
            return True

        self.stdout.write("")
        created = step(STEPS[0][0], STEPS[0][1],
                       lambda: client.create_mailbox(address, password))

        if created:
            def confirm():
                if address not in client.mailbox_addresses():
                    raise cpanel.CpanelRejected(
                        "add_pop reported success but the address is not in "
                        "list_pops. The mailbox may have been created on a "
                        "different domain than expected.")
            if step(STEPS[1][0], STEPS[1][1], confirm):
                if step(STEPS[2][0], STEPS[2][1],
                        lambda: client.suspend_mailbox(address)):
                    step(STEPS[3][0], STEPS[3][1],
                         lambda: client.unsuspend_mailbox(address))

        self.stdout.write("")
        failures = [(n, e) for n, ok, e in results if not ok]

        if failures:
            self.stdout.write(self.style.ERROR("Not all calls worked:\n"))
            for name, err in failures:
                self.stdout.write(self.style.ERROR("  %s\n    %s" % (name, err)))
            self.stdout.write(
                "\nThe error text above is cPanel's own. It usually names the "
                "parameter it did not like, which is enough to correct the call "
                "in core/cpanel.py -- look for the `# VERIFY` comments.")
        else:
            self.stdout.write(self.style.SUCCESS(
                "All four calls work against your server."))
            self.stdout.write(
                "\n  address   %s\n  password  %s\n" % (address, password))
            self.stdout.write(
                "Sign in to webmail with that to confirm the mailbox is real "
                "and the password took.")

        if opts["cleanup"] and created:
            self.stdout.write("")
            try:
                client.delete_mailbox(address, i_understand_this_deletes_mail=True)
                self.stdout.write(self.style.SUCCESS("Test mailbox deleted."))
            except cpanel.CpanelError as exc:
                self.stdout.write(self.style.ERROR(
                    "Could not delete %s: %s\nRemove it by hand in cPanel."
                    % (address, exc)))
        elif created:
            self.stdout.write(self.style.WARNING(
                "\n%s is still on your server. Delete it in cPanel, or re-run "
                "with --cleanup." % address))

        if failures:
            raise CommandError("cPanel verification failed.")

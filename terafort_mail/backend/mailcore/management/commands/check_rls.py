"""Deploy-time check that the isolation layer is actually switched on.

Run this from the container entrypoint. Row-level security that is enabled but
silently bypassed by a superuser role is worse than no RLS at all: it looks
like protection in the schema while providing none.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

TABLES = [
    "mail_folder", "mail_message", "mail_search_token", "mail_attachment",
    "mail_pending_action", "mail_signature", "mail_template", "mail_shared_grant",
]


class Command(BaseCommand):
    help = "Verify row-level security is enabled, forced, and not bypassable."

    def add_arguments(self, parser):
        parser.add_argument("--allow-sqlite", action="store_true",
                            help="Do not fail on a backend that has no RLS (tests only).")

    def handle(self, *args, **opts):
        if connection.vendor != "postgresql":
            msg = "database backend %r has no row-level security" % connection.vendor
            if opts["allow_sqlite"]:
                self.stdout.write(self.style.WARNING("SKIPPED: " + msg))
                return
            raise CommandError(msg)

        problems = []
        with connection.cursor() as cur:
            cur.execute("SELECT current_user, "
                        "(SELECT rolsuper FROM pg_roles WHERE rolname = current_user), "
                        "(SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)")
            role, is_super, bypass = cur.fetchone()
            if is_super:
                problems.append("role %r is a superuser and bypasses every policy" % role)
            if bypass:
                problems.append("role %r has BYPASSRLS" % role)

            for table in TABLES:
                cur.execute(
                    "SELECT relrowsecurity, relforcerowsecurity "
                    "FROM pg_class WHERE relname = %s", [table])
                row = cur.fetchone()
                if row is None:
                    problems.append("table %s is missing" % table)
                    continue
                enabled, forced = row
                if not enabled:
                    problems.append("%s: row level security is NOT enabled" % table)
                if not forced:
                    problems.append("%s: FORCE row level security is off (owner exempt)" % table)
                cur.execute("SELECT count(*) FROM pg_policies "
                            "WHERE tablename = %s AND policyname = 'mailbox_isolation'", [table])
                if cur.fetchone()[0] != 1:
                    problems.append("%s: mailbox_isolation policy missing" % table)

        if problems:
            for p in problems:
                self.stderr.write(self.style.ERROR("  " + p))
            raise CommandError("row-level security is not correctly configured")
        self.stdout.write(self.style.SUCCESS(
            "RLS OK: %d tables enabled, forced, and policied; role cannot bypass"
            % len(TABLES)))

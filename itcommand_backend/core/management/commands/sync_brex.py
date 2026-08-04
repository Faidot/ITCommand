"""Sync cards and card charges from Brex.

Usage:
    python manage.py sync_brex
    python manage.py sync_brex --days 365

Runs daily via the automation service once the integration is enabled.
Safe to re-run: charges are keyed on the Brex transaction id, so a second
run updates rather than duplicates.
"""
from django.core.management.base import BaseCommand, CommandError

from core.brex import PROVIDER, run_sync
from core.models import Integration


class Command(BaseCommand):
    help = "Pull cards and card charges from Brex and match them to subscriptions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=90,
            help="How far back to pull charges (default 90).",
        )

    def handle(self, *args, **options):
        integration = Integration.objects.filter(provider=PROVIDER).first()
        if not integration or not integration.is_enabled:
            self.stdout.write(
                "Brex is not connected — skipping. "
                "Connect it under Settings → Integrations."
            )
            return

        summary, error = run_sync(integration, since_days=options["days"])
        if error:
            # Raise rather than write to stderr and return. `run_automation`
            # treats a command that exits cleanly as a day's work done and
            # sets its marker, so the old behaviour turned one transient 429
            # into a whole day with no sync. Raising makes the runner retry
            # on AUTOMATION_RETRY_SECONDS instead.
            raise CommandError(f"Brex sync failed — {error}")

        counts = (
            f"Synced {summary.get('cards', 0)} card(s), "
            f"{summary.get('card_accounts', 0)} account(s), "
            f"{summary.get('users', 0)} user(s), "
            f"{summary.get('departments', 0)} department(s) and "
            f"{summary.get('charges', 0)} charge(s); "
            f"{summary.get('matched', 0)} matched to services "
            f"({summary.get('new', 0)} new)."
        )

        # A partial run stored real rows, so it is not an error — but saying
        # only the counts would hide that data is missing.
        problems = summary.get("problems") or []
        if problems:
            self.stdout.write(self.style.WARNING(f"{counts} Incomplete:"))
            for problem in problems:
                self.stdout.write(self.style.WARNING(f"  - {problem}"))
            return

        self.stdout.write(self.style.SUCCESS(counts))

"""Sync cards and card charges from Brex.

Usage:
    python manage.py sync_brex
    python manage.py sync_brex --days 365

Runs daily via the automation service once the integration is enabled.
Safe to re-run: charges are keyed on the Brex transaction id, so a second
run updates rather than duplicates.
"""
from django.core.management.base import BaseCommand

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
            self.stderr.write(self.style.ERROR(f"Brex sync failed — {error}"))
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Synced {summary.get('cards', 0)} card(s) and "
                f"{summary.get('charges', 0)} charge(s); "
                f"{summary.get('matched', 0)} matched to services "
                f"({summary.get('new', 0)} new)."
            )
        )

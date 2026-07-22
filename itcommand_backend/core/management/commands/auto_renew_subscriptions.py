"""Run pending subscription auto-renewals.

Usage:
    python manage.py auto_renew_subscriptions

Schedule via cron (daily is plenty):
    0 3 * * * cd /path/to/itcommand_backend && venv/bin/python manage.py auto_renew_subscriptions
"""
from django.core.management.base import BaseCommand

from core.views.subscriptions import run_subscription_auto_renewals


class Command(BaseCommand):
    help = (
        "Advance expiry on every active subscription with auto_renew=True that "
        "has lapsed."
    )

    def handle(self, *args, **options):
        results = run_subscription_auto_renewals(actor=None)
        if not results:
            self.stdout.write("No subscriptions needed auto-renewal.")
            return
        self.stdout.write(
            self.style.SUCCESS(f"Auto-renewed {len(results)} subscription(s):")
        )
        for result in results:
            self.stdout.write(
                f"  · {result['name']} (id {result['id']}): "
                f"{result['previous_expiry']} → {result['new_expiry']} "
                f"({result['cycles_advanced']} cycle(s))"
            )

"""Run pending license auto-renewals.

Usage:
    python manage.py auto_renew_licenses

Schedule via cron (daily is plenty):
    0 3 * * * cd /path/to/itcommand_backend && venv/bin/python manage.py auto_renew_licenses
"""
from django.core.management.base import BaseCommand

from core.views.licenses import run_auto_renewals


class Command(BaseCommand):
    help = "Advance expiry on every active license with auto_renew=True that has lapsed."

    def handle(self, *args, **options):
        results = run_auto_renewals(actor=None)
        if not results:
            self.stdout.write("No licenses needed auto-renewal.")
            return
        self.stdout.write(self.style.SUCCESS(f"Auto-renewed {len(results)} license(s):"))
        for r in results:
            self.stdout.write(
                f"  · {r['name']} (id {r['id']}): "
                f"{r['previous_expiry']} → {r['new_expiry']} "
                f"({r['cycles_advanced']} cycle(s))"
            )

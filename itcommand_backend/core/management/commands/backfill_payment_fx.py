"""Convert card charges that had no exchange rate when they were synced.

Rates arrive daily; charges arrive whenever they arrive. A charge synced
before its rate existed is stored unconverted rather than folded at 1:1, and
this command is what fills it in once the rate turns up.

Usage:
    python manage.py backfill_payment_fx
    python manage.py backfill_payment_fx --days 365
    python manage.py backfill_payment_fx --restate    # after a currency change

Runs daily via the automation service, after `fetch_exchange_rates` so it sees
the rates that arrived this morning. Safe to re-run: a row already converted
into the current reporting currency is skipped.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core import fx
from core.models import ServicePayment


#: Written in one go rather than row by row.
BATCH_SIZE = 500

FX_FIELDS = ["base_amount", "base_currency", "fx_rate", "fx_rate_date"]


class Command(BaseCommand):
    help = "Fill in converted values for card charges that had no rate at sync time."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=730,
            help="How far back to look (default 730).",
        )
        parser.add_argument(
            "--restate", action="store_true",
            help=(
                "Also re-convert rows already converted into a *different* "
                "currency, which is what a change of reporting currency needs."
            ),
        )

    def handle(self, *args, **options):
        reporting = fx.reporting_currency()
        since = timezone.localdate() - timedelta(days=max(1, options["days"]))

        pending = ServicePayment.objects.filter(posted_at__gte=since)
        if options["restate"]:
            # Rows in the old currency are stale, not converted. Re-derived
            # from `amount`, never from the old `base_amount` — converting a
            # converted figure would compound rounding and lose the original.
            pending = pending.exclude(base_currency=reporting)
        else:
            pending = pending.filter(base_amount__isnull=True)

        total = pending.count()
        if not total:
            self.stdout.write("Nothing to convert.")
            return

        converted = 0
        skipped = 0
        batch = []
        for payment in pending.iterator(chunk_size=BATCH_SIZE):
            if payment.apply_fx(reporting_currency=reporting, force=options["restate"]):
                batch.append(payment)
                converted += 1
            else:
                # Still no rate for that currency on that date. Left alone,
                # and reported as unconvertible wherever it is totalled.
                skipped += 1

            if len(batch) >= BATCH_SIZE:
                self._flush(batch)
                batch = []
        self._flush(batch)

        self.stdout.write(self.style.SUCCESS(
            f"Converted {converted} of {total} charge(s) into {reporting}."
        ))
        if skipped:
            self.stdout.write(self.style.WARNING(
                f"{skipped} still have no rate for their currency on their "
                "posting date. They are reported as unconverted rather than "
                "counted at 1:1 — add the missing rates under Settings → "
                "Integrations → Exchange rates, then run this again."
            ))

    @staticmethod
    def _flush(batch):
        if not batch:
            return
        with transaction.atomic():
            ServicePayment.objects.bulk_update(batch, FX_FIELDS)

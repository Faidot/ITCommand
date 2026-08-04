"""Converting card charges into the reporting currency, at the charge's date.

The rule the whole design turns on: **a missing rate never becomes 1:1**. An
unconvertible charge stays unconverted and is reported as such, because a
total that quietly swallowed it would be wrong in a way nobody could see.
"""
from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core.models import (
    AppSettings,
    ExchangeRate,
    Provider,
    ProviderAccount,
    ServicePayment,
)
from core.test_estate_api import make_subscription
from core.test_helpers import create_role, create_user


def set_reporting_currency(code):
    AppSettings.objects.update_or_create(
        key="default_currency", defaults={"value": code}
    )


def rate(currency, value, *, base="PKR", as_of=None):
    return ExchangeRate.objects.create(
        base_currency=base, currency=currency, rate=Decimal(value),
        as_of=as_of or timezone.localdate(), source="MANUAL",
    )


def charge(amount, currency="USD", *, posted_at=None, external_id=None, **extra):
    return ServicePayment.objects.create(
        external_id=external_id or f"txn_{ServicePayment.objects.count() + 1}",
        merchant="TEST MERCHANT",
        amount=Decimal(amount), currency=currency,
        posted_at=posted_at or timezone.localdate(),
        **extra,
    )


class ApplyFxTests(TestCase):
    def setUp(self):
        set_reporting_currency("PKR")
        self.today = timezone.localdate()

    def test_a_charge_is_frozen_at_the_rate_for_its_own_date(self):
        """Not today's rate — the rate that applied when the money moved."""
        rate("USD", "280.0000000000", as_of=self.today - timedelta(days=30))
        rate("USD", "300.0000000000", as_of=self.today)

        old = charge("10.00", posted_at=self.today - timedelta(days=20))
        self.assertTrue(old.apply_fx())

        self.assertEqual(old.base_amount, Decimal("2800.00"))
        self.assertEqual(old.fx_rate, Decimal("280.0000000000"))
        self.assertEqual(old.fx_rate_date, self.today - timedelta(days=30))
        self.assertEqual(old.base_currency, "PKR")

    def test_a_missing_rate_leaves_the_charge_unconverted_not_one_to_one(self):
        unpriced = charge("10.00", currency="XYZ")

        self.assertFalse(unpriced.apply_fx())
        self.assertIsNone(unpriced.base_amount)
        self.assertEqual(unpriced.base_currency, "")
        self.assertIsNone(unpriced.fx_rate)
        self.assertFalse(unpriced.is_converted)

    def test_a_charge_already_in_the_reporting_currency_converts_at_one(self):
        native = charge("1500.00", currency="PKR")
        self.assertTrue(native.apply_fx())
        self.assertEqual(native.base_amount, Decimal("1500.00"))
        self.assertEqual(native.fx_rate, Decimal("1"))
        # No rate row was consulted, so the date falls back to the charge's own.
        self.assertEqual(native.fx_rate_date, native.posted_at)

    def test_the_rate_date_can_be_older_than_the_charge(self):
        """A weekend charge converts at Friday's rate, and says so."""
        friday = self.today - timedelta(days=3)
        rate("USD", "280.0000000000", as_of=friday)
        weekend = charge("10.00", posted_at=self.today)

        weekend.apply_fx()
        self.assertEqual(weekend.fx_rate_date, friday)
        self.assertLess(weekend.fx_rate_date, weekend.posted_at)

    def test_reconverting_an_already_converted_row_is_a_no_op(self):
        rate("USD", "280.0000000000")
        row = charge("10.00")
        self.assertTrue(row.apply_fx())
        self.assertFalse(row.apply_fx(), "already converted into the current currency")

    def test_rounding_is_half_up_at_two_places(self):
        rate("USD", "3.3350000000")
        row = charge("1.00")
        row.apply_fx()
        self.assertEqual(row.base_amount, Decimal("3.34"))

    def test_precision_is_not_lost_through_a_float(self):
        rate("USD", "280.0000000000")
        row = charge("0.01")
        row.apply_fx()
        self.assertEqual(row.base_amount, Decimal("2.80"))


class SyncConversionTests(TestCase):
    """The sync freezes the conversion as it writes each charge."""

    def setUp(self):
        set_reporting_currency("PKR")
        from core.models import Integration

        self.integration = Integration.objects.create(provider="BREX", is_enabled=True)
        self.integration.set_api_key("test-token")
        self.integration.save()

        provider, _ = Provider.objects.get_or_create(
            slug="anthropic", defaults={"name": "Anthropic"}
        )
        account, _ = ProviderAccount.objects.get_or_create(
            provider=provider, account_email="anthropic@example.invalid"
        )
        make_subscription(name="Claude Pro", provider_account=account)

    def paged(self, transactions):
        def _paged(_integration, path, params=None):
            if "cards" in path:
                return [{"id": "cd_1", "last_four": "4242"}], "", ""
            if "transactions" in path:
                return transactions, "", ""
            return [], "", ""
        from unittest import mock

        return mock.patch("core.brex._paged", side_effect=_paged)

    def a_charge(self, **overrides):
        base = {
            "id": "txn_1", "card_id": "cd_1",
            "amount": {"amount": 2000, "currency": "USD"},
            "posted_at_date": timezone.localdate().isoformat(),
            "merchant": {"raw_descriptor": "ANTHROPIC, PBC"},
        }
        base.update(overrides)
        return [base]

    def test_a_synced_charge_is_converted_when_a_rate_exists(self):
        from core import brex

        rate("USD", "280.0000000000")
        with self.paged(self.a_charge()):
            summary, error = brex.run_sync(self.integration)

        self.assertEqual(error, "")
        self.assertEqual(summary["converted"], 1)
        payment = ServicePayment.objects.get()
        self.assertEqual(payment.base_amount, Decimal("5600.00"))
        self.assertEqual(payment.base_currency, "PKR")

    def test_a_synced_charge_without_a_rate_is_stored_unconverted(self):
        from core import brex

        with self.paged(self.a_charge()):
            summary, _error = brex.run_sync(self.integration)

        self.assertEqual(summary["converted"], 0)
        payment = ServicePayment.objects.get()
        self.assertEqual(payment.amount, Decimal("20.00"), "the charge is still stored")
        self.assertIsNone(payment.base_amount)


class BackfillTests(TestCase):
    def setUp(self):
        set_reporting_currency("PKR")
        self.today = timezone.localdate()

    def test_it_converts_rows_that_had_no_rate_when_they_were_synced(self):
        row = charge("10.00")
        self.assertIsNone(row.base_amount)

        rate("USD", "280.0000000000")
        out = StringIO()
        call_command("backfill_payment_fx", stdout=out)

        row.refresh_from_db()
        self.assertEqual(row.base_amount, Decimal("2800.00"))
        self.assertIn("Converted 1", out.getvalue())

    def test_it_is_idempotent(self):
        rate("USD", "280.0000000000")
        row = charge("10.00")
        call_command("backfill_payment_fx", stdout=StringIO())
        first = ServicePayment.objects.get().base_amount

        out = StringIO()
        call_command("backfill_payment_fx", stdout=out)

        row.refresh_from_db()
        self.assertEqual(row.base_amount, first)
        self.assertIn("Nothing to convert", out.getvalue())

    def test_rows_that_still_have_no_rate_are_reported_not_forced(self):
        charge("10.00", currency="XYZ")
        out = StringIO()
        call_command("backfill_payment_fx", stdout=out)

        self.assertIsNone(ServicePayment.objects.get().base_amount)
        self.assertIn("no rate", out.getvalue())

    def test_restate_reconverts_after_the_reporting_currency_changes(self):
        """Every frozen figure predating the change is in the old currency."""
        rate("USD", "280.0000000000", base="PKR")
        row = charge("10.00")
        call_command("backfill_payment_fx", stdout=StringIO())
        row.refresh_from_db()
        self.assertEqual(row.base_currency, "PKR")

        set_reporting_currency("GBP")
        rate("USD", "0.8000000000", base="GBP")

        call_command("backfill_payment_fx", "--restate", stdout=StringIO())

        row.refresh_from_db()
        self.assertEqual(row.base_currency, "GBP")
        self.assertEqual(
            row.base_amount, Decimal("8.00"),
            "re-derived from the original amount, not from the old converted figure",
        )

    def test_without_restate_a_stale_row_is_left_alone(self):
        rate("USD", "280.0000000000", base="PKR")
        row = charge("10.00")
        call_command("backfill_payment_fx", stdout=StringIO())

        set_reporting_currency("GBP")
        rate("USD", "0.8000000000", base="GBP")
        call_command("backfill_payment_fx", stdout=StringIO())

        row.refresh_from_db()
        self.assertEqual(row.base_currency, "PKR", "restating is opt-in")


class SummaryConversionTests(TestCase):
    def setUp(self):
        set_reporting_currency("PKR")
        self.client = APIClient()
        self.client.force_authenticate(
            create_user("fx-view@example.invalid", create_role("FX_VIEW", view=True).slug)
        )
        self.url = reverse("estate-payment-summary")

    def test_the_converted_total_sums_only_what_could_be_converted(self):
        rate("USD", "280.0000000000")
        usd = charge("10.00", currency="USD")
        usd.apply_fx()
        usd.save()
        charge("50.00", currency="XYZ")  # no rate

        response = self.client.get(self.url)
        converted = response.data["converted"]

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(converted["currency"], "PKR")
        self.assertEqual(converted["total"], "2800.00")
        self.assertEqual(converted["converted_count"], 1)
        self.assertFalse(converted["is_complete"])

    def test_what_the_total_excludes_is_named_rather_than_dropped(self):
        charge("50.00", currency="XYZ")

        response = self.client.get(self.url)
        unconvertible = response.data["converted"]["unconvertible"]

        self.assertEqual(len(unconvertible), 1)
        self.assertEqual(unconvertible[0]["currency"], "XYZ")
        self.assertEqual(unconvertible[0]["total"], "50.00")

    def test_a_fully_converted_window_reports_complete(self):
        rate("USD", "280.0000000000")
        row = charge("10.00")
        row.apply_fx()
        row.save()

        response = self.client.get(self.url)
        self.assertTrue(response.data["converted"]["is_complete"])
        self.assertEqual(response.data["converted"]["unconvertible"], [])

    def test_a_row_frozen_in_the_old_currency_is_not_counted(self):
        """Stale, not usable. Counting it would mix GBP into a PKR total."""
        rate("USD", "280.0000000000", base="PKR")
        row = charge("10.00")
        row.apply_fx()
        row.save()

        set_reporting_currency("GBP")
        response = self.client.get(self.url)
        converted = response.data["converted"]

        self.assertEqual(converted["currency"], "GBP")
        self.assertEqual(converted["total"], "0.00")
        self.assertFalse(converted["is_complete"])
        self.assertEqual(converted["unconvertible"][0]["currency"], "USD")

    def test_per_currency_totals_are_still_reported_alongside(self):
        rate("USD", "280.0000000000")
        row = charge("10.00")
        row.apply_fx()
        row.save()

        response = self.client.get(self.url)
        totals = {r["currency"]: r["total"] for r in response.data["totals"]}
        self.assertEqual(totals["USD"], "10.00", "the original figure survives")

    def test_the_charge_payload_exposes_the_rate_that_was_used(self):
        rate("USD", "280.0000000000")
        row = charge("10.00")
        row.apply_fx()
        row.save()

        response = self.client.get(reverse("estate-payment-list"))
        payload = response.data["results"][0]

        self.assertEqual(payload["base_amount"], "2800.00")
        self.assertEqual(payload["base_currency"], "PKR")
        self.assertEqual(payload["fx_rate"], "280.0000000000")
        self.assertTrue(payload["is_converted"])

    def test_an_unconverted_charge_reports_null_not_zero(self):
        charge("50.00", currency="XYZ")
        response = self.client.get(reverse("estate-payment-list"))
        payload = response.data["results"][0]

        self.assertIsNone(payload["base_amount"])
        self.assertFalse(payload["is_converted"])


class RateWithDateTests(TestCase):
    """`fx.rate_with_date` has to report which row it used, not just the rate."""

    def setUp(self):
        set_reporting_currency("PKR")
        self.today = timezone.localdate()

    def test_it_returns_the_as_of_of_the_row_it_used(self):
        from core import fx

        older = self.today - timedelta(days=5)
        rate("USD", "280.0000000000", as_of=older)
        value, as_of = fx.rate_with_date("USD", base="PKR", on_date=self.today)

        self.assertEqual(value, Decimal("280.0000000000"))
        self.assertEqual(as_of, older)

    def test_an_inverse_rate_still_reports_its_date(self):
        from core import fx

        as_of = self.today - timedelta(days=2)
        ExchangeRate.objects.create(
            base_currency="USD", currency="PKR", rate=Decimal("0.0035714286"),
            as_of=as_of, source="MANUAL",
        )
        value, reported = fx.rate_with_date("USD", base="PKR", on_date=self.today)

        self.assertIsNotNone(value)
        self.assertEqual(reported, as_of)

    def test_the_same_currency_needs_no_row(self):
        from core import fx

        value, as_of = fx.rate_with_date("PKR", base="PKR")
        self.assertEqual(value, Decimal("1"))
        self.assertIsNone(as_of)

    def test_an_unknown_currency_returns_nothing_rather_than_one(self):
        from core import fx

        self.assertEqual(fx.rate_with_date("XYZ", base="PKR"), (None, None))

    def test_get_rate_still_behaves_as_before(self):
        """The old entry point is unchanged for its existing callers."""
        from core import fx

        rate("USD", "280.0000000000")
        self.assertEqual(fx.get_rate("USD", base="PKR"), Decimal("280.0000000000"))
        self.assertIsNone(fx.get_rate("XYZ", base="PKR"))

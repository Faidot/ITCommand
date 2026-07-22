from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core import fx
from core.models import AppSettings, ExchangeRate, Integration, User
from core.test_subscriptions import create_role, create_user


def set_reporting_currency(code):
    AppSettings.objects.update_or_create(
        key="default_currency", defaults={"value": code}
    )


class ConversionTests(TestCase):
    def setUp(self):
        set_reporting_currency("USD")
        self.today = timezone.localdate()
        ExchangeRate.objects.create(
            base_currency="USD", currency="EUR", rate=Decimal("1.10"), as_of=self.today
        )
        ExchangeRate.objects.create(
            base_currency="USD", currency="PKR", rate=Decimal("0.0036"), as_of=self.today
        )

    def test_same_currency_is_identity(self):
        self.assertEqual(fx.convert(Decimal("50"), "USD"), Decimal("50.00"))

    def test_direct_conversion(self):
        self.assertEqual(fx.convert(Decimal("100"), "EUR"), Decimal("110.00"))

    def test_conversion_is_case_insensitive(self):
        self.assertEqual(fx.convert(Decimal("100"), "eur"), Decimal("110.00"))

    def test_inverse_rate_is_used_when_only_the_reverse_is_stored(self):
        ExchangeRate.objects.create(
            base_currency="GBP", currency="USD", rate=Decimal("0.80"), as_of=self.today
        )
        # 1 USD = 0.80 GBP, so 1 GBP = 1.25 USD.
        self.assertEqual(fx.convert(Decimal("100"), "GBP"), Decimal("125.00"))

    def test_an_unknown_currency_returns_none_rather_than_one_to_one(self):
        """The headline safety property: never silently treat 1 JPY as 1 USD."""
        self.assertIsNone(fx.convert(Decimal("100"), "JPY"))
        self.assertIsNone(fx.get_rate("JPY"))

    def test_the_newest_rate_on_or_before_a_date_is_used(self):
        ExchangeRate.objects.create(
            base_currency="USD",
            currency="EUR",
            rate=Decimal("1.20"),
            as_of=self.today - timedelta(days=10),
        )
        # Today's 1.10 wins now...
        self.assertEqual(fx.convert(Decimal("100"), "EUR"), Decimal("110.00"))
        # ...but a report dated a week ago still uses the older rate.
        self.assertEqual(
            fx.convert(Decimal("100"), "EUR", on_date=self.today - timedelta(days=5)),
            Decimal("120.00"),
        )

    def test_a_rate_dated_after_the_report_is_ignored(self):
        ExchangeRate.objects.all().delete()
        ExchangeRate.objects.create(
            base_currency="USD",
            currency="EUR",
            rate=Decimal("1.10"),
            as_of=self.today + timedelta(days=5),
        )
        self.assertIsNone(fx.convert(Decimal("100"), "EUR"))

    def test_convert_many_totals_and_reports_what_it_could_not_convert(self):
        total, currency, unconvertible = fx.convert_many(
            [
                (Decimal("100"), "EUR"),
                (Decimal("10000"), "PKR"),
                (Decimal("50"), "USD"),
                (Decimal("900"), "JPY"),
            ]
        )
        self.assertEqual(currency, "USD")
        self.assertEqual(total, Decimal("196.00"))  # 110 + 36 + 50
        self.assertEqual(unconvertible, [{"currency": "JPY", "amount": "900.00"}])

    def test_convert_many_groups_repeated_unconvertible_currencies(self):
        _, _, unconvertible = fx.convert_many(
            [(Decimal("100"), "JPY"), (Decimal("50"), "JPY")]
        )
        self.assertEqual(unconvertible, [{"currency": "JPY", "amount": "150.00"}])

    def test_reporting_currency_follows_the_global_setting(self):
        set_reporting_currency("PKR")
        self.assertEqual(fx.reporting_currency(), "PKR")
        # 1 PKR = 0.0036 USD, so 1 USD ≈ 277.78 PKR.
        converted = fx.convert(Decimal("1"), "USD")
        self.assertIsNotNone(converted)
        self.assertGreater(converted, Decimal("270"))

    def test_missing_rate_currencies_lists_only_the_gaps(self):
        self.assertEqual(
            fx.missing_rate_currencies(["USD", "EUR", "JPY", "AUD"]), ["AUD", "JPY"]
        )

    def test_rate_as_of_reports_the_newest_date(self):
        self.assertEqual(fx.rate_as_of("USD"), self.today)


class IntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.superadmin = create_user("fx-super@example.com", "SUPERADMIN")
        self.plain = create_user("fx-plain@example.com", create_role("FX_VIEWER", view=True).slug)
        self.client.force_authenticate(self.superadmin)

    def test_api_key_is_encrypted_and_never_returned(self):
        response = self.client.put(
            reverse("integrations"),
            {"provider": "EXCHANGE_RATES", "api_key": "super-secret-key"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data["has_api_key"])
        self.assertNotIn("api_key", response.data)
        self.assertNotIn("super-secret-key", str(response.data))

        stored = Integration.objects.get(provider="EXCHANGE_RATES")
        self.assertNotIn("super-secret-key", stored.encrypted_api_key)
        self.assertEqual(stored.get_api_key(), "super-secret-key")

    def test_enabling_without_a_key_is_rejected(self):
        response = self.client.put(
            reverse("integrations"),
            {"provider": "EXCHANGE_RATES", "is_enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_saved_key_survives_a_later_update(self):
        self.client.put(
            reverse("integrations"),
            {"provider": "EXCHANGE_RATES", "api_key": "keep-me"},
            format="json",
        )
        self.client.put(
            reverse("integrations"),
            {"provider": "EXCHANGE_RATES", "base_url": "https://example.test/rates"},
            format="json",
        )
        self.assertEqual(
            Integration.objects.get(provider="EXCHANGE_RATES").get_api_key(), "keep-me"
        )

    def test_clearing_the_key_disables_the_integration(self):
        self.client.put(
            reverse("integrations"),
            {"provider": "EXCHANGE_RATES", "api_key": "temp"},
            format="json",
        )
        self.client.put(
            reverse("integrations"),
            {"provider": "EXCHANGE_RATES", "clear_api_key": True, "is_enabled": False},
            format="json",
        )
        stored = Integration.objects.get(provider="EXCHANGE_RATES")
        self.assertFalse(stored.has_api_key)
        self.assertFalse(stored.is_enabled)

    def test_unknown_provider_is_rejected(self):
        response = self.client.put(
            reverse("integrations"), {"provider": "NOT_REAL"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_a_superadmin_may_read_or_write_integrations(self):
        self.client.force_authenticate(self.plain)
        self.assertEqual(
            self.client.get(reverse("integrations")).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.put(
                reverse("integrations"),
                {"provider": "EXCHANGE_RATES", "api_key": "x"},
                format="json",
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )


class FetchExchangeRatesCommandTests(TestCase):
    def test_it_does_nothing_when_the_integration_is_disabled(self):
        out = StringIO()
        call_command("fetch_exchange_rates", stdout=out)
        self.assertIn("not enabled", out.getvalue())
        self.assertEqual(ExchangeRate.objects.count(), 0)

    def test_a_provider_failure_is_recorded_and_does_not_raise(self):
        integration = Integration.objects.create(
            provider="EXCHANGE_RATES",
            is_enabled=True,
            base_url="http://127.0.0.1:9/never-listening",
        )
        integration.set_api_key("k")
        integration.save()

        call_command("fetch_exchange_rates", stdout=StringIO(), stderr=StringIO())

        integration.refresh_from_db()
        self.assertEqual(integration.last_status, "ERROR")
        self.assertTrue(integration.last_message)
        self.assertEqual(ExchangeRate.objects.count(), 0)

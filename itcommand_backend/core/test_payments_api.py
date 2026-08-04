"""The read-only API onto what the Brex sync writes.

Before these endpoints existed the sync had no consumer in the product: cards
and charges were reachable only through the Django admin. These tests pin the
two things that matter about exposing them — that the permission split is real,
and that money survives the round trip exactly.
"""
from datetime import timedelta
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from django.test import TestCase

from core.models import CardAccount, PaymentCard, Provider, ProviderAccount, ServicePayment
from core.test_estate_api import make_subscription
from core.test_helpers import create_role, create_user


def a_service(name="Claude Pro", provider_name="Anthropic"):
    provider, _ = Provider.objects.get_or_create(
        slug=provider_name.lower(), defaults={"name": provider_name}
    )
    account, _ = ProviderAccount.objects.get_or_create(
        provider=provider, account_email=f"{provider.slug}@example.invalid"
    )
    return make_subscription(name=name, provider_account=account)


class PaymentsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.viewer = create_user(
            "payments-view@example.invalid",
            create_role("PAY_VIEW", view=True).slug,
        )
        self.client.force_authenticate(self.viewer)

        self.card = PaymentCard.objects.create(
            external_id="cd_1", last_four="4242", nickname="Ops",
            holder_name="Sam Lee", status="ACTIVE", form="VIRTUAL",
            limit_amount=Decimal("2500.00"), limit_currency="USD",
            limit_interval="MONTHLY",
        )
        self.service = a_service()
        self.service.payment_card = self.card
        self.service.save(update_fields=["payment_card"])

        self.matched = ServicePayment.objects.create(
            external_id="txn_1", merchant="ANTHROPIC, PBC",
            amount=Decimal("19.99"), currency="USD",
            posted_at=timezone.localdate(), card=self.card,
            service=self.service, match_source="AUTO", match_score=0.9,
        )
        self.unmatched = ServicePayment.objects.create(
            external_id="txn_2", merchant="STARBUCKS 4412",
            amount=Decimal("4.50"), currency="USD",
            posted_at=timezone.localdate(), card=self.card,
            match_source="NONE",
        )

    # --- cards -------------------------------------------------------
    def test_cards_list_without_any_card_number(self):
        response = self.client.get(reverse("estate-card-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["results"][0]

        self.assertEqual(row["last_four"], "4242")
        self.assertEqual(row["display"], "•••• 4242")
        self.assertEqual(row["form_label"], "Virtual")
        # A PAN must not be reachable, by any field name.
        for forbidden in ("pan", "number", "card_number"):
            self.assertNotIn(forbidden, row)

    def test_a_card_reports_how_many_services_renew_on_it(self):
        response = self.client.get(reverse("estate-card-list"))
        self.assertEqual(response.data["results"][0]["service_count"], 1)

    def test_a_card_limit_is_a_fixed_2dp_string_not_a_float(self):
        """JSON floats cannot hold 0.01 exactly; totals built on them drift."""
        response = self.client.get(reverse("estate-card-list"))
        self.assertEqual(response.data["results"][0]["limit_amount"], "2500.00")

    # --- charges -----------------------------------------------------
    def test_charges_list_newest_first(self):
        ServicePayment.objects.create(
            external_id="txn_old", merchant="OLD",
            amount=Decimal("1.00"), currency="USD",
            posted_at=timezone.localdate() - timedelta(days=10),
        )
        response = self.client.get(reverse("estate-payment-list"))
        dates = [row["posted_at"] for row in response.data["results"]]
        self.assertEqual(dates, sorted(dates, reverse=True))

    def test_amounts_survive_the_round_trip_exactly(self):
        response = self.client.get(reverse("estate-payment-list"))
        amounts = {row["merchant"]: row["amount"] for row in response.data["results"]}
        self.assertEqual(amounts["ANTHROPIC, PBC"], "19.99")
        self.assertEqual(amounts["STARBUCKS 4412"], "4.50")

    def test_unmatched_charges_can_be_isolated(self):
        """The unmatched list is the finding this page exists to show."""
        response = self.client.get(reverse("estate-payment-list"), {"matched": "false"})
        merchants = [row["merchant"] for row in response.data["results"]]
        self.assertEqual(merchants, ["STARBUCKS 4412"])

    def test_matched_charges_can_be_isolated(self):
        response = self.client.get(reverse("estate-payment-list"), {"matched": "true"})
        merchants = [row["merchant"] for row in response.data["results"]]
        self.assertEqual(merchants, ["ANTHROPIC, PBC"])

    def test_charges_can_be_filtered_to_one_service(self):
        response = self.client.get(
            reverse("estate-payment-list"), {"service": self.service.pk}
        )
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["service_name"], "Claude Pro")

    def test_the_day_window_excludes_older_charges(self):
        ServicePayment.objects.create(
            external_id="txn_ancient", merchant="ANCIENT",
            amount=Decimal("1.00"), currency="USD",
            posted_at=timezone.localdate() - timedelta(days=200),
        )
        response = self.client.get(reverse("estate-payment-list"), {"days": "30"})
        merchants = [row["merchant"] for row in response.data["results"]]
        self.assertNotIn("ANCIENT", merchants)

    def test_a_nonsense_day_window_does_not_error(self):
        response = self.client.get(reverse("estate-payment-list"), {"days": "banana"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    # --- summary -----------------------------------------------------
    def test_the_summary_counts_matched_and_unmatched(self):
        response = self.client.get(reverse("estate-payment-summary"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["charge_count"], 2)
        self.assertEqual(response.data["matched_count"], 1)
        self.assertEqual(response.data["unmatched_count"], 1)
        self.assertEqual(response.data["card_count"], 1)

    def test_totals_are_grouped_by_currency_and_never_summed_across_them(self):
        """There is no FX on charges yet; one headline would be a wrong number."""
        ServicePayment.objects.create(
            external_id="txn_eur", merchant="EURO THING",
            amount=Decimal("10.00"), currency="EUR",
            posted_at=timezone.localdate(),
        )
        response = self.client.get(reverse("estate-payment-summary"))

        totals = {row["currency"]: row["total"] for row in response.data["totals"]}
        self.assertEqual(totals["USD"], "24.49")
        self.assertEqual(totals["EUR"], "10.00")
        self.assertNotIn("total", response.data)

    def test_unmatched_totals_are_reported_separately(self):
        response = self.client.get(reverse("estate-payment-summary"))
        unmatched = {
            row["currency"]: row["total"] for row in response.data["unmatched_totals"]
        }
        self.assertEqual(unmatched["USD"], "4.50")

    # --- write protection --------------------------------------------
    def test_the_endpoints_are_read_only(self):
        """These rows belong to the sync; a hand edit would not survive it."""
        editor = create_user(
            "payments-edit@example.invalid",
            create_role("PAY_EDIT", view=True, add=True, edit=True, delete=True).slug,
        )
        client = APIClient()
        client.force_authenticate(editor)

        self.assertEqual(
            client.post(reverse("estate-card-list"), {"last_four": "9999"}).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertEqual(
            client.patch(
                reverse("estate-payment-detail", args=[self.unmatched.pk]),
                {"service": self.service.pk}, format="json",
            ).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertEqual(
            client.delete(
                reverse("estate-payment-detail", args=[self.matched.pk])
            ).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    # --- permissions --------------------------------------------------
    def test_a_user_without_estate_view_is_refused(self):
        client = APIClient()
        client.force_authenticate(
            create_user("no-estate@example.invalid", create_role("NO_ESTATE").slug)
        )
        for name in ("estate-card-list", "estate-payment-list"):
            self.assertEqual(
                client.get(reverse(name)).status_code,
                status.HTTP_403_FORBIDDEN,
                name,
            )

    def test_an_anonymous_caller_is_refused(self):
        client = APIClient()
        self.assertEqual(
            client.get(reverse("estate-payment-list")).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )


class CardAccountPermissionTests(TestCase):
    """Balances are treasury data, so they sit behind `finance`, not `estate`."""

    def setUp(self):
        CardAccount.objects.create(
            external_id="acc_1", name="Primary", currency="USD",
            current_balance=Decimal("12345.67"),
            available_balance=Decimal("10000.00"),
        )
        self.url = reverse("card-account-list")

    def test_estate_view_alone_does_not_reveal_a_balance(self):
        """An estate viewer should not inherit sight of company cash."""
        role = create_role("ESTATE_ONLY", view=True)
        client = APIClient()
        client.force_authenticate(
            create_user("estate-only@example.invalid", role.slug)
        )
        self.assertEqual(client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)

    def test_finance_view_sees_balances_as_exact_strings(self):
        role = create_role("FIN_VIEW", finance={"view": True})
        client = APIClient()
        client.force_authenticate(create_user("fin@example.invalid", role.slug))
        response = client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["results"][0]
        self.assertEqual(row["current_balance"], "12345.67")
        self.assertEqual(row["available_balance"], "10000.00")

    def test_a_missing_balance_serialises_as_null_not_zero(self):
        CardAccount.objects.all().update(current_balance=None, available_balance=None)
        role = create_role("FIN_VIEW2", finance={"view": True})

        client = APIClient()
        client.force_authenticate(create_user("fin2@example.invalid", role.slug))
        row = client.get(self.url).data["results"][0]

        self.assertIsNone(row["current_balance"])
        self.assertIsNone(row["available_balance"])

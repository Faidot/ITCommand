from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core import brex
from core.models import (
    Integration,
    PaymentCard,
    Subscription,
    SubscriptionPayment,
    User,
)
from core.test_subscription_assignments import make_subscription
from core.test_subscriptions import create_role, create_user


class DescriptorMatchingTests(TestCase):
    def setUp(self):
        self.claude = make_subscription(name="Claude Pro", platform="Anthropic")
        self.chatgpt = make_subscription(name="ChatGPT Business", platform="OpenAI")
        self.figma = make_subscription(name="Figma Org", platform="Figma")
        self.subs = [self.claude, self.chatgpt, self.figma]

    def test_descriptor_noise_is_stripped(self):
        self.assertEqual(
            brex.normalise_descriptor("SQ *CLAUDE.AI SUBSCR 4155551234 CA"),
            "sq claude ai ca",
        )
        self.assertEqual(brex.normalise_descriptor("FIGMA MONTHLY INC"), "figma")

    def test_a_partial_descriptor_still_matches_its_subscription(self):
        """'SQ *CLAUDE.AI' covers only half of 'Claude Pro' but is all about it."""
        match, score = brex.best_match("SQ *CLAUDE.AI SUBSCR", self.subs)
        self.assertEqual(match, self.claude)
        self.assertGreaterEqual(score, brex.MATCH_THRESHOLD)

    def test_platform_names_match(self):
        for descriptor, expected in (
            ("ANTHROPIC, PBC RECURRING", self.claude),
            ("OPENAI *CHATGPT SUBSCRIPTION", self.chatgpt),
            ("FIGMA MONTHLY", self.figma),
        ):
            match, _ = brex.best_match(descriptor, self.subs)
            self.assertEqual(match, expected, descriptor)

    def test_unrelated_spend_is_left_alone(self):
        for descriptor in ("STARBUCKS STORE 4412", "UBER TRIP", "AMZN MKTP US*1A2B3"):
            match, _ = brex.best_match(descriptor, self.subs)
            self.assertIsNone(match, descriptor)

    def test_an_explicit_billing_descriptor_wins(self):
        self.figma.billing_descriptor = "WEIRD*VENDOR9911"
        match, score = brex.best_match("WEIRD*VENDOR9911", [self.claude, self.figma])
        self.assertEqual(match, self.figma)
        self.assertEqual(score, 1.0)

    def test_a_tie_is_left_unmatched_rather_than_guessed(self):
        first = make_subscription(name="Google Workspace", platform="Google")
        second = make_subscription(name="Google Cloud", platform="Google")
        match, score = brex.best_match("GOOGLE *SERVICES", [first, second])
        self.assertIsNone(match, "an ambiguous descriptor must not pick one at random")
        self.assertGreater(score, 0)

    def test_cancelled_subscriptions_are_not_offered_for_matching(self):
        """sync_transactions excludes them; this documents the intent."""
        self.figma.status = "CANCELLED"
        self.figma.save(update_fields=["status"])
        candidates = list(Subscription.objects.exclude(status="CANCELLED"))
        self.assertNotIn(self.figma, candidates)


class AmountParsingTests(TestCase):
    def test_minor_units_are_converted(self):
        self.assertEqual(brex.money_from_brex({"amount": 1999, "currency": "USD"}),
                         (Decimal("19.99"), "USD"))

    def test_zero_decimal_currencies_are_not_divided(self):
        """¥1500 is 1500 yen, not 15.00."""
        self.assertEqual(brex.money_from_brex({"amount": 1500, "currency": "JPY"}),
                         (Decimal("1500"), "JPY"))

    def test_malformed_amounts_degrade_to_zero(self):
        self.assertEqual(brex.money_from_brex(None), (Decimal("0.00"), "USD"))
        self.assertEqual(brex.money_from_brex({"amount": "abc", "currency": "GBP"}),
                         (Decimal("0.00"), "GBP"))


class SyncTests(TestCase):
    def setUp(self):
        self.integration = Integration.objects.create(provider="BREX", is_enabled=True)
        self.integration.set_api_key("test-token")
        self.integration.save()
        self.subscription = make_subscription(name="Claude Pro", platform="Anthropic")
        self.today = timezone.localdate()

    def fake_pages(self, cards, transactions):
        def _paged(_integration, path, params=None):
            return (cards if "cards" in path else transactions), ""
        return mock.patch("core.brex._paged", side_effect=_paged)

    def card_payload(self):
        return [{
            "id": "card_1", "last_four": "4242", "card_name": "Ops card",
            "status": "ACTIVE",
            "owner": {"first_name": "Sam", "last_name": "Lee", "email": "sam@example.com"},
        }]

    def transaction_payload(self, **overrides):
        base = {
            "id": "txn_1",
            "card_id": "card_1",
            "description": "ANTHROPIC",
            "amount": {"amount": 2000, "currency": "USD"},
            "posted_at_date": self.today.isoformat(),
            "merchant": {"raw_descriptor": "ANTHROPIC, PBC"},
        }
        base.update(overrides)
        return [base]

    def test_a_full_sync_creates_cards_charges_and_links(self):
        with self.fake_pages(self.card_payload(), self.transaction_payload()):
            summary, error = brex.run_sync(self.integration)

        self.assertEqual(error, "")
        self.assertEqual(summary["cards"], 1)
        self.assertEqual(summary["charges"], 1)
        self.assertEqual(summary["matched"], 1)

        card = PaymentCard.objects.get()
        self.assertEqual(card.last_four, "4242")
        self.assertEqual(card.nickname, "Ops card")
        self.assertEqual(str(card), "Ops card •••• 4242")

        payment = SubscriptionPayment.objects.get()
        self.assertEqual(payment.amount, Decimal("20.00"))
        self.assertEqual(payment.subscription, self.subscription)
        self.assertEqual(payment.match_source, "AUTO")

        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.payment_card, card)
        self.assertEqual(self.subscription.billing_descriptor, "ANTHROPIC, PBC")

    def test_a_card_holder_is_matched_to_a_person_by_email(self):
        owner = create_user("sam@example.com", create_role("BREX_ROLE", view=True).slug)
        with self.fake_pages(self.card_payload(), []):
            brex.run_sync(self.integration)
        self.assertEqual(PaymentCard.objects.get().holder, owner)

    def test_resyncing_updates_rather_than_duplicating(self):
        with self.fake_pages(self.card_payload(), self.transaction_payload()):
            brex.run_sync(self.integration)
            brex.run_sync(self.integration)
        self.assertEqual(SubscriptionPayment.objects.count(), 1)
        self.assertEqual(PaymentCard.objects.count(), 1)

    def test_unmatched_spend_is_kept_visible_not_dropped(self):
        transactions = self.transaction_payload(
            id="txn_coffee", merchant={"raw_descriptor": "STARBUCKS 4412"}
        )
        with self.fake_pages(self.card_payload(), transactions):
            summary, _ = brex.run_sync(self.integration)

        self.assertEqual(summary["charges"], 1)
        self.assertEqual(summary["matched"], 0)
        payment = SubscriptionPayment.objects.get()
        self.assertIsNone(payment.subscription)
        self.assertEqual(payment.match_source, "NONE")

    def test_a_charge_without_a_date_is_skipped(self):
        transactions = self.transaction_payload(posted_at_date=None, posted_at=None,
                                                initiated_at_date=None)
        with self.fake_pages(self.card_payload(), transactions):
            summary, _ = brex.run_sync(self.integration)
        self.assertEqual(summary["charges"], 0)

    def test_a_disabled_integration_does_nothing(self):
        self.integration.is_enabled = False
        self.integration.save()
        summary, error = brex.run_sync(self.integration)
        self.assertIn("switched off", error)
        self.assertEqual(SubscriptionPayment.objects.count(), 0)

    def test_an_auth_failure_is_explained_and_recorded(self):
        with mock.patch("core.brex._paged", return_value=([], "Brex rejected the token (401). Generate a new one and paste it again.")):
            summary, error = brex.run_sync(self.integration)
        self.assertIn("401", error)
        self.integration.refresh_from_db()
        self.assertEqual(self.integration.last_status, "ERROR")

    def test_the_token_is_never_exposed_by_the_api(self):
        client = APIClient()
        superadmin = create_user("brex-super@example.com", "SUPERADMIN")
        client.force_authenticate(superadmin)
        response = client.get(reverse("integrations"))
        payload = str(response.data)
        self.assertNotIn("test-token", payload)
        brex_row = next(i for i in response.data["integrations"] if i["provider"] == "BREX")
        self.assertTrue(brex_row["has_api_key"])
        self.assertTrue(brex_row["supports_sync"])

    def test_the_management_command_skips_when_not_connected(self):
        Integration.objects.filter(provider="BREX").update(is_enabled=False)
        out = StringIO()
        call_command("sync_brex", stdout=out)
        self.assertIn("not connected", out.getvalue())

    def test_the_management_command_reports_its_results(self):
        with self.fake_pages(self.card_payload(), self.transaction_payload()):
            out = StringIO()
            call_command("sync_brex", stdout=out)
        self.assertIn("1 matched to subscriptions", out.getvalue())


class SubscriptionPayloadTests(TestCase):
    def test_the_detail_payload_exposes_the_card_and_charges(self):
        client = APIClient()
        manager = create_user(
            "brex-view@example.com",
            create_role("BREX_VIEW", view=True, add=True, edit=True).slug,
        )
        client.force_authenticate(manager)

        subscription = make_subscription(name="Claude Pro", platform="Anthropic")
        card = PaymentCard.objects.create(last_four="4242", nickname="Ops card")
        subscription.payment_card = card
        subscription.save(update_fields=["payment_card"])
        SubscriptionPayment.objects.create(
            external_id="txn_9", merchant="ANTHROPIC, PBC",
            amount=Decimal("20.00"), currency="USD",
            posted_at=timezone.localdate(), card=card, subscription=subscription,
            match_source="AUTO", match_score=0.95,
        )

        response = client.get(reverse("subscription-detail", args=[subscription.pk]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["payment_card_display"], "•••• 4242 (Ops card)")
        self.assertEqual(len(response.data["payments"]), 1)
        self.assertEqual(response.data["payments"][0]["card"], "•••• 4242")

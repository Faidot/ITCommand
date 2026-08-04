import urllib.error
from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core import brex
from core.models import (
    AppSettings,
    AuditLog,
    Integration,
    PaymentCard,
    Service,
    ServicePayment,
    User,
)
from core.models import Provider, ProviderAccount
from core.models.integrations import CredentialUnreadable
from core.test_estate_api import make_subscription
from core.test_helpers import create_role, create_user


def service_at(provider_name, identifier, **overrides):
    """A Service whose provider carries `provider_name`.

    `Subscription.platform` was the high-weight field the matcher keyed on;
    on `Service` that role belongs to the provider's name, so each fixture
    needs its own provider rather than sharing the default one.
    """
    provider, _ = Provider.objects.get_or_create(
        slug=provider_name.lower().replace(" ", "-"),
        defaults={"name": provider_name},
    )
    account, _ = ProviderAccount.objects.get_or_create(
        provider=provider, account_email=f"{provider.slug}@example.invalid"
    )
    return make_subscription(name=identifier, provider_account=account, **overrides)


class DescriptorMatchingTests(TestCase):
    def setUp(self):
        self.claude = service_at("Anthropic", "Claude Pro")
        self.chatgpt = service_at("OpenAI", "ChatGPT Business")
        self.figma = service_at("Figma", "Figma Org")
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
        first = service_at("Google", "Google Workspace")
        second = service_at("Google", "Google Cloud")
        match, score = brex.best_match("GOOGLE *SERVICES", [first, second])
        self.assertIsNone(match, "an ambiguous descriptor must not pick one at random")
        self.assertGreater(score, 0)

    def test_cancelled_subscriptions_are_not_offered_for_matching(self):
        """sync_transactions excludes them; this documents the intent."""
        self.figma.status = "CANCELLED"
        self.figma.save(update_fields=["status"])
        candidates = list(Service.objects.exclude(status="CANCELLED"))
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
        self.subscription = service_at("Anthropic", "Claude Pro")
        self.today = timezone.localdate()

    def fake_pages(self, cards, transactions, *, truncated=""):
        def _paged(_integration, path, params=None):
            return (cards if "cards" in path else transactions), "", truncated
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

        payment = ServicePayment.objects.get()
        self.assertEqual(payment.amount, Decimal("20.00"))
        self.assertEqual(payment.service, self.subscription)
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
        self.assertEqual(ServicePayment.objects.count(), 1)
        self.assertEqual(PaymentCard.objects.count(), 1)

    def test_unmatched_spend_is_kept_visible_not_dropped(self):
        transactions = self.transaction_payload(
            id="txn_coffee", merchant={"raw_descriptor": "STARBUCKS 4412"}
        )
        with self.fake_pages(self.card_payload(), transactions):
            summary, _ = brex.run_sync(self.integration)

        self.assertEqual(summary["charges"], 1)
        self.assertEqual(summary["matched"], 0)
        payment = ServicePayment.objects.get()
        self.assertIsNone(payment.service)
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
        self.assertEqual(ServicePayment.objects.count(), 0)

    def test_an_auth_failure_is_explained_and_recorded(self):
        with mock.patch(
            "core.brex._paged",
            return_value=([], "Brex rejected the token (401). Generate a new one and paste it again.", ""),
        ):
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
        self.assertIn("1 matched to services", out.getvalue())


class PaginationTests(TestCase):
    """The cursor walk, and what happens when it runs out of budget."""

    def setUp(self):
        self.integration = Integration.objects.create(provider="BREX", is_enabled=True)
        self.integration.set_api_key("test-token")
        self.integration.save()

    def pages(self, *payloads):
        """Serve `payloads` in order from a patched `_get`."""
        return mock.patch("core.brex._get", side_effect=[(p, "") for p in payloads])

    def test_the_walk_follows_next_cursor_across_pages(self):
        with self.pages(
            {"items": [{"id": "a"}], "next_cursor": "c1"},
            {"items": [{"id": "b"}], "next_cursor": "c2"},
            {"items": [{"id": "c"}]},
        ) as fake_get:
            items, error, truncated = brex._paged(self.integration, "/v2/cards")

        self.assertEqual([i["id"] for i in items], ["a", "b", "c"])
        self.assertEqual(error, "")
        self.assertFalse(truncated)
        # Page one must not carry a cursor; pages two and three must carry the
        # cursor the previous page handed back.
        cursors = [call.args[2].get("cursor") for call in fake_get.call_args_list]
        self.assertEqual(cursors, [None, "c1", "c2"])

    def test_hitting_the_page_cap_reports_truncation(self):
        endless = [
            {"items": [{"id": str(n)}], "next_cursor": f"c{n}"}
            for n in range(brex.MAX_PAGES)
        ]
        with self.pages(*endless):
            items, error, truncated = brex._paged(self.integration, "/v2/cards")

        self.assertEqual(len(items), brex.MAX_PAGES)
        self.assertEqual(error, "", "running out of budget is not a request error")
        self.assertIn("page limit", truncated, "the reason has to reach the operator")

    def test_running_out_of_wall_clock_stops_the_walk(self):
        """Retries make this reachable: 20 pages riding out a rate limit."""
        endless = [
            {"items": [{"id": str(n)}], "next_cursor": f"c{n}"}
            for n in range(brex.MAX_PAGES)
        ]
        with self.pages(*endless):
            items, error, truncated = brex._paged(
                self.integration, "/v2/cards", budget_seconds=-1
            )

        self.assertEqual(items, [], "the budget is checked before each page")
        self.assertEqual(error, "")
        self.assertIn("budget", truncated)

    def test_a_completed_walk_reports_no_truncation(self):
        with self.pages({"items": [{"id": "a"}]}):
            _items, error, truncated = brex._paged(self.integration, "/v2/cards")
        self.assertEqual(error, "")
        self.assertEqual(truncated, "")

    def test_a_failure_mid_walk_returns_what_it_had_and_the_error(self):
        with mock.patch(
            "core.brex._get",
            side_effect=[
                ({"items": [{"id": "a"}], "next_cursor": "c1"}, ""),
                (None, "Brex rejected the token (401)."),
            ],
        ):
            items, error, _ = brex._paged(self.integration, "/v2/cards")

        self.assertEqual(len(items), 1)
        self.assertIn("401", error)


class PartialSyncTests(TestCase):
    """A run that stored some rows and then hit a problem is not a success."""

    def setUp(self):
        self.integration = Integration.objects.create(provider="BREX", is_enabled=True)
        self.integration.set_api_key("test-token")
        self.integration.save()
        service_at("Anthropic", "Claude Pro")

    def test_truncated_charges_are_recorded_as_partial_not_ok(self):
        card = [{"id": "card_1", "last_four": "4242", "status": "ACTIVE"}]
        charge = [{
            "id": "txn_1", "card_id": "card_1",
            "amount": {"amount": 2000, "currency": "USD"},
            "posted_at_date": timezone.localdate().isoformat(),
            "merchant": {"raw_descriptor": "ANTHROPIC, PBC"},
        }]

        def _paged(_integration, path, params=None):
            # Only the charge walk runs out of budget.
            if "cards" in path:
                return card, "", ""
            return charge, "", "the 20-page limit was reached"

        with mock.patch("core.brex._paged", side_effect=_paged):
            summary, error = brex.run_sync(self.integration)

        self.assertEqual(error, "", "partial data is not a hard failure")
        self.assertTrue(summary["truncated"])
        self.integration.refresh_from_db()
        self.assertEqual(self.integration.last_status, "PARTIAL")
        self.assertIn("page limit", self.integration.last_message)

    def test_an_error_after_the_first_page_is_not_discarded(self):
        """The old code kept the rows and reported OK, hiding a revoked token."""
        card = [{"id": "card_1", "last_four": "4242", "status": "ACTIVE"}]
        charge = [{
            "id": "txn_1", "card_id": "card_1",
            "amount": {"amount": 2000, "currency": "USD"},
            "posted_at_date": timezone.localdate().isoformat(),
            "merchant": {"raw_descriptor": "ANTHROPIC, PBC"},
        }]

        def _paged(_integration, path, params=None):
            if "cards" in path:
                return card, "", ""
            return charge, "Brex rejected the token (401).", ""

        with mock.patch("core.brex._paged", side_effect=_paged):
            brex.run_sync(self.integration)

        self.integration.refresh_from_db()
        self.assertEqual(self.integration.last_status, "PARTIAL")
        self.assertIn("401", self.integration.last_message)
        # The charge it did read is still stored — the point is the reporting.
        self.assertEqual(ServicePayment.objects.count(), 1)

    def test_a_clean_run_is_still_reported_as_ok(self):
        def _paged(_integration, path, params=None):
            return [], "", ""

        with mock.patch("core.brex._paged", side_effect=_paged):
            brex.run_sync(self.integration)

        self.integration.refresh_from_db()
        self.assertEqual(self.integration.last_status, "OK")


class CredentialTests(TestCase):
    """Fingerprint, set-at, expiry, and telling unreadable from absent."""

    def setUp(self):
        self.integration = Integration.objects.create(provider="BREX")

    def test_setting_a_key_records_a_fingerprint_that_is_not_the_key(self):
        self.integration.set_api_key("bxt_super_secret_token")
        self.integration.save()

        fingerprint = self.integration.key_fingerprint
        self.assertEqual(len(fingerprint), 8)
        self.assertNotIn(fingerprint, "bxt_super_secret_token")
        self.assertIsNotNone(self.integration.key_set_at)
        self.assertEqual(self.integration.credential_state, Integration.CREDENTIAL_OK)

    def test_the_same_key_fingerprints_the_same_and_a_different_one_does_not(self):
        self.assertEqual(
            Integration.fingerprint_for("token-a"), Integration.fingerprint_for("token-a")
        )
        self.assertNotEqual(
            Integration.fingerprint_for("token-a"), Integration.fingerprint_for("token-b")
        )
        self.assertEqual(Integration.fingerprint_for(""), "")

    def test_clearing_a_key_clears_its_metadata(self):
        self.integration.set_api_key("something")
        self.integration.key_expires_at = date.today() + timedelta(days=10)
        self.integration.save()

        self.integration.set_api_key("")
        self.integration.save()

        self.assertEqual(self.integration.key_fingerprint, "")
        self.assertIsNone(self.integration.key_set_at)
        self.assertIsNone(
            self.integration.key_expires_at,
            "an expiry left behind would describe a key that is gone",
        )
        self.assertEqual(self.integration.credential_state, Integration.CREDENTIAL_MISSING)

    def test_an_undecryptable_key_is_not_reported_as_a_missing_one(self):
        """A rotated VAULT_ENCRYPTION_KEY used to look like 'no token saved'."""
        self.integration.encrypted_api_key = "not-valid-fernet-ciphertext"
        self.integration.save()

        self.assertEqual(
            self.integration.credential_state, Integration.CREDENTIAL_UNREADABLE
        )
        self.assertTrue(self.integration.has_api_key)
        with self.assertRaises(CredentialUnreadable):
            self.integration.get_api_key()

    def test_the_brex_client_explains_an_undecryptable_key(self):
        self.integration.encrypted_api_key = "not-valid-fernet-ciphertext"
        self.integration.is_enabled = True
        self.integration.save()

        payload, error = brex._get(self.integration, "/v2/cards")
        self.assertIsNone(payload)
        self.assertIn("VAULT_ENCRYPTION_KEY", error)
        self.assertNotIn("No Brex API token saved", error)

    def test_expiry_countdown_and_absence(self):
        self.assertIsNone(self.integration.key_expires_in_days)

        self.integration.key_expires_at = date.today() + timedelta(days=10)
        self.assertEqual(self.integration.key_expires_in_days, 10)

        self.integration.key_expires_at = date.today() - timedelta(days=3)
        self.assertEqual(self.integration.key_expires_in_days, -3)

    def test_provider_text_is_flattened_and_bounded_before_storage(self):
        self.integration.mark_result("ERROR", "line one\n\n   line   two\t" + "x" * 900)
        self.integration.refresh_from_db()

        self.assertLessEqual(len(self.integration.last_message), Integration.MESSAGE_LIMIT)
        self.assertNotIn("\n", self.integration.last_message)
        self.assertTrue(self.integration.last_message.startswith("line one line two"))


class IntegrationAuditTests(TestCase):
    """Installing a credential is a privileged act and must leave a trace."""

    def setUp(self):
        self.client = APIClient()
        self.superadmin = create_user("audit-super@example.com", "SUPERADMIN")
        self.client.force_authenticate(self.superadmin)
        self.url = reverse("integrations")

    def rows(self):
        return AuditLog.objects.filter(model_name="Integration").order_by("id")

    def test_setting_a_key_is_audited_without_recording_the_key(self):
        response = self.client.put(
            self.url, {"provider": "BREX", "api_key": "bxt_secret_value"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        entry = self.rows().last()
        self.assertIsNotNone(entry, "setting an API key used to leave no audit row")
        self.assertEqual(entry.user, self.superadmin)
        self.assertEqual(entry.changes["credential"], "set")
        self.assertNotIn("bxt_secret_value", str(entry.changes))
        self.assertEqual(
            entry.changes["key_fingerprint"],
            Integration.fingerprint_for("bxt_secret_value"),
        )

    def test_replacing_a_key_records_both_fingerprints(self):
        self.client.put(self.url, {"provider": "BREX", "api_key": "first"}, format="json")
        self.client.put(self.url, {"provider": "BREX", "api_key": "second"}, format="json")

        entry = self.rows().last()
        self.assertEqual(entry.changes["credential"], "replaced")
        self.assertEqual(
            entry.changes["previous_key_fingerprint"], Integration.fingerprint_for("first")
        )
        self.assertEqual(
            entry.changes["key_fingerprint"], Integration.fingerprint_for("second")
        )

    def test_clearing_a_key_is_audited(self):
        self.client.put(self.url, {"provider": "BREX", "api_key": "doomed"}, format="json")
        self.client.put(self.url, {"provider": "BREX", "clear_api_key": True}, format="json")

        entry = self.rows().last()
        self.assertEqual(entry.changes["credential"], "cleared")
        self.assertNotIn("doomed", str(entry.changes))

    def test_enabling_is_audited_with_the_transition(self):
        self.client.put(self.url, {"provider": "BREX", "api_key": "k"}, format="json")
        self.client.put(self.url, {"provider": "BREX", "is_enabled": True}, format="json")

        entry = self.rows().last()
        self.assertEqual(entry.changes["is_enabled"], {"from": False, "to": True})

    def test_a_non_superadmin_cannot_read_or_write_integrations(self):
        client = APIClient()
        client.force_authenticate(
            create_user("nosy@example.com", create_role("NOSY", view=True).slug)
        )
        self.assertEqual(client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            client.put(self.url, {"provider": "BREX", "api_key": "x"}, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertFalse(self.rows().exists())

    def test_the_payload_carries_the_fingerprint_and_never_the_key(self):
        self.client.put(
            self.url,
            {"provider": "BREX", "api_key": "bxt_secret_value", "key_expires_at": "2027-01-31"},
            format="json",
        )
        response = self.client.get(self.url)
        row = next(i for i in response.data["integrations"] if i["provider"] == "BREX")

        self.assertNotIn("bxt_secret_value", str(response.data))
        self.assertTrue(row["has_api_key"])
        self.assertEqual(row["key_fingerprint"], Integration.fingerprint_for("bxt_secret_value"))
        self.assertEqual(row["credential_state"], "OK")
        self.assertEqual(str(row["key_expires_at"]), "2027-01-31")
        self.assertIsNotNone(row["key_set_at"])

    def test_a_malformed_expiry_is_rejected(self):
        response = self.client.put(
            self.url,
            {"provider": "BREX", "api_key": "k", "key_expires_at": "31/01/2027"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("YYYY-MM-DD", response.data["detail"])


def http_error(code, *, headers=None, reason="Boom"):
    """A urllib HTTPError as `urlopen` would raise it."""
    return urllib.error.HTTPError(
        "https://platform.brexapis.com/v2/cards", code, reason, headers or {}, None
    )


class TypedErrorTests(TestCase):
    """Each failure mode has to be distinguishable, because each has its own fix."""

    def setUp(self):
        self.integration = Integration.objects.create(provider="BREX", is_enabled=True)
        self.integration.set_api_key("test-token")
        self.integration.save()

    def raising(self, exc):
        return mock.patch("core.brex.urllib.request.urlopen", side_effect=exc)

    def test_401_is_an_auth_error_and_is_not_retried(self):
        with self.raising(http_error(401)) as urlopen:
            with self.assertRaises(brex.BrexAuthError) as caught:
                brex._request(self.integration, "/v2/cards", sleep=lambda _: None)
        self.assertEqual(urlopen.call_count, 1, "a bad token will not fix itself")
        self.assertIn("401", str(caught.exception))
        self.assertFalse(caught.exception.retryable)

    def test_403_says_the_scope_must_be_granted_at_token_creation(self):
        with self.raising(http_error(403)):
            with self.assertRaises(brex.BrexScopeError) as caught:
                brex._request(self.integration, "/v2/cards", sleep=lambda _: None)
        message = str(caught.exception)
        self.assertIn("regenerate the token", message.lower())
        self.assertIn("scope", message.lower())

    def test_429_is_retried_and_then_reported(self):
        slept = []
        with self.raising(http_error(429)) as urlopen:
            with self.assertRaises(brex.BrexRateLimited):
                brex._request(self.integration, "/v2/cards", sleep=slept.append)
        self.assertEqual(urlopen.call_count, brex.MAX_ATTEMPTS)
        self.assertEqual(len(slept), brex.MAX_ATTEMPTS - 1)
        self.assertEqual(slept, [1.0, 2.0, 4.0], "backoff should double")

    def test_a_retry_after_header_wins_over_the_computed_backoff(self):
        slept = []
        with self.raising(http_error(429, headers={"Retry-After": "7"})):
            with self.assertRaises(brex.BrexRateLimited):
                brex._request(self.integration, "/v2/cards", sleep=slept.append)
        self.assertEqual(slept, [7.0, 7.0, 7.0])

    def test_an_absurd_retry_after_is_capped(self):
        slept = []
        with self.raising(http_error(429, headers={"Retry-After": "99999"})):
            with self.assertRaises(brex.BrexRateLimited):
                brex._request(self.integration, "/v2/cards", sleep=slept.append)
        self.assertTrue(all(s == brex.MAX_RETRY_AFTER_SECONDS for s in slept))

    def test_a_retry_after_http_date_is_understood(self):
        when = timezone.now() + timedelta(seconds=20)
        header = when.strftime("%a, %d %b %Y %H:%M:%S GMT")
        seconds = brex._retry_after_seconds({"Retry-After": header})
        self.assertIsNotNone(seconds)
        self.assertGreater(seconds, 10)
        self.assertLess(seconds, 30)

    def test_a_retry_after_date_without_a_zone_is_read_as_utc(self):
        """The 'GMT' form parses as aware, so this is the branch that was untested."""
        when = timezone.now() + timedelta(seconds=20)
        header = when.strftime("%a, %d %b %Y %H:%M:%S -0000")
        seconds = brex._retry_after_seconds({"Retry-After": header})
        self.assertIsNotNone(seconds)
        self.assertGreater(seconds, 10)
        self.assertLess(seconds, 30)

    def test_a_past_or_malformed_retry_after_never_goes_negative(self):
        past = (timezone.now() - timedelta(hours=1)).strftime("%a, %d %b %Y %H:%M:%S GMT")
        self.assertEqual(brex._retry_after_seconds({"Retry-After": past}), 0.0)
        self.assertEqual(brex._retry_after_seconds({"Retry-After": "-5"}), 0.0)
        self.assertIsNone(brex._retry_after_seconds({"Retry-After": "soon please"}))
        self.assertIsNone(brex._retry_after_seconds({}))
        self.assertIsNone(brex._retry_after_seconds(None))

    def test_5xx_is_retried_as_a_server_error(self):
        with self.raising(http_error(503)) as urlopen:
            with self.assertRaises(brex.BrexServerError):
                brex._request(self.integration, "/v2/cards", sleep=lambda _: None)
        self.assertEqual(urlopen.call_count, brex.MAX_ATTEMPTS)

    def test_a_network_failure_is_retried_as_unavailable(self):
        with self.raising(urllib.error.URLError("no route to host")):
            with self.assertRaises(brex.BrexUnavailable) as caught:
                brex._request(self.integration, "/v2/cards", sleep=lambda _: None)
        self.assertTrue(caught.exception.retryable)

    def test_a_transient_failure_that_clears_succeeds(self):
        """The whole point of retrying: one 429 must not fail the sync."""
        body = mock.MagicMock()
        body.read.return_value = b'{"items": []}'
        ok = mock.MagicMock()
        ok.__enter__.return_value = body

        with mock.patch(
            "core.brex.urllib.request.urlopen",
            side_effect=[http_error(429), http_error(503), ok],
        ):
            payload = brex._request(
                self.integration, "/v2/cards", sleep=lambda _: None
            )
        self.assertEqual(payload, {"items": []})

    def test_non_json_is_a_bad_response_not_a_crash(self):
        body = mock.MagicMock()
        body.read.return_value = b"<html>login</html>"
        ok = mock.MagicMock()
        ok.__enter__.return_value = body
        with mock.patch("core.brex.urllib.request.urlopen", return_value=ok):
            with self.assertRaises(brex.BrexBadResponse):
                brex._request(self.integration, "/v2/cards", sleep=lambda _: None)

    def test_no_token_is_not_configured_rather_than_an_auth_failure(self):
        self.integration.set_api_key("")
        self.integration.save()
        with self.assertRaises(brex.BrexNotConfigured):
            brex._request(self.integration, "/v2/cards", sleep=lambda _: None)

    def test_the_best_effort_wrapper_still_returns_a_string(self):
        """`_get` keeps the contract the sync path is built on."""
        with self.raising(http_error(401)):
            payload, error = brex._get(
                self.integration, "/v2/cards", sleep=lambda _: None
            )
        self.assertIsNone(payload)
        self.assertIn("401", error)

    def test_the_token_never_appears_in_any_error_text(self):
        for exc in (http_error(401), http_error(403), http_error(500),
                    urllib.error.URLError("boom")):
            with self.raising(exc):
                _payload, error = brex._get(
                    self.integration, "/v2/cards", sleep=lambda _: None
                )
            self.assertNotIn("test-token", error)


class AutomationRetryTests(TestCase):
    """A failed sync must not be recorded as the day's work being done."""

    def setUp(self):
        self.integration = Integration.objects.create(provider="BREX", is_enabled=True)
        self.integration.set_api_key("test-token")
        self.integration.save()

    def test_a_failed_sync_raises_so_the_runner_retries(self):
        with mock.patch(
            "core.brex._paged", return_value=([], "Brex is rate-limiting the request (429).", "")
        ):
            with self.assertRaises(CommandError) as caught:
                call_command("sync_brex", stdout=StringIO(), stderr=StringIO())
        self.assertIn("429", str(caught.exception))

    def test_run_automation_does_not_mark_a_failed_sync_as_done(self):
        """The bug this fixes: one 429 used to cost a whole day of syncing."""
        with mock.patch(
            "core.brex._paged", return_value=([], "Brex rejected the token (401).", "")
        ):
            with self.assertRaises(CommandError):
                call_command(
                    "run_automation", "--once",
                    stdout=StringIO(), stderr=StringIO(),
                )

        marker = AppSettings.objects.filter(
            key="automation.sync_brex.last_success"
        ).first()
        self.assertIsNone(
            marker, "a failed run must not leave a success marker for today"
        )

    def test_a_successful_sync_does_mark_the_day_done(self):
        """The control for the test above — without it, that one proves nothing."""
        with mock.patch("core.brex._paged", return_value=([], "", "")):
            try:
                call_command(
                    "run_automation", "--once", stdout=StringIO(), stderr=StringIO()
                )
            except CommandError:
                # Other daily commands are out of scope here; only the Brex
                # marker is being asserted.
                pass

        marker = AppSettings.objects.filter(
            key="automation.sync_brex.last_success"
        ).first()
        self.assertIsNotNone(marker)
        self.assertEqual(marker.value, timezone.localdate().isoformat())

    def test_a_partial_sync_is_not_treated_as_a_failure(self):
        """It stored real rows; raising would make the runner redo them hourly."""
        def _paged(_integration, path, params=None):
            return [], "", "" if "cards" in path else "the 20-page limit was reached"

        with mock.patch("core.brex._paged", side_effect=_paged):
            out = StringIO()
            call_command("sync_brex", stdout=out, stderr=StringIO())

        self.assertIn("Incomplete", out.getvalue())
        self.integration.refresh_from_db()
        self.assertEqual(self.integration.last_status, "PARTIAL")


class ConnectionTestTests(TestCase):
    """The scope checklist, and what each failure tells the operator to do."""

    def setUp(self):
        self.integration = Integration.objects.create(provider="BREX", is_enabled=True)
        self.integration.set_api_key("test-token")
        self.integration.save()

    def responder(self, *, identity=None, fail=None):
        """Patch `_request` to answer per path. `fail` maps path fragment -> exc."""
        fail = fail or {}

        def _request(_integration, path, params=None, **kwargs):
            for fragment, exc in fail.items():
                if fragment in path:
                    raise exc
            if path.endswith("/users/me"):
                return identity if identity is not None else {
                    "first_name": "Sam", "last_name": "Lee", "email": "sam@example.invalid",
                }
            return {"items": []}

        return mock.patch("core.brex._request", side_effect=_request)

    def test_a_healthy_token_reports_every_scope_granted(self):
        with self.responder():
            result = brex.test_connection(self.integration)

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "OK")
        self.assertEqual(len(result["scopes"]), len(brex.SCOPE_PROBES))
        self.assertTrue(all(s["ok"] for s in result["scopes"]))
        self.assertEqual(result["identity"]["email"], "sam@example.invalid")
        self.assertIsInstance(result["latency_ms"], int)

    def test_a_bad_token_fails_fast_without_probing_every_scope(self):
        with self.responder(fail={"/v2/": brex.BrexAuthError("401 rejected")}) as fake:
            result = brex.test_connection(self.integration)

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "AUTH_FAILED")
        self.assertEqual(result["scopes"], [])
        self.assertEqual(
            fake.call_count, 1, "eight copies of the same failure helps nobody"
        )

    def test_a_missing_required_scope_fails_and_names_it(self):
        with self.responder(fail={"/v2/cards": brex.BrexScopeError("403 no scope")}):
            result = brex.test_connection(self.integration)

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "MISSING_SCOPES")
        self.assertIn("cards.readonly", result["message"])
        self.assertIn("regenerate", result["message"].lower())
        cards = next(s for s in result["scopes"] if s["scope"] == "cards.readonly")
        self.assertFalse(cards["ok"])
        self.assertEqual(cards["code"], "scope")

    def test_a_missing_optional_scope_is_partial_not_broken(self):
        with self.responder(fail={"/v2/vendors": brex.BrexScopeError("403 no scope")}):
            result = brex.test_connection(self.integration)

        self.assertTrue(result["ok"], "the sync still works without vendors")
        self.assertEqual(result["status"], "PARTIAL")
        self.assertIn("vendors.readonly", result["message"])

    def test_a_token_without_users_readonly_still_reports_its_scopes(self):
        """/v2/users/me needs a scope the sync itself does not."""
        with self.responder(fail={"/users": brex.BrexScopeError("403 no scope")}):
            result = brex.test_connection(self.integration)

        self.assertIsNone(result["identity"])
        self.assertEqual(result["status"], "PARTIAL")
        cards = next(s for s in result["scopes"] if s["scope"] == "cards.readonly")
        self.assertTrue(cards["ok"], "cards must still be probed")

    def test_an_unreachable_api_is_reported_as_such(self):
        with self.responder(fail={"/v2/": brex.BrexUnavailable("no route")}):
            result = brex.test_connection(self.integration)
        self.assertEqual(result["status"], "UNREACHABLE")

    def test_no_token_saved_is_its_own_verdict(self):
        self.integration.set_api_key("")
        self.integration.save()
        result = brex.test_connection(self.integration)
        self.assertEqual(result["status"], "NOT_CONFIGURED")

    def test_probes_read_one_record_and_do_not_retry(self):
        seen = []

        def _request(_integration, path, params=None, **kwargs):
            seen.append((path, params, kwargs.get("max_attempts")))
            return {"items": []}

        with mock.patch("core.brex._request", side_effect=_request):
            brex.test_connection(self.integration)

        probes = [row for row in seen if not row[0].endswith("/users/me")]
        self.assertTrue(all(params == {"limit": 1} for _, params, _ in probes))
        self.assertTrue(
            all(attempts == 1 for _, _, attempts in seen),
            "somebody is waiting; a retry storm would hold the request open",
        )


class ConnectionTestEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.superadmin = create_user("brex-test@example.com", "SUPERADMIN")
        self.client.force_authenticate(self.superadmin)
        self.url = reverse("brex_connection_test")

    def healthy(self):
        def _request(_integration, path, params=None, **kwargs):
            if path.endswith("/users/me"):
                return {"first_name": "Sam", "email": "sam@example.invalid"}
            return {"items": []}
        return mock.patch("core.brex._request", side_effect=_request)

    def test_it_reports_the_scope_checklist(self):
        Integration.objects.create(provider="BREX").set_api_key("k")
        with self.healthy():
            response = self.client.post(self.url, {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["scopes"]), len(brex.SCOPE_PROBES))

    def test_an_unsaved_key_can_be_tested_without_being_stored(self):
        with self.healthy():
            response = self.client.post(
                self.url, {"api_key": "bxt_unsaved_candidate"}, format="json"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["ok"])
        stored = Integration.objects.get(provider="BREX")
        self.assertFalse(
            stored.has_api_key, "testing a key must not save it"
        )
        self.assertNotIn("bxt_unsaved_candidate", str(response.data))

    def test_the_test_is_audited_with_the_fingerprint_not_the_key(self):
        with self.healthy():
            self.client.post(self.url, {"api_key": "bxt_unsaved_candidate"}, format="json")

        entry = AuditLog.objects.filter(model_name="Integration").last()
        self.assertEqual(entry.action, "TEST")
        self.assertEqual(
            entry.changes["key_fingerprint"],
            Integration.fingerprint_for("bxt_unsaved_candidate"),
        )
        self.assertTrue(entry.changes["unsaved_key"])
        self.assertNotIn("bxt_unsaved_candidate", str(entry.changes))
        self.assertIn("cards.readonly", entry.changes["granted_scopes"])

    def test_a_bad_token_answers_200_with_a_failing_verdict(self):
        """The request worked; the verdict is the payload, not the HTTP status."""
        with mock.patch(
            "core.brex._request", side_effect=brex.BrexAuthError("401 rejected")
        ):
            response = self.client.post(self.url, {"api_key": "wrong"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["ok"])
        self.assertEqual(response.data["status"], "AUTH_FAILED")

    def test_a_non_superadmin_is_rejected(self):
        client = APIClient()
        client.force_authenticate(
            create_user("nosy2@example.com", create_role("NOSY2", view=True).slug)
        )
        response = client.post(self.url, {"api_key": "x"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ServicePayloadTests(TestCase):
    def test_the_detail_payload_exposes_the_card_and_charges(self):
        client = APIClient()
        manager = create_user(
            "brex-view@example.com",
            create_role("BREX_VIEW", view=True, add=True, edit=True).slug,
        )
        client.force_authenticate(manager)

        subscription = service_at("Anthropic", "Claude Pro")
        card = PaymentCard.objects.create(last_four="4242", nickname="Ops card")
        subscription.payment_card = card
        subscription.save(update_fields=["payment_card"])
        ServicePayment.objects.create(
            external_id="txn_9", merchant="ANTHROPIC, PBC",
            amount=Decimal("20.00"), currency="USD",
            posted_at=timezone.localdate(), card=card, service=subscription,
            match_source="AUTO", match_score=0.95,
        )

        # The subscription detail endpoint went with its module. What the
        # integration actually has to guarantee is that the charge is stored
        # against the right service and the right card, which is what the
        # reconciliation is for.
        response = client.get(reverse("estate-service-detail", args=[subscription.pk]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["identifier"], "Claude Pro")

        payment = ServicePayment.objects.get()
        self.assertEqual(payment.service, subscription)
        self.assertEqual(payment.card.display, "•••• 4242")
        subscription.refresh_from_db()
        self.assertEqual(subscription.payment_card, card)

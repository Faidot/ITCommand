"""Phase 4 tests: Master Settings for the Digital Estate.

Two things carry the weight here. First, that turning a layer off changes what
counts as a gap without ever hiding money already attached to it. Second, that
the exchange-rate surface actually closes the loop the Estate and Subscriptions
pages point at — "add one in Settings → Integrations" has to lead somewhere.
"""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core import estate, rbac
from core.models import (
    AppSettings,
    Property,
    EstateSettings,
    ExchangeRate,
    Integration,
    ListOfValues,
    Role,
    Subscription,
    Vendor,
    VendorContract,
)


User = get_user_model()

PASSWORD = "EstateSettingsTest!1"


def create_role(slug, *, view=False, add=False, edit=False, delete=False):
    permissions = rbac.blank_permissions()
    # Both keys, mirroring migration 0067 — see test_estate_api.create_role.
    permissions["estate"] = {
        "view": view,
        "add": add,
        "edit": edit,
        "delete": delete,
    }
    permissions["subscriptions"] = {
        "view": view,
        "add": add,
        "edit": edit,
        "delete": delete,
    }
    return Role.objects.create(
        slug=slug, name=slug.replace("_", " ").title(), permissions=permissions
    )


def create_user(email, role):
    return User.objects.create_user(
        email=email, password=PASSWORD, full_name=email.split("@")[0].title(), role=role
    )


#: Shared with test_estate_api so the two files cannot drift about what a
#: fixture service looks like. See that module for the kwarg aliases.
from core.test_estate_api import make_subscription  # noqa: E402


class SettingsTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        # SUPERADMIN is seeded by migration 0038 and bypasses the permission map
        # unconditionally, so it only needs a user, not a role row.
        create_role("ESTATE_MANAGER", view=True, add=True, edit=True)
        create_role("ESTATE_BLOCKED")
        cls.superadmin = create_user("root@example.com", "SUPERADMIN")
        cls.manager = create_user("manager@example.com", "ESTATE_MANAGER")
        cls.blocked = create_user("blocked@example.com", "ESTATE_BLOCKED")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.superadmin)


# ───────────────────────────── settings model ─────────────────────────────

class EstateSettingsModelTests(SettingsTestCase):
    def test_reading_settings_does_not_write_a_row(self):
        """A GET that inserts is a surprise and a race. It must stay a read."""
        self.assertEqual(EstateSettings.objects.count(), 0)

        settings = EstateSettings.get_solo()

        self.assertTrue(settings._state.adding, "get_solo() returned a saved row")
        self.assertEqual(settings.pk, 1, "the unsaved default must still target pk=1")
        self.assertEqual(EstateSettings.objects.count(), 0)
        # And reading it through the API is a read too.
        self.client.get(reverse("estate_settings"))
        self.assertEqual(EstateSettings.objects.count(), 0)

    def test_defaults_match_the_required_layer_set(self):
        self.assertEqual(
            EstateSettings.get_solo().tracked_layers(), list(estate.REQUIRED_LAYERS)
        )

    def test_tracked_layers_dedupes_and_drops_unknown_codes(self):
        settings = EstateSettings(enabled_layers=["DNS", "DNS", "NOT_A_LAYER", "TLS"])
        self.assertEqual(settings.tracked_layers(), ["DNS", "TLS"])

    def test_clearing_every_layer_falls_back_to_the_whole_catalog(self):
        # An estate page showing nothing is a worse answer than a noisy one.
        settings = EstateSettings(enabled_layers=[])
        self.assertEqual(settings.tracked_layers(), list(estate.SERVICE_LAYER_CODES))

    def test_configured_order_is_preserved(self):
        settings = EstateSettings(enabled_layers=["TLS", "REGISTRAR", "DNS"])
        self.assertEqual(settings.tracked_layers(), ["TLS", "REGISTRAR", "DNS"])


# ───────────────────────────── settings API ─────────────────────────────

class EstateSettingsApiTests(SettingsTestCase):
    def test_anyone_with_estate_view_can_read(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(reverse("estate_settings"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["renewal_warning_days"], 30)

    def test_a_role_without_estate_view_is_forbidden(self):
        self.client.force_authenticate(self.blocked)
        self.assertEqual(
            self.client.get(reverse("estate_settings")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_only_a_superadmin_can_write(self):
        self.client.force_authenticate(self.manager)
        response = self.client.put(
            reverse("estate_settings"), {"renewal_warning_days": 45}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_superadmin_can_write_and_it_persists(self):
        response = self.client.put(
            reverse("estate_settings"),
            {"renewal_warning_days": 45, "renewal_urgent_days": 10},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        saved = EstateSettings.objects.get(pk=1)
        self.assertEqual(saved.renewal_warning_days, 45)
        self.assertEqual(saved.updated_by_id, self.superadmin.id)

    def test_the_response_carries_the_full_catalog_for_the_editor(self):
        response = self.client.put(
            reverse("estate_settings"), {"enabled_layers": ["DNS"]}, format="json"
        )
        # The editor must be able to switch a layer back on, so every layer is
        # offered even when only one is tracked.
        self.assertEqual(len(response.data["all_layers"]), len(estate.SERVICE_LAYERS))
        tracked = [row for row in response.data["catalog"] if row["is_tracked"]]
        self.assertEqual([row["layer"] for row in tracked], ["DNS"])

    def test_unknown_layer_code_is_rejected(self):
        response = self.client.put(
            reverse("estate_settings"),
            {"enabled_layers": ["DNS", "TELEPATHY"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("enabled_layers", response.data)

    def test_duplicate_layers_are_collapsed_on_save(self):
        response = self.client.put(
            reverse("estate_settings"),
            {"enabled_layers": ["DNS", "dns", "TLS"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["enabled_layers"], ["DNS", "TLS"])

    def test_red_window_cannot_be_wider_than_amber(self):
        response = self.client.put(
            reverse("estate_settings"),
            {"renewal_warning_days": 7, "renewal_urgent_days": 30},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("renewal_urgent_days", response.data)


# ────────────────── settings actually change the reports ──────────────────

class SettingsDriveReportsTests(SettingsTestCase):
    def setUp(self):
        super().setUp()
        self.property = Property.objects.create(
            name="example.com", kind="CORPORATE"
        )

    def _overview(self):
        return self.client.get(reverse("estate_overview")).data

    def test_disabling_a_layer_removes_it_from_the_gap_count(self):
        before = self._overview()["kpis"]["stack_gap_count"]
        self.assertEqual(before, len(estate.REQUIRED_LAYERS))

        EstateSettings.objects.update_or_create(
            pk=1, defaults={"enabled_layers": ["REGISTRAR", "DNS"]}
        )
        after = self._overview()["kpis"]["stack_gap_count"]
        self.assertEqual(after, 2)

    def test_enabling_a_non_stack_type_does_not_make_its_absence_a_gap(self):
        """A deliberate behaviour change in Phase 3, and a capability removed.

        Until now, enabling any tracked type in Settings made its absence count
        as a gap, so an org could opt Monitoring into gap reporting. The Phase 1
        taxonomy split types into seven *stack roles* — the chain a request
        travels through — and non-stack types (SaaS, Storage, Monitoring,
        Other), with the latter excluded from gap calculations.

        Only something with a position in the chain can be missing from it.
        Keeping the old rule was not merely inconsistent: the shipped
        `EstateSettings` row lists all ten pre-rework codes, so every property
        rendered three permanent amber gaps that nobody could ever close.

        If Monitoring gap-tracking is wanted back, it is one line in
        `estate_reports.tracked_stack_types` plus a migration of the stored
        `enabled_layers` — but it is a product decision, not an accident.
        """
        EstateSettings.objects.update_or_create(
            pk=1, defaults={"enabled_layers": ["REGISTRAR", "MONITORING"]}
        )
        gaps = self.client.get(reverse("estate_gaps")).data
        missing = gaps["properties_with_gaps"][0]["missing_layers"]
        self.assertNotIn("MONITORING", missing)
        self.assertEqual(missing, ["REGISTRAR"])

    def test_widening_the_warning_window_changes_the_at_risk_count(self):
        today = timezone.localdate()
        make_subscription(
            name="in 40 days", auto_renew=False, expiry_date=today + timedelta(days=40)
        )
        self.assertEqual(self._overview()["kpis"]["at_risk_count"], 0)

        EstateSettings.objects.update_or_create(
            pk=1, defaults={"renewal_warning_days": 60}
        )
        overview = self._overview()
        self.assertEqual(overview["kpis"]["at_risk_count"], 1)
        # The row must agree with the count that included it.
        self.assertTrue(overview["at_risk_services"][0]["is_at_risk"])

    def test_urgency_follows_the_configured_red_window(self):
        today = timezone.localdate()
        make_subscription(name="in 10 days", expiry_date=today + timedelta(days=10))
        self.assertEqual(
            self._overview()["renewal_timeline"][0]["urgency"], "warning"
        )

        EstateSettings.objects.update_or_create(
            pk=1, defaults={"renewal_urgent_days": 14}
        )
        self.assertEqual(
            self._overview()["renewal_timeline"][0]["urgency"], "critical"
        )

    def test_thresholds_in_the_response_are_the_configured_ones(self):
        EstateSettings.objects.update_or_create(
            pk=1,
            defaults={
                "renewal_warning_days": 45,
                "renewal_urgent_days": 5,
                "timeline_window_days": 120,
            },
        )
        thresholds = self._overview()["thresholds"]
        self.assertEqual(thresholds["at_risk_window_days"], 45)
        self.assertEqual(thresholds["urgent_window_days"], 5)
        self.assertEqual(thresholds["timeline_window_days"], 120)

    def test_layer_order_in_settings_drives_the_reported_order(self):
        EstateSettings.objects.update_or_create(
            pk=1, defaults={"enabled_layers": ["TLS", "DNS", "REGISTRAR"]}
        )
        layers = [row["layer"] for row in self._overview()["layers"]]
        self.assertEqual(layers[:3], ["TLS", "DNS", "REGISTRAR"])


# ───────────────────────── property kinds via LOV ─────────────────────────

class PropertyKindLovTests(SettingsTestCase):
    def test_the_group_is_registered_and_seeds_from_the_taxonomy(self):
        from core.lov import GROUPS, seed_values

        self.assertIn("estate_property_kind", GROUPS)
        self.assertTrue(GROUPS["estate_property_kind"].extendable)
        self.assertEqual(
            [code for code, _ in seed_values("estate_property_kind")],
            [code for code, _ in estate.PROPERTY_KINDS],
        )

    def test_a_built_in_kind_is_accepted(self):
        response = self.client.post(
            reverse("estate-property-list"),
            {"name": "game.gg", "kind": "MOBILE_GAME"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_an_admin_added_kind_is_accepted(self):
        """The point of moving this behind the LOV: a new kind works at once."""
        ListOfValues.objects.create(
            group="estate_property_kind", code="PODCAST", label="Podcast", sort_order=99
        )
        response = self.client.post(
            reverse("estate-property-list"),
            {"name": "show.fm", "kind": "PODCAST"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["kind"], "PODCAST")

    def test_an_unknown_kind_is_rejected_with_a_useful_message(self):
        response = self.client.post(
            reverse("estate-property-list"),
            {"name": "mystery.io", "kind": "NONSENSE"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("kind", response.data)

    def test_a_retired_kind_is_no_longer_offered(self):
        ListOfValues.objects.create(
            group="estate_property_kind", code="PODCAST", label="Podcast", is_active=False
        )
        # Deactivating one value materialises the group, so the built-ins are
        # rows now too; PODCAST itself must be refused.
        response = self.client.post(
            reverse("estate-property-list"),
            {"name": "show.fm", "kind": "PODCAST"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


# ───────────────────────────── exchange rates ─────────────────────────────

class ExchangeRateApiTests(SettingsTestCase):
    def setUp(self):
        super().setUp()
        AppSettings.objects.update_or_create(
            key="default_currency", defaults={"value": "PKR"}
        )

    def test_only_a_superadmin_can_reach_it(self):
        for user in (self.manager, self.blocked):
            self.client.force_authenticate(user)
            self.assertEqual(
                self.client.get(reverse("exchange-rate-list")).status_code,
                status.HTTP_403_FORBIDDEN,
            )

    def test_status_lists_currencies_in_use_and_which_are_missing(self):
        make_subscription(name="pkr", currency="PKR", cost=Decimal("1200.00"))
        make_subscription(name="usd", currency="USD", cost=Decimal("500.00"))

        response = self.client.get(reverse("exchange-rate-status"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["base_currency"], "PKR")
        self.assertFalse(response.data["is_complete"])
        self.assertEqual(response.data["missing_currencies"], ["USD"])

        by_currency = {row["currency"]: row for row in response.data["currencies"]}
        self.assertTrue(by_currency["PKR"]["has_rate"])
        self.assertTrue(by_currency["PKR"]["is_base"])
        self.assertFalse(by_currency["USD"]["has_rate"])
        # What the gap is worth, so the admin knows if it matters.
        self.assertEqual(by_currency["USD"]["monthly_spend"], "500.00")
        self.assertEqual(by_currency["USD"]["subscription_count"], 1)

    def test_vendor_contract_currencies_count_as_in_use(self):
        vendor = Vendor.objects.create(name="Acme")
        VendorContract.objects.create(vendor=vendor, title="Support", currency="EUR")
        response = self.client.get(reverse("exchange-rate-status"))
        by_currency = {row["currency"]: row for row in response.data["currencies"]}
        self.assertIn("EUR", by_currency)
        self.assertEqual(by_currency["EUR"]["contract_count"], 1)

    def test_setting_a_rate_closes_the_gap(self):
        make_subscription(name="usd", currency="USD", cost=Decimal("500.00"))
        self.assertFalse(self.client.get(reverse("exchange-rate-status")).data["is_complete"])

        response = self.client.post(
            reverse("exchange-rate-list"),
            {"base_currency": "PKR", "currency": "USD", "rate": "280.0"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(self.client.get(reverse("exchange-rate-status")).data["is_complete"])

    def test_the_estate_total_becomes_complete_once_a_rate_is_added(self):
        """The whole point: the page that reported the gap now adds up."""
        make_subscription(name="pkr", currency="PKR", cost=Decimal("100.00"))
        make_subscription(name="usd", currency="USD", cost=Decimal("500.00"))
        self.assertFalse(
            self.client.get(reverse("estate_overview")).data["total_spend"]["is_complete"]
        )

        self.client.post(
            reverse("exchange-rate-list"),
            {"base_currency": "PKR", "currency": "USD", "rate": "280.0"},
            format="json",
        )
        spend = self.client.get(reverse("estate_overview")).data["total_spend"]
        self.assertTrue(spend["is_complete"])
        self.assertEqual(spend["monthly"], "140100.00")

    def test_a_second_rate_for_the_same_day_updates_rather_than_duplicating(self):
        payload = {"base_currency": "PKR", "currency": "USD", "rate": "280.0"}
        self.client.post(reverse("exchange-rate-list"), payload, format="json")
        self.client.post(
            reverse("exchange-rate-list"), {**payload, "rate": "290.0"}, format="json"
        )
        rates = ExchangeRate.objects.filter(base_currency="PKR", currency="USD")
        self.assertEqual(rates.count(), 1)
        self.assertEqual(rates.first().rate, Decimal("290.0000000000"))

    def test_a_manual_rate_is_marked_manual_not_api(self):
        self.client.post(
            reverse("exchange-rate-list"),
            {"base_currency": "PKR", "currency": "USD", "rate": "280.0"},
            format="json",
        )
        self.assertEqual(ExchangeRate.objects.first().source, "MANUAL")

    def test_as_of_defaults_to_today(self):
        self.client.post(
            reverse("exchange-rate-list"),
            {"base_currency": "PKR", "currency": "USD", "rate": "280.0"},
            format="json",
        )
        self.assertEqual(ExchangeRate.objects.first().as_of, timezone.localdate())

    def test_a_self_referential_rate_is_rejected(self):
        response = self.client.post(
            reverse("exchange-rate-list"),
            {"base_currency": "PKR", "currency": "PKR", "rate": "1.0"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_non_positive_rate_is_rejected(self):
        response = self.client.post(
            reverse("exchange-rate-list"),
            {"base_currency": "PKR", "currency": "USD", "rate": "0"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_rate_can_be_deleted(self):
        self.client.post(
            reverse("exchange-rate-list"),
            {"base_currency": "PKR", "currency": "USD", "rate": "280.0"},
            format="json",
        )
        rate = ExchangeRate.objects.first()
        response = self.client.delete(reverse("exchange-rate-detail", args=[rate.pk]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(ExchangeRate.objects.count(), 0)


# ─────────────────── discovery integrations are config-only ───────────────────

class DiscoveryIntegrationTests(SettingsTestCase):
    def test_both_discovery_providers_are_offered(self):
        response = self.client.get(reverse("integrations"))
        providers = {row["provider"]: row for row in response.data["integrations"]}
        self.assertIn("AWS_DISCOVERY", providers)
        self.assertIn("CLOUDFLARE_DISCOVERY", providers)

    def test_they_are_flagged_config_only_so_the_ui_can_say_so(self):
        response = self.client.get(reverse("integrations"))
        providers = {row["provider"]: row for row in response.data["integrations"]}
        self.assertTrue(providers["AWS_DISCOVERY"]["config_only"])
        self.assertFalse(providers["AWS_DISCOVERY"]["supports_sync"])

    def test_the_key_is_encrypted_at_rest_and_never_returned(self):
        secret = "AKIA-not-a-real-key-0000"
        response = self.client.put(
            reverse("integrations"),
            {"provider": "AWS_DISCOVERY", "api_key": secret},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["has_api_key"])
        self.assertNotIn(secret, response.content.decode())

        stored = Integration.objects.get(provider="AWS_DISCOVERY")
        self.assertNotIn(secret, stored.encrypted_api_key)
        self.assertNotEqual(stored.encrypted_api_key, secret)
        # Round-trips through the same Fernet path the vault uses.
        self.assertEqual(stored.get_api_key(), secret)

    def test_running_them_is_refused_because_there_is_no_sync(self):
        """Config only. An endpoint that pretends to sync would be a lie."""
        Integration.objects.create(provider="AWS_DISCOVERY")
        response = self.client.post(
            reverse("integration_test"), {"provider": "AWS_DISCOVERY"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_they_are_never_contacted_by_the_alert_broadcaster(self):
        from core.models import Integration as IntegrationModel

        self.assertNotIn("AWS_DISCOVERY", IntegrationModel.CHAT_PROVIDERS)
        self.assertNotIn("CLOUDFLARE_DISCOVERY", IntegrationModel.CHAT_PROVIDERS)

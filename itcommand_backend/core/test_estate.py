"""Phase 1 tests: the Digital Estate data model.

Scope is deliberately the model layer — the API surface lands in Phase 2. What
is proved here is the part that is expensive to get wrong later: that money
stays Decimal, that orphan and at-risk detection are right *at the boundaries*,
and that the seed command can be run twice.
"""

from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from io import StringIO

from core import estate
from core.models import (
    DigitalProperty,
    Provider,
    ProviderAccount,
    Subscription,
)


User = get_user_model()


def make_subscription(**overrides):
    today = timezone.localdate()
    fields = {
        "name": "Test service",
        "platform": "Test platform",
        "cost": Decimal("100.00"),
        "currency": "USD",
        "billing_cycle": "MONTHLY",
        "start_date": today - timedelta(days=30),
        "expiry_date": today + timedelta(days=365),
        "status": "ACTIVE",
        "auto_renew": False,
    }
    fields.update(overrides)
    return Subscription.objects.create(**fields)


class ServiceLayerTaxonomyTests(TestCase):
    """The layer order is the contract the frontend reads. Pin it."""

    def test_layers_are_in_stack_order_not_alphabetical(self):
        codes = [code for code, _ in estate.SERVICE_LAYERS]
        self.assertEqual(codes[0], "REGISTRAR")
        self.assertEqual(codes[1], "DNS")
        self.assertEqual(codes[2], "HOSTING")
        self.assertEqual(codes[-1], "OTHER")
        self.assertNotEqual(codes, sorted(codes))

    def test_every_layer_code_is_unique(self):
        codes = [code for code, _ in estate.SERVICE_LAYERS]
        self.assertEqual(len(codes), len(set(codes)))

    def test_required_layers_are_a_subset_that_excludes_the_catch_all(self):
        codes = set(estate.SERVICE_LAYER_CODES)
        self.assertTrue(set(estate.REQUIRED_LAYERS).issubset(codes))
        self.assertNotIn("OTHER", estate.REQUIRED_LAYERS)

    def test_sort_key_puts_unknown_codes_last(self):
        self.assertLess(estate.sort_key("REGISTRAR"), estate.sort_key("OTHER"))
        self.assertGreaterEqual(
            estate.sort_key("NOT_A_LAYER"), estate.sort_key("OTHER")
        )

    def test_mfa_severity_never_renders_a_missing_factor_as_neutral(self):
        self.assertEqual(estate.mfa_severity("NONE"), "critical")
        self.assertEqual(estate.mfa_severity("SMS"), "warning")
        self.assertEqual(estate.mfa_severity("APP"), "ok")
        self.assertEqual(estate.mfa_severity("KEY"), "ok")
        self.assertEqual(estate.mfa_severity("UNKNOWN"), "muted")


class MonthlyEquivalentTests(TestCase):
    """`monthly_cost` *is* the monthly equivalent. It must stay Decimal."""

    def test_monthly_cycle_returns_cost_unchanged_as_decimal(self):
        subscription = make_subscription(cost=Decimal("500.00"), billing_cycle="MONTHLY")
        self.assertEqual(subscription.monthly_cost, Decimal("500.00"))
        self.assertIsInstance(subscription.monthly_cost, Decimal)
        self.assertNotIsInstance(subscription.monthly_cost, float)

    def test_yearly_cycle_divides_by_twelve_as_decimal(self):
        subscription = make_subscription(cost=Decimal("1200.00"), billing_cycle="YEARLY")
        self.assertEqual(subscription.monthly_cost, Decimal("100.00"))
        self.assertIsInstance(subscription.monthly_cost, Decimal)

    def test_annual_equivalent_for_both_cycles(self):
        monthly = make_subscription(cost=Decimal("100.00"), billing_cycle="MONTHLY")
        yearly = make_subscription(
            name="Yearly", cost=Decimal("1200.00"), billing_cycle="YEARLY"
        )
        self.assertEqual(monthly.annual_cost, Decimal("1200.00"))
        self.assertEqual(yearly.annual_cost, Decimal("1200.00"))

    def test_recurring_third_is_quantised_once_and_does_not_drift(self):
        # 100/12 is non-terminating. The rounded property must be 2dp, while the
        # unrounded one keeps full precision for aggregation.
        subscription = make_subscription(cost=Decimal("100.00"), billing_cycle="YEARLY")
        self.assertEqual(subscription.monthly_cost, Decimal("8.33"))
        self.assertEqual(subscription.monthly_cost.as_tuple().exponent, -2)
        self.assertGreater(
            subscription.monthly_cost_unrounded, subscription.monthly_cost
        )

    def test_summing_unrounded_avoids_the_error_that_summing_rounded_introduces(self):
        # Twelve yearly-billed services at 100 each is 100/month in total.
        # Rounding each to 8.33 before summing loses 4 paisa; summing the
        # unrounded property and quantising once is accurate to 26 decimal
        # places. Aggregation must therefore use monthly_cost_unrounded.
        subs = [
            make_subscription(
                name=f"S{i}", cost=Decimal("100.00"), billing_cycle="YEARLY"
            )
            for i in range(12)
        ]
        target = Decimal("100")
        rounded_total = sum(s.monthly_cost for s in subs)
        unrounded_total = sum(s.monthly_cost_unrounded for s in subs)

        self.assertEqual(rounded_total, Decimal("99.96"))
        self.assertEqual(abs(target - rounded_total), Decimal("0.04"))
        # Not exact — Decimal division is bounded by context precision — but off
        # by ~1e-26 rather than 4e-2, and it quantises back to the right answer.
        self.assertLess(abs(target - unrounded_total), Decimal("0.0000001"))
        self.assertEqual(unrounded_total.quantize(Decimal("0.01")), target)


class OrphanDetectionTests(TestCase):
    def test_subscription_with_no_property_is_an_orphan(self):
        self.assertTrue(make_subscription().is_orphan)

    def test_subscription_bound_to_a_property_is_not_an_orphan(self):
        prop = DigitalProperty.objects.create(name="example.com", kind="CORPORATE")
        self.assertFalse(make_subscription(digital_property=prop).is_orphan)

    def test_orphan_check_does_not_need_the_related_row_loaded(self):
        prop = DigitalProperty.objects.create(name="example.com", kind="CORPORATE")
        make_subscription(digital_property=prop)
        fetched = Subscription.objects.only("id", "digital_property").first()
        with self.assertNumQueries(0):
            self.assertFalse(fetched.is_orphan)

    def test_property_deletion_orphans_rather_than_deletes_the_subscription(self):
        prop = DigitalProperty.objects.create(name="example.com", kind="CORPORATE")
        subscription = make_subscription(digital_property=prop)
        prop.delete()
        subscription.refresh_from_db()
        self.assertTrue(subscription.is_orphan)
        self.assertTrue(Subscription.objects.filter(pk=subscription.pk).exists())


class AtRiskBoundaryTests(TestCase):
    """The window is inclusive at both ends and forward-looking only."""

    def setUp(self):
        self.today = timezone.localdate()

    def _expiring_in(self, days, **overrides):
        return make_subscription(
            start_date=self.today - timedelta(days=400),
            expiry_date=self.today + timedelta(days=days),
            **overrides,
        )

    def test_auto_renew_on_is_never_at_risk_however_close(self):
        self.assertFalse(self._expiring_in(1, auto_renew=True).is_at_risk)

    def test_exactly_at_the_window_edge_is_at_risk(self):
        subscription = self._expiring_in(estate.AT_RISK_WINDOW_DAYS)
        self.assertTrue(subscription.is_at_risk)

    def test_one_day_past_the_window_is_not_at_risk(self):
        subscription = self._expiring_in(estate.AT_RISK_WINDOW_DAYS + 1)
        self.assertFalse(subscription.is_at_risk)

    def test_expiring_today_is_at_risk(self):
        self.assertTrue(self._expiring_in(0).is_at_risk)

    def test_already_expired_is_not_at_risk_it_is_a_different_problem(self):
        subscription = self._expiring_in(-1)
        self.assertEqual(subscription.effective_status, "EXPIRED")
        self.assertFalse(subscription.is_at_risk)

    def test_cancelled_subscription_is_not_at_risk(self):
        self.assertFalse(self._expiring_in(5, status="CANCELLED").is_at_risk)

    def test_paused_subscription_is_not_at_risk(self):
        self.assertFalse(self._expiring_in(5, status="PAUSED").is_at_risk)

    def test_not_yet_started_subscription_is_not_at_risk(self):
        subscription = make_subscription(
            start_date=self.today + timedelta(days=10),
            expiry_date=self.today + timedelta(days=20),
        )
        self.assertEqual(subscription.effective_status, "SCHEDULED")
        self.assertFalse(subscription.is_at_risk)


class ServiceLayerNormalisationTests(TestCase):
    def test_blank_layer_is_stored_as_null_not_empty_string(self):
        subscription = make_subscription(service_layer="")
        subscription.refresh_from_db()
        self.assertIsNone(subscription.service_layer)

    def test_a_real_layer_survives_the_round_trip(self):
        subscription = make_subscription(service_layer="REGISTRAR")
        subscription.refresh_from_db()
        self.assertEqual(subscription.service_layer, "REGISTRAR")

    def test_null_layers_are_findable_with_a_single_isnull_filter(self):
        make_subscription(name="A", service_layer="")
        make_subscription(name="B", service_layer=None)
        make_subscription(name="C", service_layer="DNS")
        self.assertEqual(Subscription.objects.filter(service_layer__isnull=True).count(), 2)


class ProviderTests(TestCase):
    def test_logo_initial_defaults_to_the_first_letter_of_the_name(self):
        provider = Provider.objects.create(name="Cloudflare", slug="cloudflare")
        self.assertEqual(provider.logo_initial, "C")

    def test_an_explicit_logo_initial_is_kept(self):
        provider = Provider.objects.create(
            name="DigitalOcean", slug="digitalocean", logo_initial="DO"
        )
        self.assertEqual(provider.logo_initial, "DO")

    def test_brand_colour_must_be_hex(self):
        provider = Provider(name="Bad", slug="bad", brand_color="orange")
        with self.assertRaises(ValidationError):
            provider.full_clean()

    def test_slug_is_unique(self):
        Provider.objects.create(name="AWS", slug="aws")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Provider.objects.create(name="Amazon Web Services", slug="aws")


class ProviderAccountTests(TestCase):
    def setUp(self):
        self.provider = Provider.objects.create(
            name="AWS", slug="aws", console_url="https://console.aws.amazon.com"
        )

    def test_console_url_falls_back_to_the_provider(self):
        account = ProviderAccount.objects.create(
            provider=self.provider, login_email="root@example.com"
        )
        self.assertEqual(
            account.effective_console_url, "https://console.aws.amazon.com"
        )

    def test_account_console_url_overrides_the_provider(self):
        account = ProviderAccount.objects.create(
            provider=self.provider,
            login_email="tenant@example.com",
            console_url="https://tenant.example.awsapps.com",
        )
        self.assertEqual(
            account.effective_console_url, "https://tenant.example.awsapps.com"
        )

    def test_mfa_defaults_to_unknown_not_none(self):
        # "Nobody has checked" must not be reported as "confirmed insecure".
        account = ProviderAccount.objects.create(
            provider=self.provider, login_email="root@example.com"
        )
        self.assertEqual(account.mfa_method, "UNKNOWN")
        self.assertEqual(account.mfa_severity, "muted")
        self.assertFalse(account.has_mfa)

    def test_account_with_no_mfa_is_critical(self):
        account = ProviderAccount.objects.create(
            provider=self.provider, login_email="legacy@example.com", mfa_method="NONE"
        )
        self.assertEqual(account.mfa_severity, "critical")
        self.assertFalse(account.has_mfa)

    def test_same_login_cannot_be_registered_twice_at_one_provider(self):
        ProviderAccount.objects.create(
            provider=self.provider, login_email="root@example.com"
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProviderAccount.objects.create(
                provider=self.provider, login_email="root@example.com"
            )

    def test_same_login_is_allowed_at_a_different_provider(self):
        other = Provider.objects.create(name="Cloudflare", slug="cloudflare")
        ProviderAccount.objects.create(
            provider=self.provider, login_email="ops@example.com"
        )
        ProviderAccount.objects.create(provider=other, login_email="ops@example.com")
        self.assertEqual(ProviderAccount.objects.count(), 2)

    def test_deleting_a_provider_that_still_has_accounts_is_blocked(self):
        ProviderAccount.objects.create(
            provider=self.provider, login_email="root@example.com"
        )
        from django.db.models import ProtectedError

        with self.assertRaises(ProtectedError):
            self.provider.delete()

    def test_deactivating_a_user_leaves_the_account_owned_but_unassigned(self):
        owner = User.objects.create_user(
            email="owner@example.com", password="EstateTestPassword!1", full_name="Owner"
        )
        account = ProviderAccount.objects.create(
            provider=self.provider, login_email="root@example.com", owner=owner
        )
        owner.delete()
        account.refresh_from_db()
        self.assertIsNone(account.owner_id)


class DigitalPropertyTests(TestCase):
    def test_name_is_normalised_to_lowercase(self):
        prop = DigitalProperty.objects.create(name="  Example.COM  ", kind="CORPORATE")
        self.assertEqual(prop.name, "example.com")

    def test_name_is_unique_after_normalisation(self):
        DigitalProperty.objects.create(name="example.com", kind="CORPORATE")
        with self.assertRaises(IntegrityError), transaction.atomic():
            DigitalProperty.objects.create(name="EXAMPLE.COM", kind="MARKETING")

    def test_subscriptions_reverse_accessor_is_named_for_the_property(self):
        prop = DigitalProperty.objects.create(name="example.com", kind="CORPORATE")
        make_subscription(digital_property=prop)
        self.assertEqual(prop.subscriptions.count(), 1)


class SeedEstateCommandTests(TestCase):
    def _run(self, *args):
        out = StringIO()
        call_command("seed_estate", *args, stdout=out)
        return out.getvalue()

    def test_seeds_the_catalog(self):
        self._run()
        self.assertEqual(Provider.objects.count(), 10)
        self.assertTrue(Provider.objects.filter(slug="cloudflare").exists())

    def test_is_idempotent(self):
        self._run()
        self._run()
        self.assertEqual(Provider.objects.count(), 10)

    def test_creates_no_accounts_properties_or_services(self):
        self._run()
        self.assertEqual(ProviderAccount.objects.count(), 0)
        self.assertEqual(DigitalProperty.objects.count(), 0)
        self.assertEqual(Subscription.objects.count(), 0)

    def test_local_edits_survive_a_re_run(self):
        self._run()
        Provider.objects.filter(slug="aws").update(brand_color="#123456")
        self._run()
        self.assertEqual(Provider.objects.get(slug="aws").brand_color, "#123456")

    def test_refresh_resets_branding_to_the_defaults(self):
        self._run()
        Provider.objects.filter(slug="aws").update(brand_color="#123456")
        self._run("--refresh")
        self.assertEqual(Provider.objects.get(slug="aws").brand_color, "#ff9900")

    def test_refresh_does_not_reactivate_a_deliberately_disabled_provider(self):
        self._run()
        Provider.objects.filter(slug="vercel").update(is_active=False)
        self._run("--refresh")
        self.assertFalse(Provider.objects.get(slug="vercel").is_active)

    def test_seeded_providers_all_have_a_valid_hex_colour(self):
        self._run()
        for provider in Provider.objects.all():
            provider.full_clean()

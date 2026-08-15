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
    Property,
    Provider,
    ProviderAccount,
    Service,
)


User = get_user_model()


# `make_subscription` and four classes that used it were removed in Phase 5.
# They exercised the estate fields bolted onto `Subscription` in Phase 1 —
# monthly equivalents, orphan detection, at-risk boundaries, layer
# normalisation. `Service` owns all of that now, and `test_estate_service.py`
# tests it there, against a model that still exists.


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
        self.assertEqual(estate.mfa_severity("SECURITY_KEY"), "ok")
        self.assertEqual(estate.mfa_severity("UNKNOWN"), "muted")


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
            provider=self.provider, account_email="root@example.com"
        )
        self.assertEqual(
            account.effective_console_url, "https://console.aws.amazon.com"
        )

    def test_account_console_url_overrides_the_provider(self):
        account = ProviderAccount.objects.create(
            provider=self.provider,
            account_email="tenant@example.com",
            console_url="https://tenant.example.awsapps.com",
        )
        self.assertEqual(
            account.effective_console_url, "https://tenant.example.awsapps.com"
        )

    def test_mfa_defaults_to_unknown_not_none(self):
        # "Nobody has checked" must not be reported as "confirmed insecure".
        account = ProviderAccount.objects.create(
            provider=self.provider, account_email="root@example.com"
        )
        self.assertEqual(account.mfa_type, "UNKNOWN")
        self.assertEqual(account.mfa_severity, "muted")
        self.assertFalse(account.has_mfa)

    def test_account_with_no_mfa_is_critical(self):
        account = ProviderAccount.objects.create(
            provider=self.provider, account_email="legacy@example.com", mfa_type="NONE"
        )
        self.assertEqual(account.mfa_severity, "critical")
        self.assertFalse(account.has_mfa)

    def test_same_login_cannot_be_registered_twice_at_one_provider(self):
        ProviderAccount.objects.create(
            provider=self.provider, account_email="root@example.com"
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProviderAccount.objects.create(
                provider=self.provider, account_email="root@example.com"
            )

    def test_same_login_is_allowed_at_a_different_provider(self):
        other = Provider.objects.create(name="Cloudflare", slug="cloudflare")
        ProviderAccount.objects.create(
            provider=self.provider, account_email="ops@example.com"
        )
        ProviderAccount.objects.create(provider=other, account_email="ops@example.com")
        self.assertEqual(ProviderAccount.objects.count(), 2)

    def test_deleting_a_provider_that_still_has_accounts_is_blocked(self):
        ProviderAccount.objects.create(
            provider=self.provider, account_email="root@example.com"
        )
        from django.db.models import ProtectedError

        with self.assertRaises(ProtectedError):
            self.provider.delete()

    def test_deactivating_a_user_leaves_the_account_owned_but_unassigned(self):
        owner = User.objects.create_user(
            email="owner@example.com", password="EstateTestPassword!1", full_name="Owner"
        )
        account = ProviderAccount.objects.create(
            provider=self.provider, account_email="root@example.com", owner=owner
        )
        owner.delete()
        account.refresh_from_db()
        self.assertIsNone(account.owner_id)


class PropertyTests(TestCase):
    def test_name_is_normalised_to_lowercase(self):
        prop = Property.objects.create(name="  Example.COM  ", kind="CORPORATE")
        self.assertEqual(prop.name, "example.com")

    def test_name_is_unique_after_normalisation(self):
        Property.objects.create(name="example.com", kind="CORPORATE")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Property.objects.create(name="EXAMPLE.COM", kind="MARKETING")

    def test_services_reverse_accessor_is_named_for_the_property(self):
        from core.test_estate_api import make_subscription

        prop = Property.objects.create(name="example.com", kind="CORPORATE")
        make_subscription(digital_property=prop)
        self.assertEqual(prop.services.count(), 1)


class SeedEstateCommandTests(TestCase):
    def _run(self, *args):
        out = StringIO()
        call_command("seed_providers", *args, stdout=out)
        return out.getvalue()

    def test_seeds_the_catalog(self):
        # Against the catalog rather than a number: it is meant to grow, and a
        # magic count turns every addition into a test edit.
        from core.management.commands.seed_providers import PROVIDERS

        self._run()
        self.assertEqual(Provider.objects.count(), len(PROVIDERS))
        self.assertTrue(Provider.objects.filter(slug="cloudflare").exists())

    def test_the_catalog_has_no_duplicate_slugs_or_names(self):
        """Both are unique columns, so a duplicate is an IntegrityError on a
        production server rather than a bad row."""
        from core.management.commands.seed_providers import PROVIDERS

        slugs = [row[0] for row in PROVIDERS]
        names = [row[1] for row in PROVIDERS]
        self.assertEqual(len(set(slugs)), len(slugs))
        self.assertEqual(len(set(names)), len(names))

    def test_every_catalog_row_passes_model_validation(self):
        """The hex colour and URL validators only run on full_clean, which
        get_or_create does not call — so nothing else would catch a typo."""
        self._run()
        for provider in Provider.objects.all():
            provider.full_clean()

    def test_is_idempotent(self):
        from core.management.commands.seed_providers import PROVIDERS

        self._run()
        self._run()
        self.assertEqual(Provider.objects.count(), len(PROVIDERS))

    def test_creates_no_accounts_properties_or_services(self):
        self._run()
        self.assertEqual(ProviderAccount.objects.count(), 0)
        self.assertEqual(Property.objects.count(), 0)
        self.assertEqual(Service.objects.count(), 0)

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

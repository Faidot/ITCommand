"""Phase 4 tests: the demo seeder.

Two things matter more than the row counts. It must refuse to run in
production without being told twice, and `--clear` must remove what it made
and nothing else — a seeder that takes a real service with it on the way out is
worse than no seeder.
"""

from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from core import estate
from core.management.commands.seed_estate_demo import DEMO_MARKER
from core.models import Property, Provider, ProviderAccount, Service


def seed(**options):
    out = StringIO()
    call_command("seed_estate_demo", stdout=out, **options)
    return out.getvalue()


class SeedGuardTests(TestCase):
    @override_settings(DEBUG=False)
    def test_refuses_to_run_outside_debug(self):
        """Demo data in production lands in spend totals someone acts on."""
        with self.assertRaises(CommandError) as caught:
            seed()
        self.assertIn("Refusing to seed demo data outside DEBUG", str(caught.exception))
        self.assertEqual(Service.objects.count(), 0)

    @override_settings(DEBUG=False)
    def test_force_overrides_the_guard(self):
        call_command("seed_providers", stdout=StringIO())
        seed(force=True)
        self.assertGreater(Service.objects.count(), 0)

    @override_settings(DEBUG=True)
    def test_missing_provider_catalog_is_a_clear_error_not_a_crash(self):
        with self.assertRaises(CommandError) as caught:
            seed()
        self.assertIn("seed_providers", str(caught.exception))


@override_settings(DEBUG=True)
class SeedContentTests(TestCase):
    """The dataset has to make every state on the screens visible at once."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_providers", stdout=StringIO())

    def setUp(self):
        seed()
        self.services = Service.objects.filter(notes__contains=DEMO_MARKER)

    def test_seeds_eight_properties_and_six_accounts(self):
        self.assertEqual(Property.objects.filter(notes__contains=DEMO_MARKER).count(), 8)
        self.assertEqual(
            ProviderAccount.objects.filter(notes__contains=DEMO_MARKER).count(), 6
        )

    def test_covers_every_service_type(self):
        types = set(self.services.values_list("service_type", flat=True))
        self.assertEqual(types, set(estate.STACK_TYPE_CODES) | {"SAAS"})

    def test_covers_every_billing_cycle(self):
        cycles = set(self.services.values_list("billing_cycle", flat=True))
        self.assertEqual(cycles, {"MONTHLY", "YEARLY", "USAGE", "FREE"})

    def test_produces_red_amber_and_neutral_renewals(self):
        """All three tones must be on screen together or the timeline's
        colour coding cannot be judged."""
        days = [
            service.days_until_renewal
            for service in self.services
            if service.renewal_date
        ]
        self.assertTrue(any(d <= 7 for d in days), "no red renewal")
        self.assertTrue(any(7 < d <= 30 for d in days), "no amber renewal")
        self.assertTrue(any(d > 30 for d in days), "no neutral renewal")

    def test_produces_at_least_two_at_risk_services(self):
        at_risk = [service for service in self.services if service.is_at_risk]
        self.assertGreaterEqual(len(at_risk), 2)

    def test_produces_at_least_two_orphans(self):
        self.assertGreaterEqual(self.services.filter(property__isnull=True).count(), 2)

    def test_produces_a_red_and_an_amber_mfa_badge(self):
        accounts = ProviderAccount.objects.filter(notes__contains=DEMO_MARKER)
        severities = {account.mfa_severity for account in accounts}
        self.assertIn("critical", severities)
        self.assertIn("warning", severities)

    def test_produces_one_complete_stack_and_one_with_gaps(self):
        gaps = [
            prop.stack_gap_count
            for prop in Property.objects.filter(notes__contains=DEMO_MARKER)
        ]
        self.assertIn(0, gaps, "no property has a complete stack")
        self.assertTrue(any(count > 0 for count in gaps), "no property has a gap")

    def test_saas_is_attached_somewhere_as_well_as_orphaned(self):
        """Otherwise the property page's off-stack panel is empty everywhere
        and reads as broken rather than unused."""
        attached_saas = self.services.filter(
            service_type="SAAS", property__isnull=False
        )
        self.assertGreater(attached_saas.count(), 0)

    def test_a_service_renewing_soon_with_auto_renew_on_is_not_at_risk(self):
        """Renewing soon and being at-risk are different questions, and the
        dataset has to show the difference."""
        soon_and_safe = [
            service
            for service in self.services
            if service.renewal_date
            and service.days_until_renewal is not None
            and service.days_until_renewal <= 7
            and service.auto_renew
        ]
        self.assertTrue(soon_and_safe)
        for service in soon_and_safe:
            self.assertFalse(service.is_at_risk)


@override_settings(DEBUG=True)
class SeedIsIdempotentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_providers", stdout=StringIO())

    def test_running_twice_changes_nothing(self):
        seed()
        counts = (
            Property.objects.count(),
            ProviderAccount.objects.count(),
            Service.objects.count(),
        )
        output = seed()
        self.assertEqual(
            (
                Property.objects.count(),
                ProviderAccount.objects.count(),
                Service.objects.count(),
            ),
            counts,
        )
        self.assertIn("nothing changed", output)


@override_settings(DEBUG=True)
class SeedClearTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_providers", stdout=StringIO())

    def test_clear_removes_everything_it_created(self):
        seed()
        self.assertGreater(Service.objects.count(), 0)
        seed(clear=True)
        self.assertEqual(Service.objects.filter(notes__contains=DEMO_MARKER).count(), 0)
        self.assertEqual(Property.objects.filter(notes__contains=DEMO_MARKER).count(), 0)
        self.assertEqual(
            ProviderAccount.objects.filter(notes__contains=DEMO_MARKER).count(), 0
        )

    def test_clear_leaves_the_provider_catalog_alone(self):
        """Providers are seeded separately and are not demo data."""
        seed()
        before = Provider.objects.count()
        seed(clear=True)
        self.assertEqual(Provider.objects.count(), before)

    def test_clear_leaves_real_rows_alone(self):
        """The whole point of the marker."""
        seed()
        real_property = Property.objects.create(name="real.internal", kind="CORPORATE")
        account = ProviderAccount.objects.get(account_email="aws-root@example.invalid")
        real_service = Service.objects.create(
            service_type="HOSTING",
            identifier="a real production box",
            provider=account.provider,
            provider_account=account,
            property=real_property,
        )

        seed(clear=True)

        real_service.refresh_from_db()
        real_property.refresh_from_db()
        self.assertTrue(Service.objects.filter(pk=real_service.pk).exists())
        self.assertTrue(Property.objects.filter(pk=real_property.pk).exists())

    def test_clear_keeps_an_account_that_now_holds_a_real_service(self):
        """Deleting it would either fail on the PROTECT or take the real
        service with it. Neither is this command's business."""
        seed()
        account = ProviderAccount.objects.get(account_email="aws-root@example.invalid")
        Service.objects.create(
            service_type="HOSTING",
            identifier="a real production box",
            provider=account.provider,
            provider_account=account,
        )

        output = seed(clear=True)

        self.assertTrue(ProviderAccount.objects.filter(pk=account.pk).exists())
        self.assertIn("Kept aws-root@example.invalid", output)

    def test_clear_then_seed_restores_the_dataset(self):
        seed()
        expected = Service.objects.filter(notes__contains=DEMO_MARKER).count()
        seed(clear=True)
        seed()
        self.assertEqual(
            Service.objects.filter(notes__contains=DEMO_MARKER).count(), expected
        )


@override_settings(DEBUG=True)
class SeedIsFictionalTests(TestCase):
    """A real login in a seed script is a real login in everyone's shell
    history. These names must stay unresolvable."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_providers", stdout=StringIO())

    def setUp(self):
        seed()

    def test_every_property_uses_a_reserved_domain(self):
        for name in Property.objects.filter(notes__contains=DEMO_MARKER).values_list(
            "name", flat=True
        ):
            self.assertTrue(name.endswith(".example"), name)

    def test_every_login_uses_a_reserved_domain(self):
        for email in ProviderAccount.objects.filter(
            notes__contains=DEMO_MARKER
        ).values_list("account_email", flat=True):
            self.assertTrue(email.endswith("@example.invalid"), email)

    def test_no_credential_is_attached_to_demo_data(self):
        """The seeder must never invent a vault link — there is no secret
        behind it, and a dangling reference to the vault is worse than none."""
        self.assertFalse(
            Service.objects.filter(notes__contains=DEMO_MARKER)
            .exclude(vault_credential__isnull=True)
            .exists()
        )

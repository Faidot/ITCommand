"""Phase 1 model tests for the Digital Estate `Service`.

The money assertions check the *type* as well as the value. A float that
happens to equal the right number still fails, because the failure this guards
against is not a wrong answer today — it is a total that drifts by fractions of
a rupee once a few hundred services are summed, which no equality assertion on
a single row would ever catch.
"""

from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from core import estate
from core.models import Property, Provider, ProviderAccount, Service


class ServiceFactoryMixin:
    """Shared fixtures. Providers and accounts are incidental to these tests —
    every assertion here is about the service itself."""

    def setUp(self):
        super().setUp()
        self.provider = Provider.objects.create(name="Cloudflare", slug="cloudflare")
        self.account = ProviderAccount.objects.create(
            provider=self.provider, account_email="ops@example.invalid"
        )

    def make_service(self, **overrides):
        values = {
            "service_type": "DNS",
            "identifier": "example.invalid",
            "provider": self.provider,
            "provider_account": self.account,
            "cost": Decimal("120.00"),
            "billing_cycle": "MONTHLY",
        }
        values.update(overrides)
        return Service.objects.create(**values)


class MonthlyEquivalentTests(ServiceFactoryMixin, TestCase):
    """`monthly_equivalent` for every billing cycle, asserting Decimal."""

    def test_monthly_returns_cost_unchanged(self):
        service = self.make_service(cost=Decimal("120.00"), billing_cycle="MONTHLY")
        self.assertEqual(service.monthly_equivalent, Decimal("120.00"))

    def test_yearly_divides_by_twelve(self):
        service = self.make_service(cost=Decimal("1200.00"), billing_cycle="YEARLY")
        self.assertEqual(service.monthly_equivalent, Decimal("100.00"))

    def test_usage_is_zero_not_a_guess(self):
        """Usage spend is real but unknowable from a fixed figure.

        Returning `cost` here would put an invented number into a total the UI
        labels "monthly spend".
        """
        service = self.make_service(cost=Decimal("500.00"), billing_cycle="USAGE")
        self.assertEqual(service.monthly_equivalent, Decimal("0.00"))

    def test_free_is_zero(self):
        service = self.make_service(cost=Decimal("0"), billing_cycle="FREE")
        self.assertEqual(service.monthly_equivalent, Decimal("0.00"))

    def test_every_cycle_returns_decimal_never_float(self):
        for cycle in ("MONTHLY", "YEARLY", "USAGE", "FREE"):
            with self.subTest(cycle=cycle):
                service = self.make_service(
                    cost=Decimal("99.99"), billing_cycle=cycle
                )
                value = service.monthly_equivalent
                self.assertIsInstance(value, Decimal)
                self.assertNotIsInstance(value, float)

    def test_yearly_quantises_to_two_places(self):
        """100/12 is 8.333…; money stops at two places, once, at the boundary."""
        service = self.make_service(cost=Decimal("100.00"), billing_cycle="YEARLY")
        self.assertEqual(service.monthly_equivalent, Decimal("8.33"))
        self.assertEqual(service.monthly_equivalent.as_tuple().exponent, -2)

    def test_yearly_equivalent_does_not_round_trip_through_monthly(self):
        """A yearly charge reports the figure that was invoiced.

        Deriving it from the rounded monthly would turn 100.00 into 99.96.
        """
        service = self.make_service(cost=Decimal("100.00"), billing_cycle="YEARLY")
        self.assertEqual(service.yearly_equivalent, Decimal("100.00"))

    def test_monthly_yearly_equivalent_multiplies(self):
        service = self.make_service(cost=Decimal("120.00"), billing_cycle="MONTHLY")
        self.assertEqual(service.yearly_equivalent, Decimal("1440.00"))

    def test_cost_stored_as_float_is_coerced_not_propagated(self):
        """Defensive: a float arriving from a careless caller must not escape."""
        service = self.make_service(billing_cycle="MONTHLY")
        service.cost = 10.10
        self.assertIsInstance(service.monthly_equivalent, Decimal)


class OrphanTests(ServiceFactoryMixin, TestCase):
    def test_service_with_no_property_is_an_orphan(self):
        self.assertTrue(self.make_service(property=None).is_orphan)

    def test_service_attached_to_a_property_is_not(self):
        prop = Property.objects.create(name="example.invalid", kind="CORPORATE")
        self.assertFalse(self.make_service(property=prop).is_orphan)

    def test_is_orphan_does_not_query_for_a_null_relation(self):
        """Reads `property_id`, so an unfetched relation costs nothing."""
        service = self.make_service(property=None)
        fresh = Service.objects.get(pk=service.pk)
        with self.assertNumQueries(0):
            self.assertTrue(fresh.is_orphan)


class AtRiskBoundaryTests(ServiceFactoryMixin, TestCase):
    """Boundary conditions, which is where an off-by-one hides."""

    def renewing_in(self, days, **overrides):
        return self.make_service(
            renewal_date=timezone.localdate() + timedelta(days=days),
            auto_renew=False,
            **overrides,
        )

    def test_exactly_thirty_days_out_is_at_risk(self):
        self.assertEqual(estate.AT_RISK_WINDOW_DAYS, 30)
        self.assertTrue(self.renewing_in(30).is_at_risk)

    def test_thirty_one_days_out_is_not(self):
        self.assertFalse(self.renewing_in(31).is_at_risk)

    def test_renewing_today_is_at_risk(self):
        self.assertTrue(self.renewing_in(0).is_at_risk)

    def test_already_past_is_not_at_risk(self):
        """A lapsed service is a different problem, and a different number.

        Counting it as at-risk would hide it inside a KPI that means
        "about to break" rather than "already broken".
        """
        self.assertFalse(self.renewing_in(-1).is_at_risk)

    def test_auto_renew_on_is_never_at_risk(self):
        service = self.make_service(
            renewal_date=timezone.localdate() + timedelta(days=3), auto_renew=True
        )
        self.assertFalse(service.is_at_risk)

    def test_no_renewal_date_is_not_at_risk(self):
        self.assertFalse(self.make_service(renewal_date=None, auto_renew=False).is_at_risk)

    def test_cancelled_service_is_not_at_risk(self):
        self.assertFalse(self.renewing_in(3, status="CANCELLED").is_at_risk)

    def test_manually_flagged_at_risk_wins_over_the_arithmetic(self):
        """A human saying "watch this" outranks a date calculation."""
        service = self.make_service(
            status="AT_RISK", auto_renew=True, renewal_date=None
        )
        self.assertTrue(service.is_at_risk)

    def test_urgent_window_is_seven_days(self):
        self.assertEqual(estate.URGENT_WINDOW_DAYS, 7)
        self.assertEqual(estate.renewal_urgency(7), "critical")
        self.assertEqual(estate.renewal_urgency(8), "warning")


class StackGapTests(ServiceFactoryMixin, TestCase):
    """Gap computation for a property with 0, some, and all stack roles."""

    def setUp(self):
        super().setUp()
        self.property = Property.objects.create(name="example.invalid", kind="CORPORATE")

    def attach(self, service_type, **overrides):
        return self.make_service(
            service_type=service_type, property=self.property, **overrides
        )

    def test_property_with_no_services_is_missing_every_stack_role(self):
        self.assertEqual(list(self.property.stack_gaps), list(estate.STACK_TYPE_CODES))
        self.assertEqual(self.property.stack_gap_count, 7)

    def test_partial_stack_reports_only_what_is_missing(self):
        self.attach("REGISTRAR")
        self.attach("DNS")
        gaps = self.property.stack_gaps
        self.assertNotIn("REGISTRAR", gaps)
        self.assertNotIn("DNS", gaps)
        self.assertEqual(self.property.stack_gap_count, 5)

    def test_complete_stack_has_no_gaps(self):
        for code in estate.STACK_TYPE_CODES:
            self.attach(code)
        self.assertEqual(self.property.stack_gaps, [])
        self.assertEqual(self.property.stack_gap_count, 0)

    def test_gaps_are_returned_in_stack_order(self):
        self.attach("HOSTING")
        expected = [c for c in estate.STACK_TYPE_CODES if c != "HOSTING"]
        self.assertEqual(self.property.stack_gaps, expected)

    def test_saas_never_fills_a_stack_slot(self):
        """SAAS has no stack position, so it cannot close a gap."""
        self.attach("SAAS")
        self.assertEqual(self.property.stack_gap_count, 7)

    def test_saas_absence_is_never_a_gap(self):
        for code in estate.STACK_TYPE_CODES:
            self.attach(code)
        self.assertNotIn("SAAS", self.property.stack_gaps)

    def test_cancelled_service_does_not_count_as_coverage(self):
        """A registrar that lapsed is not a registrar."""
        self.attach("REGISTRAR", status="CANCELLED")
        self.assertIn("REGISTRAR", self.property.stack_gaps)

    def test_expired_service_does_not_count_as_coverage(self):
        self.attach("REGISTRAR", status="EXPIRED")
        self.assertIn("REGISTRAR", self.property.stack_gaps)


class TaxonomyTests(TestCase):
    """The catalog itself, since the frontend is forbidden from restating it."""

    def test_stack_order_is_the_request_path(self):
        self.assertEqual(
            list(estate.STACK_TYPE_CODES),
            ["REGISTRAR", "DNS", "HOSTING", "MAIL", "CDN", "TLS", "ANALYTICS"],
        )

    def test_saas_is_a_service_type_but_not_a_stack_role(self):
        self.assertIn("SAAS", estate.SERVICE_TYPE_CODES)
        self.assertNotIn("SAAS", estate.STACK_TYPE_CODES)
        self.assertFalse(estate.is_stack_type("SAAS"))

    def test_every_stack_type_is_a_service_type(self):
        self.assertTrue(
            set(estate.STACK_TYPE_CODES).issubset(set(estate.SERVICE_TYPE_CODES))
        )

    def test_stack_roles_sort_before_non_stack_types(self):
        self.assertLess(estate.sort_key("ANALYTICS"), estate.sort_key("SAAS"))

    def test_unknown_code_sorts_last(self):
        self.assertEqual(estate.sort_key("NOPE"), len(estate.SERVICE_TYPES))

    def test_security_key_replaced_key(self):
        codes = [code for code, _ in estate.MFA_TYPES]
        self.assertIn("SECURITY_KEY", codes)
        self.assertNotIn("KEY", codes)

    def test_security_key_counts_as_protection(self):
        self.assertEqual(estate.mfa_severity("SECURITY_KEY"), "ok")
        self.assertEqual(estate.mfa_severity("NONE"), "critical")
        self.assertEqual(estate.mfa_severity("SMS"), "warning")
        self.assertEqual(estate.mfa_severity("UNKNOWN"), "muted")


class ProviderAccountDerivedTests(ServiceFactoryMixin, TestCase):
    def test_count_services_counts_services_on_the_account(self):
        self.assertEqual(self.account.count_services(), 0)
        self.make_service()
        self.make_service(identifier="other.invalid")
        self.assertEqual(self.account.count_services(), 2)

    def test_service_count_name_is_left_free_for_the_annotation(self):
        """A getter-only property here would break every annotated queryset.

        Django assigns annotations with `setattr`, so `service_count` must not
        be a read-only property on the model.
        """
        from django.db.models import Count

        self.make_service()
        row = ProviderAccount.objects.annotate(
            service_count=Count("services")
        ).get(pk=self.account.pk)
        self.assertEqual(row.service_count, 1)

    def test_has_mfa_treats_security_key_as_covered(self):
        self.account.mfa_type = "SECURITY_KEY"
        self.assertTrue(self.account.has_mfa)

    def test_unknown_mfa_is_not_treated_as_covered(self):
        """"Nobody checked" must not read as "protected"."""
        self.account.mfa_type = "UNKNOWN"
        self.assertFalse(self.account.has_mfa)

    def test_provider_with_services_cannot_be_deleted(self):
        from django.db.models import ProtectedError

        self.make_service()
        with self.assertRaises(ProtectedError):
            self.provider.delete()


class ServiceNormalisationTests(ServiceFactoryMixin, TestCase):
    def test_currency_is_upper_cased_on_save(self):
        service = self.make_service(currency="pkr")
        service.refresh_from_db()
        self.assertEqual(service.currency, "PKR")

    def test_currency_defaults_to_pkr(self):
        self.assertEqual(self.make_service().currency, "PKR")

    def test_identifier_is_trimmed(self):
        service = self.make_service(identifier="  example.invalid  ")
        service.refresh_from_db()
        self.assertEqual(service.identifier, "example.invalid")

    def test_deleting_a_property_orphans_its_services_rather_than_deleting_them(self):
        """Losing the money record because someone tidied a domain is worse
        than an orphan row."""
        prop = Property.objects.create(name="doomed.invalid", kind="PARKED")
        service = self.make_service(property=prop)
        prop.delete()
        service.refresh_from_db()
        self.assertTrue(service.is_orphan)

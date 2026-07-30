"""Phase 5 tests: the Digital Estate's three finance slices.

The renewal-expense and recurring-bill tests that lived here went with the
functions they covered. Those booked an Expense and raised a RecurringBill when
a `Subscription` auto-renewed, and were reachable only from the subscription
viewset and the `auto_renew_subscriptions` command — both deleted in Phase 5.

What survives is read-only reporting, and this is what it has to get right:

* **committed is never added to booked** — different questions, and summing
  them double-counts a renewal that already raised an expense
* **a currency with no rate is reported**, not converted at 1:1 and not dropped
* **usage and free services commit nothing**, because a usage bill is real
  spend but not a predictable commitment
"""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core import finance_estate, rbac
from core.models import (
    AppSettings,
    Budget,
    BudgetCategory,
    EstateSettings,
    ExchangeRate,
    Expense,
    FinancialYear,
    Property,
    Role,
    Vendor,
)
from core.test_estate_api import make_subscription


User = get_user_model()

PASSWORD = "FinanceEstateTest!1"
ALL = {"view": True, "add": True, "edit": True, "delete": True}


def create_role(slug, **modules):
    permissions = rbac.blank_permissions()
    for module, grants in modules.items():
        if grants:
            permissions[module] = dict(grants)
    return Role.objects.create(
        slug=slug, name=slug.replace("_", " ").title(), permissions=permissions
    )


def create_user(email, role):
    return User.objects.create_user(
        email=email, password=PASSWORD, full_name=email.split("@")[0].title(), role=role
    )


class FinanceEstateTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        create_role("EST_FINANCE", estate=ALL, finance=ALL)
        create_role("EST_ONLY", estate=ALL)
        cls.manager = create_user("manager@example.com", "EST_FINANCE")
        cls.estate_only = create_user("estate@example.com", "EST_ONLY")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        AppSettings.objects.update_or_create(
            key="default_currency", defaults={"value": "PKR"}
        )
        self.category = BudgetCategory.objects.create(name="Software")
        today = timezone.localdate()
        self.year = FinancialYear.objects.create(
            name="FY 2026",
            start_date=today - timedelta(days=180),
            end_date=today + timedelta(days=185),
            is_active=True,
        )

    def service(self, **overrides):
        overrides.setdefault("currency", "PKR")
        return make_subscription(**overrides)


class CommitmentTests(FinanceEstateTestCase):
    def test_a_monthly_service_is_annualised(self):
        self.service(
            cost=Decimal("1000.00"),
            billing_cycle="MONTHLY",
            budget_category=self.category,
        )
        totals, unconvertible, currency = finance_estate.service_commitment_by_category()
        self.assertEqual(totals[self.category.pk], Decimal("12000.00"))
        self.assertEqual(currency, "PKR")
        self.assertEqual(unconvertible, {})

    def test_a_yearly_service_is_taken_as_is(self):
        self.service(
            cost=Decimal("12000.00"),
            billing_cycle="YEARLY",
            budget_category=self.category,
        )
        totals, _, _ = finance_estate.service_commitment_by_category()
        self.assertEqual(totals[self.category.pk], Decimal("12000.00"))

    def test_usage_and_free_services_commit_nothing(self):
        """A usage bill is real spend but not a commitment, and inventing a
        figure would put fiction into a budget comparison."""
        self.service(
            cost=Decimal("9999.00"),
            billing_cycle="USAGE",
            budget_category=self.category,
        )
        self.service(
            name="free one",
            cost=Decimal("0.00"),
            billing_cycle="FREE",
            budget_category=self.category,
        )
        totals, _, _ = finance_estate.service_commitment_by_category()
        self.assertEqual(totals, {})

    def test_a_cancelled_service_is_not_a_commitment(self):
        self.service(
            cost=Decimal("1000.00"), status="CANCELLED", budget_category=self.category
        )
        totals, _, _ = finance_estate.service_commitment_by_category()
        self.assertEqual(totals, {})

    def test_an_at_risk_service_is_still_a_commitment(self):
        """It is still being paid for. Dropping it would shrink the number at
        exactly the moment someone is looking at the thing about to break."""
        self.service(
            cost=Decimal("1000.00"), status="AT_RISK", budget_category=self.category
        )
        totals, _, _ = finance_estate.service_commitment_by_category()
        self.assertEqual(totals[self.category.pk], Decimal("12000.00"))

    def test_a_service_with_no_category_is_simply_absent(self):
        self.service(cost=Decimal("1000.00"))
        totals, _, _ = finance_estate.service_commitment_by_category()
        self.assertEqual(totals, {})

    def test_an_unconvertible_currency_is_reported_not_dropped(self):
        self.service(
            cost=Decimal("500.00"), currency="USD", budget_category=self.category
        )
        totals, unconvertible, _ = finance_estate.service_commitment_by_category()
        self.assertEqual(totals, {})
        self.assertEqual(unconvertible["USD"], Decimal("6000.00"))

    def test_supplying_a_rate_moves_it_into_the_total(self):
        ExchangeRate.objects.create(
            base_currency="PKR",
            currency="USD",
            rate=Decimal("280"),
            as_of=timezone.localdate(),
        )
        self.service(
            cost=Decimal("500.00"), currency="USD", budget_category=self.category
        )
        totals, unconvertible, _ = finance_estate.service_commitment_by_category()
        self.assertEqual(unconvertible, {})
        self.assertEqual(totals[self.category.pk], Decimal("1680000.00"))


class BudgetImpactTests(FinanceEstateTestCase):
    def test_commitment_is_reported_separately_from_booked_spend(self):
        Budget.objects.create(
            financial_year=self.year,
            category=self.category,
            allocated_amount=Decimal("100000.00"),
        )
        Expense.objects.create(
            title="Already paid",
            amount=Decimal("20000.00"),
            expense_date=timezone.localdate(),
            category=self.category,
            financial_year=self.year,
            status="APPROVED",
        )
        self.service(cost=Decimal("1000.00"), budget_category=self.category)

        impact = finance_estate.budget_impact(financial_year=self.year)
        row = impact["categories"][0]
        self.assertEqual(row["allocated"], "100000.00")
        self.assertEqual(row["booked"], "20000.00")
        self.assertEqual(row["service_commitment"], "12000.00")
        # Not summed: a renewal that raised an expense would be counted twice.
        self.assertEqual(row["remaining_after_booked"], "80000.00")
        self.assertEqual(row["remaining_after_commitment"], "68000.00")

    def test_overcommitment_is_flagged(self):
        Budget.objects.create(
            financial_year=self.year,
            category=self.category,
            allocated_amount=Decimal("5000.00"),
        )
        self.service(cost=Decimal("1000.00"), budget_category=self.category)
        impact = finance_estate.budget_impact(financial_year=self.year)
        self.assertTrue(impact["categories"][0]["is_overcommitted"])

    def test_amounts_are_decimal_strings_never_json_floats(self):
        self.service(cost=Decimal("0.01"), budget_category=self.category)
        impact = finance_estate.budget_impact(financial_year=self.year)
        self.assertIsInstance(impact["totals"]["service_commitment"], str)

    def test_an_unconvertible_currency_is_reported_on_the_block(self):
        self.service(
            cost=Decimal("500.00"), currency="USD", budget_category=self.category
        )
        impact = finance_estate.budget_impact(financial_year=self.year)
        self.assertFalse(impact["is_complete"])
        self.assertEqual(impact["unconvertible"][0]["currency"], "USD")


class VendorSpendTests(FinanceEstateTestCase):
    def test_annual_commitment_is_reported_per_vendor(self):
        vendor = Vendor.objects.create(name="Acme Cloud")
        self.service(cost=Decimal("1000.00"), vendor=vendor)
        result = finance_estate.service_spend_by_vendor()
        self.assertEqual(result["vendors"][0]["vendor_name"], "Acme Cloud")
        self.assertEqual(result["vendors"][0]["annual_commitment"], "12000.00")

    def test_a_service_with_no_vendor_is_simply_absent(self):
        self.service(cost=Decimal("1000.00"))
        self.assertEqual(finance_estate.service_spend_by_vendor()["vendors"], [])


class CostOverviewTests(FinanceEstateTestCase):
    def test_estate_spend_appears_by_property_and_type(self):
        prop = Property.objects.create(name="example.com", kind="CORPORATE")
        self.service(
            digital_property=prop,
            service_layer="HOSTING",
            cost=Decimal("120.00"),
            billing_cycle="YEARLY",
        )
        response = self.client.get(reverse("finance_cost_overview"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        block = response.data["subscriptions"]
        self.assertEqual(block["by_property"][0]["property_name"], "example.com")
        self.assertEqual(block["by_property"][0]["spend"]["monthly"], "10.00")
        layers = {row["layer"]: row for row in block["by_layer"]}
        self.assertEqual(layers["HOSTING"]["spend"]["yearly"], "120.00")

    def test_orphaned_spend_is_reported_separately(self):
        self.service(cost=Decimal("240.00"), billing_cycle="YEARLY")
        response = self.client.get(reverse("finance_cost_overview"))
        self.assertEqual(response.data["subscriptions"]["orphaned"]["yearly"], "240.00")

    def test_budget_impact_travels_with_the_overview(self):
        response = self.client.get(reverse("finance_cost_overview"))
        self.assertIn("budget_impact", response.data)
        self.assertIn("vendor_subscription_spend", response.data)


class RetiredWritePathTests(FinanceEstateTestCase):
    def test_expense_on_renewal_moved_to_estate_settings_and_defaults_off(self):
        """Writing to a finance table is high blast radius. An org that never
        opted in must not start booking expenses because a module was renamed.
        """
        self.assertFalse(EstateSettings.get_solo().create_expense_on_renewal)

    def test_the_renewal_write_path_is_gone(self):
        """Pinned so it cannot be quietly reintroduced without a design
        decision. `Service` has no renewal record, and these wrote to the
        ledger."""
        for name in (
            "attempt_renewal_expense",
            "build_recurring_bill",
            "renewal_expense_amount",
        ):
            self.assertFalse(hasattr(finance_estate, name), name)


class BulkExpenseLinkTests(FinanceEstateTestCase):
    """The bulk-create path had no coverage, which is how it kept setting
    `linked_license_id` and `linked_subscription_id` through Phase 5 while the
    suite stayed green. Those columns are gone; this pins the replacement."""

    def test_a_bulk_expense_can_link_to_an_estate_service(self):
        service = self.service(cost=Decimal("1000.00"))
        response = self.client.post(
            reverse("finance-expense-upload"),
            {
                "expense_date": timezone.localdate().isoformat(),
                "category": self.category.pk,
                "financial_year": self.year.pk,
                "entries": [
                    {
                        "title": "Hosting renewal",
                        "amount": "1000.00",
                        "linked_service": service.pk,
                    }
                ],
            },
            format="json",
        )
        self.assertIn(
            response.status_code,
            (status.HTTP_200_OK, status.HTTP_201_CREATED),
            response.data,
        )
        expense = Expense.objects.get(title="Hosting renewal")
        self.assertEqual(expense.linked_service_id, service.pk)

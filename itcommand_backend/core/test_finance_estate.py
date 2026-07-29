"""Phase 5 tests: subscriptions reaching the finance ledger.

This is the highest-consequence code in the feature, so the tests are weighted
towards what must *not* happen: no expense without being asked, no expense
guessed from a missing rate, no double-booking on a repeated auto-renew, and no
figure that adds a commitment to booked spend.
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
    AuditLog,
    Budget,
    BudgetCategory,
    Property,
    Expense,
    ExchangeRate,
    FinancialYear,
    RecurringBill,
    Role,
    Subscription,
    SubscriptionSettings,
    Vendor,
)
from core.views.subscriptions import apply_subscription_renewal


User = get_user_model()

PASSWORD = "FinanceEstateTest!1"


def create_role(slug, *, subscriptions=None, finance=None):
    permissions = rbac.blank_permissions()
    if subscriptions:
        permissions["subscriptions"] = subscriptions
    if finance:
        permissions["finance"] = finance
    return Role.objects.create(
        slug=slug, name=slug.replace("_", " ").title(), permissions=permissions
    )


ALL = {"view": True, "add": True, "edit": True, "delete": True}


def create_user(email, role):
    return User.objects.create_user(
        email=email, password=PASSWORD, full_name=email.split("@")[0].title(), role=role
    )


class FinanceEstateTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        create_role("SUB_FINANCE", subscriptions=ALL, finance=ALL)
        create_role("SUB_ONLY", subscriptions=ALL)
        cls.manager = create_user("manager@example.com", "SUB_FINANCE")
        cls.subs_only = create_user("subs@example.com", "SUB_ONLY")

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

    def _settings(self, **changes):
        settings = SubscriptionSettings.get_solo()
        for key, value in changes.items():
            setattr(settings, key, value)
        settings.save()
        return settings

    def _subscription(self, **overrides):
        today = timezone.localdate()
        fields = {
            "name": "Cloud hosting",
            "platform": "AWS",
            "cost": Decimal("1000.00"),
            "currency": "PKR",
            "billing_cycle": "YEARLY",
            "start_date": today - timedelta(days=300),
            "expiry_date": today + timedelta(days=30),
            "status": "ACTIVE",
            "budget_category": self.category,
        }
        fields.update(overrides)
        return Subscription.objects.create(**fields)

    def _renew(self, subscription, days=395):
        return apply_subscription_renewal(
            subscription,
            new_expiry_date=timezone.localdate() + timedelta(days=days),
            renewer=self.manager,
        )


# ───────────────── expense attribution: the refusals ─────────────────

class RenewalExpenseRefusalTests(FinanceEstateTestCase):
    """Everything that must stop an expense being written."""

    def test_nothing_is_booked_when_the_setting_is_off(self):
        """The default. A renewal must not touch finance unless asked."""
        subscription = self._subscription()
        renewal = self._renew(subscription)

        self.assertEqual(Expense.objects.count(), 0)
        self.assertIsNone(renewal.expense)
        self.assertEqual(renewal.expense_skipped_reason, finance_estate.SKIP_DISABLED)

    def test_the_setting_defaults_to_off(self):
        self.assertFalse(SubscriptionSettings.get_solo().create_expense_on_renewal)

    def test_nothing_is_booked_without_a_budget_category(self):
        self._settings(create_expense_on_renewal=True)
        subscription = self._subscription(budget_category=None)
        renewal = self._renew(subscription)

        self.assertEqual(Expense.objects.count(), 0)
        self.assertEqual(renewal.expense_skipped_reason, finance_estate.SKIP_NO_CATEGORY)

    def test_nothing_is_booked_without_an_active_financial_year(self):
        self._settings(create_expense_on_renewal=True)
        FinancialYear.objects.update(is_active=False)
        subscription = self._subscription()
        renewal = self._renew(subscription)

        self.assertEqual(Expense.objects.count(), 0)
        self.assertEqual(
            renewal.expense_skipped_reason, finance_estate.SKIP_NO_FINANCIAL_YEAR
        )

    def test_a_foreign_currency_with_no_rate_is_skipped_not_guessed(self):
        """Booking USD 500 as PKR 500 would be worse than not booking it."""
        self._settings(create_expense_on_renewal=True)
        subscription = self._subscription(currency="USD", cost=Decimal("500.00"))
        renewal = self._renew(subscription)

        self.assertEqual(Expense.objects.count(), 0)
        self.assertEqual(renewal.expense_skipped_reason, finance_estate.SKIP_NO_RATE)

    def test_the_renewal_itself_still_succeeds_when_finance_is_skipped(self):
        """A missing rate must not leave a subscription showing as expired."""
        self._settings(create_expense_on_renewal=True)
        subscription = self._subscription(currency="USD")
        new_expiry = timezone.localdate() + timedelta(days=400)

        renewal = apply_subscription_renewal(
            subscription, new_expiry_date=new_expiry, renewer=self.manager
        )
        subscription.refresh_from_db()

        self.assertEqual(subscription.expiry_date, new_expiry)
        self.assertIsNotNone(renewal.pk)

    def test_a_repeated_renewal_does_not_book_twice(self):
        """Auto-renew runs on a schedule; it must be safe to run again."""
        self._settings(create_expense_on_renewal=True)
        subscription = self._subscription()
        target = timezone.localdate() + timedelta(days=395)

        first = apply_subscription_renewal(
            subscription, new_expiry_date=target, renewer=self.manager
        )
        second = apply_subscription_renewal(
            subscription, new_expiry_date=target, renewer=self.manager
        )

        self.assertEqual(Expense.objects.count(), 1)
        self.assertIsNotNone(first.expense)
        self.assertEqual(
            second.expense_skipped_reason, finance_estate.SKIP_ALREADY_BOOKED
        )

    def test_every_skip_reason_has_a_sentence_a_user_can_read(self):
        for code in (
            finance_estate.SKIP_DISABLED,
            finance_estate.SKIP_NO_CATEGORY,
            finance_estate.SKIP_NO_FINANCIAL_YEAR,
            finance_estate.SKIP_NO_RATE,
            finance_estate.SKIP_ALREADY_BOOKED,
        ):
            self.assertIn(code, finance_estate.SKIP_REASONS)
            self.assertTrue(finance_estate.SKIP_REASONS[code].endswith("."))


# ───────────────── expense attribution: the happy path ─────────────────

class RenewalExpenseTests(FinanceEstateTestCase):
    def setUp(self):
        super().setUp()
        self._settings(create_expense_on_renewal=True)

    def test_an_expense_is_raised_against_the_category_and_year(self):
        subscription = self._subscription()
        renewal = self._renew(subscription)

        expense = Expense.objects.get()
        self.assertEqual(expense.category_id, self.category.id)
        self.assertEqual(expense.financial_year_id, self.year.id)
        self.assertEqual(expense.linked_subscription_id, subscription.id)
        self.assertEqual(expense.amount, Decimal("1000.00"))
        self.assertEqual(expense.expense_date, renewal.new_expiry)

    def test_the_expense_is_pending_so_it_cannot_move_a_budget_silently(self):
        """Budget consumption counts APPROVED only. This is the safety valve."""
        subscription = self._subscription()
        self._renew(subscription)

        expense = Expense.objects.get()
        self.assertEqual(expense.status, "PENDING")
        booked = Expense.objects.filter(
            financial_year=self.year, status="APPROVED"
        ).count()
        self.assertEqual(booked, 0)

    def test_a_foreign_currency_is_converted_when_a_rate_exists(self):
        ExchangeRate.objects.create(
            base_currency="PKR",
            currency="USD",
            rate=Decimal("280.0000000000"),
            as_of=timezone.localdate(),
        )
        subscription = self._subscription(currency="USD", cost=Decimal("500.00"))
        self._renew(subscription)

        expense = Expense.objects.get()
        self.assertEqual(expense.amount, Decimal("140000.00"))
        # The original figure must stay findable, or nobody can check the maths.
        self.assertIn("USD 500.00", expense.description)

    def test_paid_to_prefers_the_vendor_then_the_platform(self):
        vendor = Vendor.objects.create(name="Amazon Web Services")
        self._renew(self._subscription(vendor=vendor))
        self.assertEqual(Expense.objects.get().paid_to, "Amazon Web Services")

        Expense.objects.all().delete()
        self._renew(self._subscription(name="Other", vendor=None))
        self.assertEqual(Expense.objects.get().paid_to, "AWS")

    def test_the_write_is_audited_even_with_no_request(self):
        """Renewals also run from the automation container, where there is no
        request for AuditLogMixin to hang off. The row must still appear."""
        subscription = self._subscription()
        self._renew(subscription)

        entry = AuditLog.objects.filter(model_name="Expense").get()
        self.assertEqual(entry.action, "CREATE")
        self.assertEqual(entry.user_id, self.manager.id)
        self.assertEqual(entry.changes["source"], "subscription_renewal")
        self.assertEqual(entry.changes["subscription_id"], subscription.id)

    def test_the_api_says_whether_an_expense_was_raised(self):
        subscription = self._subscription()
        response = self.client.post(
            reverse("subscription-renew", args=[subscription.pk]),
            {"new_expiry": str(timezone.localdate() + timedelta(days=400))},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["expense"]["created"])
        self.assertIn("Software", response.data["expense"]["detail"])

    def test_the_api_explains_why_no_expense_was_raised(self):
        self._settings(create_expense_on_renewal=False)
        subscription = self._subscription()
        response = self.client.post(
            reverse("subscription-renew", args=[subscription.pk]),
            {"new_expiry": str(timezone.localdate() + timedelta(days=400))},
            format="json",
        )
        self.assertFalse(response.data["expense"]["created"])
        self.assertEqual(response.data["expense"]["skipped_reason"], "disabled")
        self.assertTrue(response.data["expense"]["detail"])


# ───────────────────────── recurring bill soft link ─────────────────────────

class RecurringBillLinkTests(FinanceEstateTestCase):
    def test_no_bill_is_created_just_by_having_a_subscription(self):
        """The design decision: soft link, not auto-generate."""
        self._subscription()
        self.assertEqual(RecurringBill.objects.count(), 0)

    def test_the_explicit_action_creates_one(self):
        subscription = self._subscription()
        response = self.client.post(
            reverse("subscription-create-recurring-bill", args=[subscription.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        bill = RecurringBill.objects.get()
        self.assertEqual(bill.linked_subscription_id, subscription.id)
        self.assertEqual(bill.amount, Decimal("1000.00"))
        self.assertEqual(bill.frequency, "YEARLY")
        self.assertEqual(bill.category_id, self.category.id)

    def test_a_generated_bill_never_auto_posts(self):
        """auto_post would book money on a schedule nobody reviewed."""
        subscription = self._subscription()
        self.client.post(
            reverse("subscription-create-recurring-bill", args=[subscription.pk])
        )
        self.assertFalse(RecurringBill.objects.get().auto_post)

    def test_calling_it_twice_does_not_duplicate(self):
        subscription = self._subscription()
        url = reverse("subscription-create-recurring-bill", args=[subscription.pk])
        self.client.post(url)
        second = self.client.post(url)

        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertFalse(second.data["created"])
        self.assertEqual(RecurringBill.objects.count(), 1)

    def test_finance_permission_is_required_not_just_subscription_permission(self):
        """Writing to the finance ledger needs finance rights, not estate ones."""
        self.client.force_authenticate(self.subs_only)
        subscription = self._subscription()
        response = self.client.post(
            reverse("subscription-create-recurring-bill", args=[subscription.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(RecurringBill.objects.count(), 0)

    def test_a_currency_with_no_rate_is_refused_with_a_reason(self):
        subscription = self._subscription(currency="USD")
        response = self.client.post(
            reverse("subscription-create-recurring-bill", args=[subscription.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("exchange rate", response.data["detail"])
        self.assertEqual(RecurringBill.objects.count(), 0)

    def test_the_bill_write_is_audited(self):
        subscription = self._subscription()
        self.client.post(
            reverse("subscription-create-recurring-bill", args=[subscription.pk])
        )
        entry = AuditLog.objects.filter(model_name="RecurringBill").get()
        self.assertEqual(entry.changes["subscription_id"], subscription.id)

    def test_deleting_a_subscription_leaves_the_bill_standing(self):
        """Finance owns the bill once raised; losing it would lose a payment."""
        subscription = self._subscription()
        self.client.post(
            reverse("subscription-create-recurring-bill", args=[subscription.pk])
        )
        subscription.delete()

        bill = RecurringBill.objects.get()
        self.assertIsNone(bill.linked_subscription_id)
        self.assertEqual(bill.amount, Decimal("1000.00"))


# ───────────────────────── budget impact ─────────────────────────

class BudgetImpactTests(FinanceEstateTestCase):
    def test_commitment_is_reported_separately_from_booked_spend(self):
        """Adding them would double-count a renewal already booked."""
        Budget.objects.create(
            financial_year=self.year, category=self.category,
            allocated_amount=Decimal("50000.00"),
        )
        Expense.objects.create(
            title="Booked", amount=Decimal("5000.00"),
            expense_date=timezone.localdate(), category=self.category,
            financial_year=self.year, paid_to="x", status="APPROVED",
        )
        self._subscription(cost=Decimal("1000.00"), billing_cycle="YEARLY")

        impact = finance_estate.budget_impact(financial_year=self.year)
        row = impact["categories"][0]

        self.assertEqual(row["allocated"], "50000.00")
        self.assertEqual(row["booked"], "5000.00")
        self.assertEqual(row["subscription_commitment"], "1000.00")
        self.assertEqual(row["remaining_after_booked"], "45000.00")
        self.assertEqual(row["remaining_after_commitment"], "44000.00")

    def test_a_monthly_subscription_is_annualised(self):
        self._subscription(cost=Decimal("100.00"), billing_cycle="MONTHLY")
        impact = finance_estate.budget_impact(financial_year=self.year)
        self.assertEqual(
            impact["categories"][0]["subscription_commitment"], "1200.00"
        )

    def test_overcommitment_is_flagged(self):
        Budget.objects.create(
            financial_year=self.year, category=self.category,
            allocated_amount=Decimal("500.00"),
        )
        self._subscription(cost=Decimal("1000.00"), billing_cycle="YEARLY")

        row = finance_estate.budget_impact(financial_year=self.year)["categories"][0]
        self.assertTrue(row["is_overcommitted"])
        self.assertEqual(row["remaining_after_commitment"], "-500.00")

    def test_an_unconvertible_currency_is_reported_not_dropped(self):
        self._subscription(currency="USD", cost=Decimal("500.00"), billing_cycle="YEARLY")
        impact = finance_estate.budget_impact(financial_year=self.year)

        self.assertFalse(impact["is_complete"])
        self.assertEqual(
            impact["unconvertible"], [{"currency": "USD", "annual_amount": "500.00"}]
        )

    def test_a_cancelled_subscription_is_not_a_commitment(self):
        self._subscription(status="CANCELLED", cost=Decimal("9999.00"))
        impact = finance_estate.budget_impact(financial_year=self.year)
        self.assertEqual(impact["totals"]["subscription_commitment"], "0.00")

    def test_amounts_are_decimal_strings_never_json_floats(self):
        self._subscription(cost=Decimal("0.01"), billing_cycle="YEARLY")
        impact = finance_estate.budget_impact(financial_year=self.year)
        value = impact["categories"][0]["subscription_commitment"]
        self.assertIsInstance(value, str)
        self.assertEqual(value, "0.01")


# ───────────────────────── vendor + cost overview ─────────────────────────

class VendorSpendTests(FinanceEstateTestCase):
    def test_subscription_spend_rolls_up_to_the_vendor(self):
        vendor = Vendor.objects.create(name="Amazon Web Services")
        self._subscription(vendor=vendor, cost=Decimal("100.00"), billing_cycle="MONTHLY")

        result = finance_estate.subscription_spend_by_vendor()
        self.assertEqual(result["vendors"][0]["vendor_name"], "Amazon Web Services")
        self.assertEqual(result["vendors"][0]["annual_commitment"], "1200.00")

    def test_a_subscription_with_no_vendor_is_simply_absent(self):
        self._subscription(vendor=None)
        self.assertEqual(finance_estate.subscription_spend_by_vendor()["vendors"], [])


class CostOverviewTests(FinanceEstateTestCase):
    def test_subscription_spend_appears_by_property_and_layer(self):
        prop = Property.objects.create(name="example.com", kind="CORPORATE")
        self._subscription(
            digital_property=prop, service_layer="HOSTING",
            cost=Decimal("120.00"), billing_cycle="YEARLY",
        )

        response = self.client.get(reverse("finance_cost_overview"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        subscriptions = response.data["subscriptions"]
        self.assertEqual(subscriptions["by_property"][0]["property_name"], "example.com")
        self.assertEqual(subscriptions["by_property"][0]["spend"]["monthly"], "10.00")
        layers = {row["layer"]: row for row in subscriptions["by_layer"]}
        self.assertEqual(layers["HOSTING"]["spend"]["yearly"], "120.00")

    def test_orphaned_spend_is_reported_separately(self):
        self._subscription(cost=Decimal("240.00"), billing_cycle="YEARLY")
        response = self.client.get(reverse("finance_cost_overview"))
        self.assertEqual(
            response.data["subscriptions"]["orphaned"]["yearly"], "240.00"
        )

    def test_subscription_commitment_is_not_folded_into_the_grand_total(self):
        """grand_total_cost is booked and unbooked purchases. A recurring
        commitment is a different thing, and a renewal already booked would
        otherwise be counted twice."""
        self._subscription(cost=Decimal("50000.00"), billing_cycle="YEARLY")
        response = self.client.get(reverse("finance_cost_overview"))

        self.assertEqual(response.data["grand_total_cost"], 0)
        self.assertIn("Not included in grand_total_cost", response.data["subscriptions"]["note"])

    def test_budget_impact_travels_with_the_overview(self):
        Budget.objects.create(
            financial_year=self.year, category=self.category,
            allocated_amount=Decimal("1000.00"),
        )
        self._subscription(cost=Decimal("400.00"), billing_cycle="YEARLY")

        response = self.client.get(reverse("finance_cost_overview"))
        impact = response.data["budget_impact"]
        self.assertEqual(impact["financial_year"], "FY 2026")
        self.assertEqual(
            impact["categories"][0]["remaining_after_commitment"], "600.00"
        )

    def test_the_overview_needs_finance_permission(self):
        self.client.force_authenticate(self.subs_only)
        self.assertEqual(
            self.client.get(reverse("finance_cost_overview")).status_code,
            status.HTTP_403_FORBIDDEN,
        )

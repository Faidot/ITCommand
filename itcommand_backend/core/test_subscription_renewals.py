from datetime import date, timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Notification, Subscription, SubscriptionRenewal
from core.test_subscription_assignments import make_subscription
from core.test_subscriptions import create_role, create_user
from core.views.subscriptions import run_subscription_auto_renewals


class SubscriptionAutoRenewalTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()

    def test_a_lapsed_monthly_subscription_catches_up_in_one_run(self):
        subscription = make_subscription(
            billing_cycle="MONTHLY",
            auto_renew=True,
            start_date=self.today - timedelta(days=200),
            expiry_date=self.today - timedelta(days=95),
        )
        results = run_subscription_auto_renewals()
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["cycles_advanced"], 4)

        subscription.refresh_from_db()
        self.assertGreaterEqual(subscription.expiry_date, self.today)
        self.assertEqual(
            SubscriptionRenewal.objects.filter(subscription=subscription).count(), 4
        )

    def test_renewal_rows_form_an_unbroken_chain(self):
        subscription = make_subscription(
            billing_cycle="MONTHLY",
            auto_renew=True,
            start_date=self.today - timedelta(days=120),
            expiry_date=self.today - timedelta(days=65),
        )
        run_subscription_auto_renewals()
        renewals = list(
            SubscriptionRenewal.objects.filter(subscription=subscription).order_by(
                "renewed_at", "pk"
            )
        )
        self.assertGreater(len(renewals), 1)
        for previous, following in zip(renewals, renewals[1:]):
            self.assertEqual(previous.new_expiry, following.previous_expiry)
        self.assertTrue(all(r.notes == "Auto-renewed" for r in renewals))

    def test_a_yearly_leap_day_expiry_lands_on_the_28th(self):
        subscription = make_subscription(
            billing_cycle="YEARLY",
            auto_renew=True,
            start_date=date(2024, 2, 29),
            expiry_date=date(2024, 2, 29),
        )
        run_subscription_auto_renewals()
        subscription.refresh_from_db()
        self.assertEqual((subscription.expiry_date.month, subscription.expiry_date.day), (2, 28))
        self.assertGreaterEqual(subscription.expiry_date, self.today)

    def test_expiry_only_ever_moves_forward(self):
        """Guards the subscription_dates_ordered CHECK constraint."""
        subscription = make_subscription(
            billing_cycle="MONTHLY",
            auto_renew=True,
            start_date=self.today - timedelta(days=90),
            expiry_date=self.today - timedelta(days=40),
        )
        previous = subscription.expiry_date
        run_subscription_auto_renewals()
        subscription.refresh_from_db()
        self.assertGreater(subscription.expiry_date, previous)
        self.assertGreaterEqual(subscription.expiry_date, subscription.start_date)

    def test_a_cancellation_deadline_stays_within_the_window(self):
        subscription = make_subscription(
            billing_cycle="MONTHLY",
            auto_renew=True,
            start_date=self.today - timedelta(days=90),
            expiry_date=self.today - timedelta(days=40),
            cancellation_deadline=self.today - timedelta(days=50),
        )
        run_subscription_auto_renewals()
        subscription.refresh_from_db()
        self.assertLessEqual(subscription.cancellation_deadline, subscription.expiry_date)

    def test_subscriptions_that_should_not_renew_are_left_alone(self):
        cases = {
            "auto_renew off": make_subscription(
                name="No auto renew",
                auto_renew=False,
                start_date=self.today - timedelta(days=90),
                expiry_date=self.today - timedelta(days=10),
            ),
            "paused": make_subscription(
                name="Paused",
                auto_renew=True,
                status="PAUSED",
                start_date=self.today - timedelta(days=90),
                expiry_date=self.today - timedelta(days=10),
            ),
            "cancelled": make_subscription(
                name="Cancelled",
                auto_renew=True,
                status="CANCELLED",
                start_date=self.today - timedelta(days=90),
                expiry_date=self.today - timedelta(days=10),
            ),
            "not yet expired": make_subscription(
                name="Still valid",
                auto_renew=True,
                start_date=self.today - timedelta(days=10),
                expiry_date=self.today + timedelta(days=10),
            ),
        }
        self.assertEqual(run_subscription_auto_renewals(), [])
        for label, subscription in cases.items():
            expiry = subscription.expiry_date
            subscription.refresh_from_db()
            self.assertEqual(subscription.expiry_date, expiry, label)
        self.assertEqual(SubscriptionRenewal.objects.count(), 0)

    def test_a_stale_expiry_notification_is_reconciled_after_renewal(self):
        owner = create_user(
            "renewal-owner@example.com",
            create_role("RENEWAL_OWNER", view=True).slug,
        )
        subscription = make_subscription(
            billing_cycle="MONTHLY",
            auto_renew=True,
            owner=owner,
            start_date=self.today - timedelta(days=90),
            expiry_date=self.today - timedelta(days=10),
        )
        Notification.objects.create(
            user=owner,
            message="Your subscription has expired.",
            notification_type="SUBSCRIPTION",
            link=f"/subscriptions?subscription={subscription.pk}&alert=expiry",
        )

        run_subscription_auto_renewals()

        subscription.refresh_from_db()
        self.assertGreaterEqual(subscription.expiry_date, self.today)
        stale = Notification.objects.filter(
            notification_type="SUBSCRIPTION",
            link__contains="alert=expiry",
            is_read=False,
        )
        self.assertFalse(
            stale.exists(),
            "An expiry notification survived against an expiry that has moved.",
        )

    def test_the_management_command_reports_and_is_idempotent(self):
        make_subscription(
            billing_cycle="MONTHLY",
            auto_renew=True,
            start_date=self.today - timedelta(days=90),
            expiry_date=self.today - timedelta(days=35),
        )
        out = StringIO()
        call_command("auto_renew_subscriptions", stdout=out)
        self.assertIn("Auto-renewed 1 subscription(s):", out.getvalue())

        out = StringIO()
        call_command("auto_renew_subscriptions", stdout=out)
        self.assertIn("No subscriptions needed auto-renewal.", out.getvalue())


class SubscriptionRenewEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager_role = create_role(
            "RENEW_MANAGER", view=True, add=True, edit=True, delete=True
        )
        self.viewer_role = create_role("RENEW_VIEWER", view=True)
        self.manager = create_user("renew-manager@example.com", self.manager_role.slug)
        self.viewer = create_user("renew-viewer@example.com", self.viewer_role.slug)
        self.today = timezone.localdate()
        self.subscription = make_subscription(
            billing_cycle="MONTHLY",
            seats_total=5,
            start_date=self.today - timedelta(days=30),
            expiry_date=self.today + timedelta(days=5),
        )
        self.client.force_authenticate(self.manager)

    def renew_url(self):
        return reverse("subscription-renew", args=[self.subscription.pk])

    def test_renew_advances_expiry_and_records_cost(self):
        new_expiry = self.subscription.expiry_date + timedelta(days=30)
        response = self.client.post(
            self.renew_url(),
            {"new_expiry": new_expiry.isoformat(), "cost": "49.99", "seats_added": 2},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(Decimal(response.data["cost"]), Decimal("49.99"))

        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.expiry_date, new_expiry)
        self.assertEqual(self.subscription.seats_total, 7)

    def test_renew_rejects_an_expiry_that_does_not_move_forward(self):
        for candidate in (
            self.subscription.expiry_date,
            self.subscription.expiry_date - timedelta(days=1),
        ):
            response = self.client.post(
                self.renew_url(), {"new_expiry": candidate.isoformat()}, format="json"
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(SubscriptionRenewal.objects.count(), 0)

    def test_renew_validates_its_input(self):
        cases = [
            {},
            {"new_expiry": "not-a-date"},
            {"new_expiry": (self.today + timedelta(days=60)).isoformat(), "cost": "abc"},
            {"new_expiry": (self.today + timedelta(days=60)).isoformat(), "cost": "-5"},
            {
                "new_expiry": (self.today + timedelta(days=60)).isoformat(),
                "seats_added": -1,
            },
        ]
        for payload in cases:
            response = self.client.post(self.renew_url(), payload, format="json")
            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST, payload
            )
        self.assertEqual(SubscriptionRenewal.objects.count(), 0)

    def test_suggest_next_expiry_follows_the_billing_cycle(self):
        response = self.client.get(
            reverse("subscription-suggest-next-expiry", args=[self.subscription.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["billing_cycle"], "MONTHLY")
        self.assertEqual(
            response.data["current_expiry"], str(self.subscription.expiry_date)
        )
        # Monthly advances by one calendar month, not a fixed 30 days.
        current = self.subscription.expiry_date
        expected_month = current.month % 12 + 1
        expected_year = current.year + (1 if current.month == 12 else 0)
        suggested = date.fromisoformat(response.data["suggested_expiry"])
        self.assertEqual((suggested.year, suggested.month), (expected_year, expected_month))
        self.assertEqual(suggested.day, current.day)

    def test_suggest_next_expiry_advances_a_year_for_yearly_billing(self):
        yearly = make_subscription(
            name="Yearly plan",
            billing_cycle="YEARLY",
            start_date=self.today - timedelta(days=30),
            expiry_date=self.today + timedelta(days=5),
        )
        response = self.client.get(
            reverse("subscription-suggest-next-expiry", args=[yearly.pk])
        )
        suggested = date.fromisoformat(response.data["suggested_expiry"])
        self.assertEqual(suggested.year, yearly.expiry_date.year + 1)
        self.assertEqual(
            (suggested.month, suggested.day),
            (yearly.expiry_date.month, yearly.expiry_date.day),
        )

    def test_renewals_are_listed_newest_first(self):
        first = self.subscription.expiry_date + timedelta(days=30)
        second = first + timedelta(days=30)
        for expiry in (first, second):
            self.client.post(
                self.renew_url(), {"new_expiry": expiry.isoformat()}, format="json"
            )
        response = self.client.get(
            reverse("subscription-list-renewals", args=[self.subscription.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]["new_expiry"], str(second))

    def test_renewal_endpoints_follow_the_subscriptions_role_map(self):
        self.client.force_authenticate(self.viewer)
        response = self.client.post(
            self.renew_url(),
            {"new_expiry": (self.today + timedelta(days=60)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.post(
                reverse("subscription-process-auto-renewals"), format="json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        # Reading renewal history only needs view.
        self.assertEqual(
            self.client.get(
                reverse("subscription-list-renewals", args=[self.subscription.pk])
            ).status_code,
            status.HTTP_200_OK,
        )

    def test_process_auto_renewals_endpoint_reports_what_moved(self):
        lapsed = make_subscription(
            name="Lapsed",
            billing_cycle="MONTHLY",
            auto_renew=True,
            start_date=self.today - timedelta(days=90),
            expiry_date=self.today - timedelta(days=20),
        )
        response = self.client.post(
            reverse("subscription-process-auto-renewals"), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["renewed"][0]["id"], lapsed.pk)

from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    Asset,
    Notification,
    Subscription,
    SubscriptionAlertLog,
    SubscriptionSettings,
    User,
)
from core.subscription_alerts import check_subscription_alerts


class SubscriptionAlertTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.owner = self._user("owner@example.com", "VIEWER")
        self.subscription_admin = self._user("sub-admin@example.com", "VIEWER")
        self.manager = self._user("manager@example.com", "MANAGER")
        self.unauthorized = self._user("employee@example.com", "EMPLOYEE")
        self.settings = SubscriptionSettings.get_solo()

    @staticmethod
    def _user(email, role):
        return User.objects.create_user(
            email=email,
            password="test-password",
            full_name=email.split("@", 1)[0],
            role=role,
        )

    def _subscription(self, **overrides):
        values = {
            "name": "ChatGPT Business",
            "platform": "OpenAI",
            "plan_type": "Business",
            "category": "AI",
            "cost": Decimal("100.00"),
            "currency": "USD",
            "billing_cycle": "MONTHLY",
            "start_date": self.today - timedelta(days=90),
            "expiry_date": self.today + timedelta(days=10),
            "owner": self.owner,
            "admin": self.subscription_admin,
            "auto_renew": True,
            "renewal_reminder_days": 30,
        }
        values.update(overrides)
        return Subscription.objects.create(**values)

    def test_renewal_delivery_is_permission_scoped_and_idempotent(self):
        subscription = self._subscription()

        first = check_subscription_alerts(today=self.today)

        self.assertEqual(first.notifications_created, 3)
        self.assertEqual(SubscriptionAlertLog.objects.count(), 3)
        recipients = set(Notification.objects.values_list("user_id", flat=True))
        self.assertEqual(
            recipients,
            {self.owner.id, self.subscription_admin.id, self.manager.id},
        )
        self.assertNotIn(self.unauthorized.id, recipients)
        self.assertTrue(
            SubscriptionAlertLog.objects.filter(
                subscription=subscription,
                alert_type="RENEWAL",
            ).exists()
        )

        Notification.objects.update(is_read=True)
        second = check_subscription_alerts(today=self.today)

        self.assertEqual(second.notifications_created, 0)
        self.assertEqual(second.alert_logs_created, 0)
        self.assertEqual(second.unchanged, 3)
        self.assertEqual(Notification.objects.count(), 3)
        self.assertFalse(Notification.objects.filter(is_read=False).exists())

    def test_missing_notification_is_repaired_without_duplicate_alert_log(self):
        self._subscription()
        check_subscription_alerts(today=self.today)
        Notification.objects.filter(user=self.owner).delete()

        result = check_subscription_alerts(today=self.today)

        self.assertEqual(result.alert_logs_created, 0)
        self.assertEqual(result.notifications_created, 1)
        self.assertEqual(Notification.objects.count(), 3)
        self.assertEqual(SubscriptionAlertLog.objects.count(), 3)

    def test_expired_and_cancellation_events_have_distinct_stable_logs(self):
        expired = self._subscription(
            name="Expired tool",
            expiry_date=self.today - timedelta(days=1),
            auto_renew=False,
        )
        cancellation = self._subscription(
            name="AWS cancellation",
            expiry_date=self.today + timedelta(days=60),
            cancellation_deadline=self.today + timedelta(days=5),
            cancellation_reminder_enabled=True,
            cancellation_reminder_days=7,
        )

        check_subscription_alerts(today=self.today)
        check_subscription_alerts(today=self.today)

        self.assertEqual(
            SubscriptionAlertLog.objects.filter(
                subscription=expired,
                alert_type="EXPIRY",
            ).count(),
            3,
        )
        self.assertEqual(
            SubscriptionAlertLog.objects.filter(
                subscription=cancellation,
                alert_type="CANCELLATION",
            ).count(),
            3,
        )
        self.assertEqual(Notification.objects.count(), 6)
        self.assertTrue(
            Notification.objects.filter(message__icontains="expired on").exists()
        )
        self.assertTrue(
            Notification.objects.filter(message__icontains="avoid an unwanted").exists()
        )

    def test_api_create_delivers_due_cancellation_after_daily_check(self):
        # Simulate the daily run having already completed before a same-day
        # subscription is entered in the app.
        check_subscription_alerts(today=self.today)
        client = APIClient()
        client.force_authenticate(self.manager)
        payload = {
            "name": "Late-entered SaaS",
            "platform": "Example",
            "plan_type": "Business",
            "category": "SAAS",
            "cost": "49.00",
            "currency": "USD",
            "billing_cycle": "MONTHLY",
            "start_date": (self.today - timedelta(days=30)).isoformat(),
            "expiry_date": (self.today + timedelta(days=30)).isoformat(),
            "status": "ACTIVE",
            "renewal_reminder_enabled": False,
            "cancellation_deadline": (self.today + timedelta(days=2)).isoformat(),
            "cancellation_reminder_enabled": True,
            "cancellation_reminder_days": 7,
        }

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            response = client.post(
                reverse("subscription-list"),
                payload,
                format="json",
            )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(callbacks), 1)
        notification = Notification.objects.get(is_read=False)
        self.assertEqual(notification.user, self.manager)
        self.assertIn("Cancellation reminder", notification.message)

    def test_date_shift_supersedes_old_unread_notifications(self):
        subscription = self._subscription()
        check_subscription_alerts(today=self.today)
        old_links = set(Notification.objects.values_list("link", flat=True))
        old_expiry = subscription.expiry_date
        new_expiry = self.today + timedelta(days=5)
        client = APIClient()
        client.force_authenticate(self.manager)

        with self.captureOnCommitCallbacks(execute=True):
            response = client.patch(
                reverse("subscription-detail", args=[subscription.pk]),
                {"expiry_date": new_expiry.isoformat()},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Notification.objects.filter(link__in=old_links).exists())
        current = Notification.objects.filter(is_read=False)
        self.assertEqual(current.count(), 3)
        self.assertEqual(
            set(current.values_list("link", flat=True)),
            {
                f"/subscriptions?subscription={subscription.pk}&alert=renewal"
                f"&date={new_expiry}"
            },
        )

        # Moving back to the original event must create a fresh unread alert;
        # stale system rows are deleted rather than converted into apparently
        # user-dismissed history.
        with self.captureOnCommitCallbacks(execute=True):
            response = client.patch(
                reverse("subscription-detail", args=[subscription.pk]),
                {"expiry_date": old_expiry.isoformat()},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.data)
        current = Notification.objects.filter(is_read=False)
        self.assertEqual(current.count(), 3)
        self.assertEqual(set(current.values_list("link", flat=True)), old_links)

    def test_cancelling_subscription_retires_unread_notifications(self):
        subscription = self._subscription()
        check_subscription_alerts(today=self.today)
        client = APIClient()
        client.force_authenticate(self.manager)

        with self.captureOnCommitCallbacks(execute=True):
            response = client.patch(
                reverse("subscription-detail", args=[subscription.pk]),
                {"status": "CANCELLED"},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Notification.objects.filter(is_read=False).exists())
        self.assertEqual(Notification.objects.count(), 0)

    def test_deleting_subscription_retires_unread_notifications(self):
        subscription = self._subscription()
        check_subscription_alerts(today=self.today)
        superadmin = self._user("superadmin@example.com", "SUPERADMIN")
        client = APIClient()
        client.force_authenticate(superadmin)

        with self.captureOnCommitCallbacks(execute=True):
            response = client.delete(
                reverse("subscription-detail", args=[subscription.pk])
            )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Notification.objects.filter(is_read=False).exists())
        self.assertEqual(Notification.objects.count(), 0)
        self.assertFalse(
            SubscriptionAlertLog.objects.filter(subscription_id=subscription.pk).exists()
        )

    def test_full_check_retires_orphaned_subscription_notification(self):
        subscription = self._subscription()
        check_subscription_alerts(today=self.today)
        Subscription.objects.filter(pk=subscription.pk).delete()

        result = check_subscription_alerts(today=self.today)

        self.assertEqual(result.notifications_retired, 3)
        self.assertFalse(Notification.objects.filter(is_read=False).exists())

    def test_budget_alerts_use_only_configured_currency_and_managers(self):
        self.settings.budget_currency = "USD"
        self.settings.monthly_budget_threshold = Decimal("100.00")
        self.settings.yearly_budget_threshold = Decimal("1000.00")
        self.settings.save(update_fields=[
            "budget_currency",
            "monthly_budget_threshold",
            "yearly_budget_threshold",
        ])
        self._subscription(
            renewal_reminder_enabled=False,
            expiry_date=self.today + timedelta(days=90),
            cost=Decimal("125.00"),
        )
        self._subscription(
            name="EUR platform",
            currency="EUR",
            cost=Decimal("9999.00"),
            renewal_reminder_enabled=False,
            expiry_date=self.today + timedelta(days=90),
        )

        result = check_subscription_alerts(today=self.today)

        self.assertEqual(result.notifications_created, 2)
        self.assertEqual(
            set(Notification.objects.values_list("user_id", flat=True)),
            {self.manager.id},
        )
        self.assertEqual(
            set(SubscriptionAlertLog.objects.values_list("alert_type", flat=True)),
            {"MONTHLY_BUDGET", "YEARLY_BUDGET"},
        )
        self.assertFalse(Notification.objects.filter(message__contains="EUR").exists())

    def test_budget_alert_aggregates_before_rounding_small_yearly_costs(self):
        self.settings.budget_currency = "USD"
        self.settings.monthly_budget_threshold = Decimal("0.01")
        self.settings.yearly_budget_threshold = None
        self.settings.save(update_fields=[
            "budget_currency",
            "monthly_budget_threshold",
            "yearly_budget_threshold",
        ])
        for index in range(12):
            self._subscription(
                name=f"Tiny yearly tool {index}",
                billing_cycle="YEARLY",
                cost=Decimal("0.01"),
                renewal_reminder_enabled=False,
                expiry_date=self.today + timedelta(days=90),
            )

        result = check_subscription_alerts(today=self.today)

        self.assertEqual(result.notifications_created, 1)
        notification = Notification.objects.get()
        self.assertIn("USD 0.01", notification.message)

    def test_budget_notification_is_retired_when_threshold_no_longer_met(self):
        self.settings.budget_currency = "USD"
        self.settings.monthly_budget_threshold = Decimal("50.00")
        self.settings.yearly_budget_threshold = None
        self.settings.save(update_fields=[
            "budget_currency",
            "monthly_budget_threshold",
            "yearly_budget_threshold",
        ])
        self._subscription(
            renewal_reminder_enabled=False,
            expiry_date=self.today + timedelta(days=90),
            cost=Decimal("100.00"),
        )
        check_subscription_alerts(today=self.today)
        self.assertTrue(
            Notification.objects.filter(link__contains="monthly-budget").exists()
        )

        self.settings.monthly_budget_threshold = Decimal("200.00")
        self.settings.save(update_fields=["monthly_budget_threshold"])
        result = check_subscription_alerts(today=self.today)

        self.assertEqual(result.notifications_retired, 1)
        self.assertFalse(Notification.objects.exists())

    def test_dry_run_reports_due_work_without_writes(self):
        self._subscription()
        output = StringIO()

        call_command("check_subscription_alerts", "--dry-run", stdout=output)

        self.assertIn("dry run", output.getvalue().lower())
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(SubscriptionAlertLog.objects.count(), 0)

    def test_global_notification_switch_stops_all_delivery(self):
        self._subscription()
        self.settings.notifications_enabled = False
        self.settings.save(update_fields=["notifications_enabled"])

        result = check_subscription_alerts(today=self.today)

        self.assertTrue(result.disabled)
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(SubscriptionAlertLog.objects.count(), 0)

    def test_global_switch_retires_all_unread_but_preserves_read_history(self):
        self.settings.monthly_budget_threshold = Decimal("50.00")
        self.settings.save(update_fields=["monthly_budget_threshold"])
        self._subscription()
        check_subscription_alerts(today=self.today)
        read_history = Notification.objects.filter(user=self.owner).get()
        read_history.is_read = True
        read_history.save(update_fields=["is_read"])
        unread_count = Notification.objects.filter(is_read=False).count()

        self.settings.notifications_enabled = False
        self.settings.save(update_fields=["notifications_enabled"])
        result = check_subscription_alerts(today=self.today)

        self.assertTrue(result.disabled)
        self.assertEqual(result.notifications_retired, unread_count)
        self.assertFalse(Notification.objects.filter(is_read=False).exists())
        self.assertEqual(
            list(Notification.objects.values_list("pk", flat=True)),
            [read_history.pk],
        )

    def test_notification_polling_can_skip_legacy_generators(self):
        Asset.objects.create(
            name="Warranty test laptop",
            warranty_expiry=self.today + timedelta(days=5),
        )
        client = APIClient()
        client.force_authenticate(self.manager)

        response = client.get(reverse("notification-list"), {"generate": "false"})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            Notification.objects.filter(
                user=self.manager,
                notification_type="WARRANTY",
            ).exists()
        )

        client.get(reverse("notification-list"))
        self.assertTrue(
            Notification.objects.filter(
                user=self.manager,
                notification_type="WARRANTY",
            ).exists()
        )

    def test_read_notification_stays_out_of_polling_inbox(self):
        notification = Notification.objects.create(
            user=self.manager,
            message="AWS renews tomorrow.",
            notification_type="SUBSCRIPTION",
            link="/subscriptions",
        )
        client = APIClient()
        client.force_authenticate(self.manager)

        first_poll = client.get(
            reverse("notification-list"),
            {"generate": "false"},
        )
        self.assertEqual(first_poll.status_code, 200)
        self.assertEqual(
            [item["id"] for item in first_poll.data],
            [notification.id],
        )

        mark_read = client.post(
            reverse("notification-read", args=[notification.id]),
        )
        self.assertEqual(mark_read.status_code, 200)

        second_poll = client.get(
            reverse("notification-list"),
            {"generate": "false"},
        )
        self.assertEqual(second_poll.status_code, 200)
        self.assertEqual(second_poll.data, [])

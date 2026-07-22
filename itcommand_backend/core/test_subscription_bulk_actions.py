from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core.models import (
    AuditLog,
    BudgetCategory,
    Department,
    Notification,
    Subscription,
    Vendor,
)
from core.test_subscription_assignments import make_subscription
from core.test_subscriptions import create_role, create_user


class SubscriptionBulkActionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager_role = create_role(
            "BULK_MANAGER", view=True, add=True, edit=True, delete=True
        )
        self.editor_role = create_role("BULK_EDITOR", view=True, add=True, edit=True)
        self.viewer_role = create_role("BULK_VIEWER", view=True)
        self.manager = create_user("bulk-manager@example.com", self.manager_role.slug)
        self.editor = create_user("bulk-editor@example.com", self.editor_role.slug)
        self.viewer = create_user("bulk-viewer@example.com", self.viewer_role.slug)

        self.first = make_subscription(name="First")
        self.second = make_subscription(name="Second")
        self.client.force_authenticate(self.manager)

    def url(self):
        return reverse("subscription-bulk-action")

    def post(self, payload):
        return self.client.post(self.url(), payload, format="json")

    def ids(self):
        return [self.first.pk, self.second.pk]

    # --- status / flag changes -------------------------------------

    def test_pause_resume_and_cancel(self):
        for operation, expected in (
            ("pause", "PAUSED"),
            ("resume", "ACTIVE"),
            ("cancel", "CANCELLED"),
        ):
            response = self.post({"ids": self.ids(), "action": operation})
            self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
            self.assertEqual(response.data["affected"], 2)
            for subscription in (self.first, self.second):
                subscription.refresh_from_db()
                self.assertEqual(subscription.status, expected, operation)

    def test_auto_renew_toggles(self):
        self.post({"ids": self.ids(), "action": "auto_renew_off"})
        for subscription in (self.first, self.second):
            subscription.refresh_from_db()
            self.assertFalse(subscription.auto_renew)

        self.post({"ids": self.ids(), "action": "auto_renew_on"})
        for subscription in (self.first, self.second):
            subscription.refresh_from_db()
            self.assertTrue(subscription.auto_renew)

    def test_set_related_fields(self):
        owner = create_user("bulk-owner@example.com", self.viewer_role.slug)
        department = Department.objects.create(name="Finance")
        vendor = Vendor.objects.create(name="Acme")
        category = BudgetCategory.objects.create(name="Software")

        cases = [
            ("set_owner", owner.pk, "owner_id", owner.pk),
            ("set_department", department.pk, "department_id", department.pk),
            ("set_vendor", vendor.pk, "vendor_id", vendor.pk),
            ("set_budget_category", category.pk, "budget_category_id", category.pk),
            ("set_category", "SECURITY", "category", "SECURITY"),
        ]
        for operation, value, field, expected in cases:
            response = self.post(
                {"ids": self.ids(), "action": operation, "value": value}
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK, operation)
            self.first.refresh_from_db()
            self.assertEqual(getattr(self.first, field), expected, operation)

    def test_set_owner_can_clear_the_field(self):
        owner = create_user("clearable-owner@example.com", self.viewer_role.slug)
        self.post({"ids": self.ids(), "action": "set_owner", "value": owner.pk})
        self.post({"ids": self.ids(), "action": "set_owner", "value": "none"})
        self.first.refresh_from_db()
        self.assertIsNone(self.first.owner_id)

    def test_audit_trail_records_every_affected_row(self):
        self.post({"ids": self.ids(), "action": "pause"})
        for subscription in (self.first, self.second):
            self.assertTrue(
                AuditLog.objects.filter(
                    user=self.manager,
                    action="UPDATE",
                    model_name="Subscription",
                    object_id=str(subscription.pk),
                ).exists(),
                subscription.name,
            )

    # --- validation ------------------------------------------------

    def test_invalid_requests_are_rejected(self):
        cases = [
            ({"action": "pause"}, status.HTTP_400_BAD_REQUEST),
            ({"ids": [], "action": "pause"}, status.HTTP_400_BAD_REQUEST),
            ({"ids": "1,2", "action": "pause"}, status.HTTP_400_BAD_REQUEST),
            ({"ids": ["abc"], "action": "pause"}, status.HTTP_400_BAD_REQUEST),
            ({"ids": self.ids(), "action": "explode"}, status.HTTP_400_BAD_REQUEST),
            ({"ids": self.ids()}, status.HTTP_400_BAD_REQUEST),
            (
                {"ids": self.ids(), "action": "set_category", "value": "NOPE"},
                status.HTTP_400_BAD_REQUEST,
            ),
            (
                {"ids": self.ids(), "action": "set_vendor", "value": 999999},
                status.HTTP_400_BAD_REQUEST,
            ),
            ({"ids": [999999], "action": "pause"}, status.HTTP_404_NOT_FOUND),
        ]
        for payload, expected in cases:
            self.assertEqual(self.post(payload).status_code, expected, payload)

    # --- delete ----------------------------------------------------

    def test_bulk_delete_removes_rows(self):
        response = self.post({"ids": self.ids(), "action": "delete"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["deleted_count"], 2)
        self.assertEqual(response.data["blocked_count"], 0)
        self.assertFalse(Subscription.objects.filter(pk__in=self.ids()).exists())

    def test_bulk_delete_blocks_rows_with_active_seats(self):
        member = create_user("bulk-seat@example.com", self.viewer_role.slug)
        self.client.post(
            reverse("subscription-assign-seat", args=[self.first.pk]),
            {"user_id": member.pk},
            format="json",
        )
        response = self.post({"ids": self.ids(), "action": "delete"})
        self.assertEqual(response.data["deleted_count"], 1)
        self.assertEqual(response.data["blocked_count"], 1)
        self.assertEqual(response.data["blocked"][0]["id"], self.first.pk)
        self.assertIn("seat", response.data["blocked"][0]["reason"])
        self.assertTrue(Subscription.objects.filter(pk=self.first.pk).exists())
        self.assertFalse(Subscription.objects.filter(pk=self.second.pk).exists())

    # --- alert reconciliation (the reason .update() is not used) ----

    def test_bulk_cancel_retires_live_reminders(self):
        owner = create_user("bulk-notify@example.com", self.manager_role.slug)
        subscription = make_subscription(
            name="Reminder holder",
            owner=owner,
            start_date=timezone.localdate() - timedelta(days=10),
            expiry_date=timezone.localdate() + timedelta(days=3),
            renewal_reminder_enabled=True,
            renewal_reminder_days=30,
        )
        # Raise the real reminder through the normal path. Alert refreshes run
        # in on_commit hooks, which TestCase does not flush on its own.
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(
                reverse("subscription-detail", args=[subscription.pk]),
                {"notes": "touch"},
                format="json",
            )
        self.assertTrue(
            Notification.objects.filter(
                notification_type="SUBSCRIPTION",
                link__contains=f"subscription={subscription.pk}",
            ).exists(),
            "Expected a reminder to exist before cancelling.",
        )

        with self.captureOnCommitCallbacks(execute=True):
            self.post({"ids": [subscription.pk], "action": "cancel"})

        self.assertFalse(
            Notification.objects.filter(
                notification_type="SUBSCRIPTION",
                link__contains=f"subscription={subscription.pk}",
                is_read=False,
            ).exists(),
            "A reminder survived against a cancelled subscription.",
        )

    def test_bulk_delete_retires_notifications(self):
        owner = create_user("bulk-del-notify@example.com", self.manager_role.slug)
        subscription = make_subscription(
            name="Doomed",
            owner=owner,
            start_date=timezone.localdate() - timedelta(days=10),
            expiry_date=timezone.localdate() + timedelta(days=3),
        )
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(
                reverse("subscription-detail", args=[subscription.pk]),
                {"notes": "touch"},
                format="json",
            )
        with self.captureOnCommitCallbacks(execute=True):
            self.post({"ids": [subscription.pk], "action": "delete"})
        self.assertFalse(
            Notification.objects.filter(
                notification_type="SUBSCRIPTION",
                link__contains=f"subscription={subscription.pk}",
                is_read=False,
            ).exists(),
            "A reminder survived against a deleted subscription.",
        )

    # --- RBAC ------------------------------------------------------

    def test_delete_needs_the_delete_permission_but_edits_do_not(self):
        self.client.force_authenticate(self.editor)
        self.assertEqual(
            self.post({"ids": self.ids(), "action": "pause"}).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.post({"ids": self.ids(), "action": "delete"}).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertTrue(Subscription.objects.filter(pk__in=self.ids()).exists())

    def test_viewers_cannot_run_bulk_actions(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.post({"ids": self.ids(), "action": "pause"}).status_code,
            status.HTTP_403_FORBIDDEN,
        )

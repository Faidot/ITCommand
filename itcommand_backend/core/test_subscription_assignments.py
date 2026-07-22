from datetime import timedelta

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Notification, Subscription, SubscriptionAssignment, SubscriptionSettings
from core.subscription_alerts import check_subscription_alerts
from core.test_subscriptions import create_role, create_user, subscription_payload


def make_subscription(**overrides):
    payload = {
        key: value
        for key, value in subscription_payload().items()
        if key not in {"start_date", "expiry_date"}
    }
    payload.update(overrides)
    payload.setdefault("start_date", timezone.localdate())
    payload.setdefault("expiry_date", timezone.localdate() + timedelta(days=30))
    return Subscription.objects.create(**payload)


class SubscriptionSeatAssignmentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager_role = create_role(
            "SEAT_MANAGER", view=True, add=True, edit=True, delete=True
        )
        self.viewer_role = create_role("SEAT_VIEWER", view=True)
        self.manager = create_user("seat-manager@example.com", self.manager_role.slug)
        self.viewer = create_user("seat-viewer@example.com", self.viewer_role.slug)
        self.member = create_user("seat-member@example.com", self.viewer_role.slug)
        self.other_member = create_user("seat-other@example.com", self.viewer_role.slug)
        self.subscription = make_subscription(seats_total=2)
        self.client.force_authenticate(self.manager)

    def assign_url(self, subscription=None):
        return reverse(
            "subscription-assign-seat", args=[(subscription or self.subscription).pk]
        )

    def revoke_url(self, user, subscription=None):
        return reverse(
            "subscription-revoke-seat",
            args=[(subscription or self.subscription).pk, user.pk],
        )

    def detail_url(self, subscription=None):
        return reverse(
            "subscription-detail", args=[(subscription or self.subscription).pk]
        )

    def test_assign_consumes_a_seat(self):
        response = self.client.post(
            self.assign_url(), {"user_id": self.member.pk}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["user_email"], self.member.email)
        self.assertTrue(response.data["is_active"])
        self.assertEqual(response.data["assigned_by"], self.manager.pk)

        detail = self.client.get(self.detail_url())
        self.assertEqual(detail.data["seats_used"], 1)
        self.assertEqual(detail.data["seats_available"], 1)
        self.assertEqual(detail.data["seats_usage_pct"], 50.0)

    def test_assign_requires_a_user_id(self):
        response = self.client.post(self.assign_url(), {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_assign_rejects_an_unknown_user(self):
        response = self.client.post(
            self.assign_url(), {"user_id": 999999}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_assign_is_rejected_when_no_seats_remain(self):
        for user in (self.member, self.other_member):
            self.assertEqual(
                self.client.post(
                    self.assign_url(), {"user_id": user.pk}, format="json"
                ).status_code,
                status.HTTP_201_CREATED,
            )
        third = create_user("seat-third@example.com", self.viewer_role.slug)
        response = self.client.post(
            self.assign_url(), {"user_id": third.pk}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("No seats available", response.data["detail"])

    def test_duplicate_active_assignment_is_rejected(self):
        self.client.post(self.assign_url(), {"user_id": self.member.pk}, format="json")
        response = self.client.post(
            self.assign_url(), {"user_id": self.member.pk}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            SubscriptionAssignment.objects.filter(
                subscription=self.subscription, is_active=True
            ).count(),
            1,
        )

    def test_database_constraint_blocks_a_duplicate_active_seat(self):
        SubscriptionAssignment.objects.create(
            subscription=self.subscription, user=self.member
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                SubscriptionAssignment.objects.create(
                    subscription=self.subscription, user=self.member
                )

    def test_revoked_seats_free_capacity_and_allow_reassignment(self):
        self.client.post(self.assign_url(), {"user_id": self.member.pk}, format="json")
        response = self.client.post(self.revoke_url(self.member), format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        assignment = SubscriptionAssignment.objects.get(
            subscription=self.subscription, user=self.member
        )
        self.assertFalse(assignment.is_active)
        self.assertIsNotNone(assignment.revoked_date)

        self.assertEqual(self.subscription.seats_used, 0)
        self.assertEqual(self.subscription.seats_available, 2)

        # The partial unique constraint only covers active rows, so the same
        # user can take a seat again after being revoked.
        response = self.client.post(
            self.assign_url(), {"user_id": self.member.pk}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_revoke_without_an_active_seat_is_a_404(self):
        response = self.client.post(self.revoke_url(self.member), format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unlimited_seats_never_block_assignment(self):
        unlimited = make_subscription(name="Unlimited", seats_total=None)
        for index in range(3):
            user = create_user(f"unlimited-{index}@example.com", self.viewer_role.slug)
            self.assertEqual(
                self.client.post(
                    self.assign_url(unlimited), {"user_id": user.pk}, format="json"
                ).status_code,
                status.HTTP_201_CREATED,
            )
        self.assertIsNone(unlimited.seats_available)
        self.assertEqual(unlimited.seats_usage_pct, 0)

    def test_zero_seats_reports_no_capacity(self):
        zero = make_subscription(name="Zero seats", seats_total=0)
        self.assertEqual(zero.seats_available, 0)
        self.assertEqual(zero.seats_usage_pct, 0)
        response = self.client.post(
            self.assign_url(zero), {"user_id": self.member.pk}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_assignments_list_shows_revoked_seats_after_active_ones(self):
        self.client.post(self.assign_url(), {"user_id": self.member.pk}, format="json")
        self.client.post(
            self.assign_url(), {"user_id": self.other_member.pk}, format="json"
        )
        self.client.post(self.revoke_url(self.member), format="json")

        response = self.client.get(
            reverse("subscription-list-assignments", args=[self.subscription.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [row["user_email"] for row in response.data],
            [self.other_member.email, self.member.email],
        )

    def test_deleting_a_subscription_with_active_seats_is_blocked(self):
        self.client.post(self.assign_url(), {"user_id": self.member.pk}, format="json")
        response = self.client.delete(self.detail_url())
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Subscription.objects.filter(pk=self.subscription.pk).exists())

        self.client.post(self.revoke_url(self.member), format="json")
        response = self.client.delete(self.detail_url())
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_seat_actions_follow_the_subscriptions_role_map(self):
        self.client.force_authenticate(self.viewer)
        self.assertEqual(
            self.client.post(
                self.assign_url(), {"user_id": self.member.pk}, format="json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(self.revoke_url(self.member), format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )
        # Viewers may still read the roster.
        self.assertEqual(
            self.client.get(
                reverse("subscription-list-assignments", args=[self.subscription.pk])
            ).status_code,
            status.HTTP_200_OK,
        )


class SeatNotificationIsolationTests(TestCase):
    """Seat messages must survive the subscription alert reconciler.

    `_retire_all_unread_notifications` deletes every unread notification typed
    "SUBSCRIPTION" with no link filter, so seat notifications use their own
    type. This is a regression guard for that collision.
    """

    def setUp(self):
        self.client = APIClient()
        self.manager_role = create_role(
            "SEAT_NOTIFY_MANAGER", view=True, add=True, edit=True, delete=True
        )
        self.manager = create_user("notify-manager@example.com", self.manager_role.slug)
        self.member = create_user("notify-member@example.com", self.manager_role.slug)
        self.subscription = make_subscription(seats_total=5, owner=self.manager)
        self.client.force_authenticate(self.manager)

    def test_assignment_creates_a_seat_typed_notification(self):
        self.client.post(
            reverse("subscription-assign-seat", args=[self.subscription.pk]),
            {"user_id": self.member.pk},
            format="json",
        )
        notification = Notification.objects.get(user=self.member)
        self.assertEqual(notification.notification_type, "SUBSCRIPTION_SEAT")
        self.assertEqual(notification.link, f"/subscriptions/{self.subscription.pk}")

    def test_disabling_alerts_does_not_delete_seat_notifications(self):
        self.client.post(
            reverse("subscription-assign-seat", args=[self.subscription.pk]),
            {"user_id": self.member.pk},
            format="json",
        )
        self.assertEqual(
            Notification.objects.filter(notification_type="SUBSCRIPTION_SEAT").count(), 1
        )

        settings = SubscriptionSettings.get_solo()
        settings.notifications_enabled = False
        settings.save(update_fields=["notifications_enabled"])
        check_subscription_alerts()

        self.assertEqual(
            Notification.objects.filter(notification_type="SUBSCRIPTION_SEAT").count(),
            1,
            "Seat notifications were retired along with subscription alerts.",
        )

    def test_revocation_notifies_the_former_seat_holder(self):
        self.client.post(
            reverse("subscription-assign-seat", args=[self.subscription.pk]),
            {"user_id": self.member.pk},
            format="json",
        )
        Notification.objects.all().delete()
        self.client.post(
            reverse("subscription-revoke-seat", args=[self.subscription.pk, self.member.pk]),
            format="json",
        )
        notification = Notification.objects.get(user=self.member)
        self.assertIn("revoked", notification.message)
        self.assertEqual(notification.notification_type, "SUBSCRIPTION_SEAT")

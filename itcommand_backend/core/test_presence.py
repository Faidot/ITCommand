"""Sign-in auditing and last-seen presence.

Two things were missing: nothing recorded that anybody had signed in or out,
and there was no way to answer "who is using this right now". Presence here is
deliberately "last seen" rather than a live connection — JWT sessions are
stateless, so a held-open socket is not something this deployment has.
"""
from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core.models import AuditLog, User
from core.test_helpers import create_role, create_user


class SignInAuditTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user("signin@example.invalid", "SUPERADMIN")
        self.user.set_password("correct-horse")
        self.user.save()
        self.url = reverse("auth_login")

    def rows(self, action):
        return AuditLog.objects.filter(action=action)

    def test_a_successful_sign_in_is_recorded(self):
        response = self.client.post(
            self.url, {"email": self.user.email, "password": "correct-horse"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        entry = self.rows("LOGIN").get()
        self.assertEqual(entry.user, self.user)
        self.assertEqual(entry.changes["email"], self.user.email)
        self.assertIsNotNone(entry.ip_address)

    def test_a_failed_sign_in_is_recorded_without_a_user(self):
        """The attempt worth auditing most is the one with nobody to blame."""
        response = self.client.post(
            self.url, {"email": self.user.email, "password": "wrong"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        entry = self.rows("LOGIN_FAILED").get()
        self.assertIsNone(entry.user)
        self.assertEqual(entry.changes["email"], self.user.email)

    def test_a_password_never_reaches_the_audit_log(self):
        self.client.post(
            self.url, {"email": self.user.email, "password": "correct-horse"}, format="json"
        )
        self.client.post(
            self.url, {"email": self.user.email, "password": "hunter2"}, format="json"
        )
        for entry in AuditLog.objects.all():
            self.assertNotIn("correct-horse", str(entry.changes))
            self.assertNotIn("hunter2", str(entry.changes))

    def test_an_inactive_account_is_refused_and_recorded(self):
        """Refused as an ordinary bad login, and that is the better answer.

        Django's ModelBackend rejects an inactive user inside `authenticate`,
        so LoginView's own `is_active` check never runs — it is unreachable
        code. The visible result is a plain 401 rather than "this account is
        inactive", which is preferable anyway: it does not confirm to a
        stranger that the account exists. The attempt is still audited.
        """
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])

        response = self.client.post(
            self.url, {"email": self.user.email, "password": "correct-horse"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.rows("LOGIN_FAILED").get().changes["email"], self.user.email)
        self.assertFalse(self.rows("LOGIN").exists())

    def test_signing_out_is_recorded_and_ends_the_session(self):
        login = self.client.post(
            self.url, {"email": self.user.email, "password": "correct-horse"}, format="json"
        )
        self.client.force_authenticate(self.user)
        response = self.client.post(
            reverse("auth_logout"), {"refresh": login.data["refresh"]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_205_RESET_CONTENT)

        entry = self.rows("LOGOUT").get()
        self.assertEqual(entry.user, self.user)
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.last_logout_at)
        self.assertFalse(self.user.is_online, "signing out is not still being online")


class PresenceModelTests(TestCase):
    def setUp(self):
        self.user = create_user("seen@example.invalid", "SUPERADMIN")

    def test_a_new_user_is_not_online(self):
        self.assertFalse(self.user.is_online)

    def test_touching_marks_them_online(self):
        self.assertTrue(self.user.touch_seen())
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_online)

    def test_touching_again_immediately_does_not_write(self):
        """One write per user per minute, not one per request."""
        self.user.touch_seen()
        self.user.refresh_from_db()
        first = self.user.last_seen_at

        self.assertFalse(self.user.touch_seen(), "should have been throttled")
        self.user.refresh_from_db()
        self.assertEqual(self.user.last_seen_at, first)

    def test_a_stale_last_seen_is_refreshed(self):
        User.objects.filter(pk=self.user.pk).update(
            last_seen_at=timezone.now() - timedelta(minutes=5)
        )
        self.user.refresh_from_db()
        self.assertTrue(self.user.touch_seen())

    def test_going_quiet_takes_them_offline(self):
        User.objects.filter(pk=self.user.pk).update(
            last_seen_at=timezone.now() - timedelta(seconds=User.ONLINE_WINDOW_SECONDS + 60)
        )
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_online)

    def test_signing_out_beats_a_recent_last_seen(self):
        self.user.touch_seen(force=True)
        self.user.mark_signed_out()
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_online)

    def test_presence_writes_only_its_own_columns(self):
        """A presence ping must not clobber a concurrent edit to the same row."""
        self.user.full_name = "Stale In Memory"
        User.objects.filter(pk=self.user.pk).update(full_name="Changed Elsewhere")

        self.user.touch_seen(force=True)

        self.user.refresh_from_db()
        self.assertEqual(self.user.full_name, "Changed Elsewhere")


class ActiveUsersEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.superadmin = create_user("presence-super@example.invalid", "SUPERADMIN")
        self.client.force_authenticate(self.superadmin)
        self.url = reverse("active_users")

    def test_it_lists_who_is_online(self):
        other = create_user("online@example.invalid", create_role("ONLINE", view=True).slug)
        other.touch_seen(force=True)

        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        emails = [row["email"] for row in response.data["online"]]
        self.assertIn("online@example.invalid", emails)
        self.assertEqual(response.data["window_seconds"], User.ONLINE_WINDOW_SECONDS)

    def test_someone_who_signed_out_is_not_online(self):
        other = create_user("gone@example.invalid", create_role("GONE", view=True).slug)
        other.touch_seen(force=True)
        other.mark_signed_out()

        response = self.client.get(self.url)
        emails = [row["email"] for row in response.data["online"]]
        self.assertNotIn("gone@example.invalid", emails)

    def test_a_stale_user_appears_under_recent_not_online(self):
        other = create_user("stale@example.invalid", create_role("STALE", view=True).slug)
        User.objects.filter(pk=other.pk).update(
            last_seen_at=timezone.now() - timedelta(hours=2)
        )

        response = self.client.get(self.url)
        self.assertNotIn(
            "stale@example.invalid", [r["email"] for r in response.data["online"]]
        )
        self.assertIn(
            "stale@example.invalid", [r["email"] for r in response.data["recent"]]
        )

    def test_a_non_superadmin_cannot_see_who_is_online(self):
        """Who is at their desk is not broadly readable."""
        client = APIClient()
        client.force_authenticate(
            create_user("nosy-presence@example.invalid", create_role("NOSY_P", view=True).slug)
        )
        self.assertEqual(client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)


class LastSeenMiddlewareTests(TestCase):
    def test_an_authenticated_request_updates_last_seen(self):
        user = create_user("mw@example.invalid", "SUPERADMIN")
        self.assertIsNone(user.last_seen_at)

        client = APIClient()
        client.force_authenticate(user)
        client.get(reverse("app_settings"))

        user.refresh_from_db()
        self.assertIsNotNone(user.last_seen_at)
        self.assertTrue(user.is_online)

    def test_an_anonymous_request_records_nothing(self):
        client = APIClient()
        response = client.get(reverse("app_settings"))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(User.objects.filter(last_seen_at__isnull=False).exists())

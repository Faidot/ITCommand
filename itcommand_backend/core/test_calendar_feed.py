from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core import rbac
from core.calendar_feed import build_ics
from core.models import CalendarFeedToken, Integration, Role, Service
from core.test_estate_api import make_subscription
from core.test_helpers import create_user


def role_with(slug, **modules):
    permissions = rbac.blank_permissions()
    for module, allowed in modules.items():
        permissions[module] = {
            "view": allowed, "add": False, "edit": False, "delete": False
        }
    return Role.objects.create(slug=slug, name=slug.title(), permissions=permissions)


class CalendarFeedTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.role = role_with("CAL_VIEWER", subscriptions=True, estate=True)
        self.user = create_user("cal@example.com", self.role.slug)
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate()
        self.subscription = make_subscription(
            name="Figma Org",
            expiry_date=self.today + timedelta(days=20),
        )

    def feed_for(self, user):
        feed, _ = CalendarFeedToken.objects.get_or_create(
            user=user, defaults={"include": CalendarFeedToken.DEFAULT_SOURCES}
        )
        return feed

    # --- document shape --------------------------------------------

    def test_the_feed_is_well_formed_icalendar(self):
        body = build_ics(self.user)
        self.assertTrue(body.startswith("BEGIN:VCALENDAR\r\n"))
        self.assertTrue(body.rstrip().endswith("END:VCALENDAR"))
        self.assertIn("VERSION:2.0", body)
        self.assertEqual(body.count("BEGIN:VEVENT"), body.count("END:VEVENT"))
        self.assertIn("\r\n", body, "iCalendar requires CRLF line endings")

    def test_no_content_line_exceeds_the_75_octet_limit(self):
        make_subscription(
            name="A subscription with a deliberately very long name " * 3,
            expiry_date=self.today + timedelta(days=5),
        )
        for line in build_ics(self.user).split("\r\n"):
            self.assertLessEqual(len(line.encode("utf-8")), 75, line[:60])

    def test_special_characters_are_escaped(self):
        make_subscription(
            name="Comma, semicolon; backslash\\ test",
            expiry_date=self.today + timedelta(days=5),
        )
        body = build_ics(self.user)
        self.assertIn("Comma\\, semicolon\\; backslash\\\\ test", body)

    def test_service_renewals_appear(self):
        """Cancellation-deadline events went with the subscriptions module —
        `Service` has no cancellation window. Renewals are what remains."""
        body = build_ics(self.user)
        self.assertIn("Renews: Figma Org", body)

    def test_a_service_that_does_not_auto_renew_says_so(self):
        make_subscription(
            name="Lapsing domain",
            expiry_date=self.today + timedelta(days=8),
            auto_renew=False,
        )
        self.assertIn("Does NOT auto-renew.", build_ics(self.user))

    def test_every_event_carries_a_day_before_reminder(self):
        body = build_ics(self.user)
        self.assertEqual(body.count("BEGIN:VALARM"), body.count("BEGIN:VEVENT"))
        self.assertIn("TRIGGER:-P1D", body)

    def test_events_far_outside_the_window_are_excluded(self):
        make_subscription(
            name="Ancient", expiry_date=self.today - timedelta(days=400)
        )
        make_subscription(
            name="Distant", expiry_date=self.today + timedelta(days=900)
        )
        body = build_ics(self.user)
        self.assertNotIn("Ancient", body)
        self.assertNotIn("Distant", body)

    # --- scoping ---------------------------------------------------

    def test_the_feed_only_contains_what_the_role_may_view(self):
        blind = create_user("cal-blind@example.com", role_with("CAL_BLIND").slug)
        self.assertNotIn("Figma Org", build_ics(blind))
        self.assertIn("Figma Org", build_ics(self.user))

    def test_deselecting_a_source_removes_it(self):
        self.assertNotIn("Figma Org", build_ics(self.user, sources=["tickets"]))

    # --- endpoint --------------------------------------------------

    def test_the_feed_url_works_without_authentication(self):
        """Calendar clients cannot send a JWT — the token is the credential."""
        feed = self.feed_for(self.user)
        anon = APIClient()
        response = anon.get(reverse("calendar_feed", args=[feed.token]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("text/calendar", response["Content-Type"])
        self.assertIn(b"BEGIN:VCALENDAR", response.content)

    def test_an_unknown_token_is_a_404(self):
        response = APIClient().get(reverse("calendar_feed", args=["not-a-real-token"]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_disabled_feed_stops_serving(self):
        feed = self.feed_for(self.user)
        feed.is_enabled = False
        feed.save()
        response = APIClient().get(reverse("calendar_feed", args=[feed.token]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_inactive_user_stops_serving(self):
        feed = self.feed_for(self.user)
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        response = APIClient().get(reverse("calendar_feed", args=[feed.token]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_rotating_the_token_kills_the_old_url(self):
        feed = self.feed_for(self.user)
        old_token = feed.token
        response = self.client.post(reverse("my_calendar_feed"), {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn(old_token, response.data["url"])

        anon = APIClient()
        self.assertEqual(
            anon.get(reverse("calendar_feed", args=[old_token])).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_one_user_cannot_read_another_users_feed_content(self):
        other = create_user("cal-other@example.com", role_with("CAL_NONE").slug)
        other_feed = self.feed_for(other)
        body = APIClient().get(
            reverse("calendar_feed", args=[other_feed.token])
        ).content.decode()
        self.assertNotIn("Figma Org", body, "feed leaked another user's records")

    def test_access_is_recorded(self):
        feed = self.feed_for(self.user)
        APIClient().get(reverse("calendar_feed", args=[feed.token]))
        feed.refresh_from_db()
        self.assertEqual(feed.access_count, 1)
        self.assertIsNotNone(feed.last_accessed_at)

    def test_settings_endpoint_creates_and_configures_the_feed(self):
        response = self.client.get(reverse("my_calendar_feed"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(".ics", response.data["url"])
        self.assertEqual(len(response.data["available_sources"]), 7)

        response = self.client.patch(
            reverse("my_calendar_feed"),
            {"include": ["subscriptions", "bogus"]},
            format="json",
        )
        self.assertEqual(response.data["include"], ["subscriptions"])

    def test_anonymous_users_cannot_reach_the_settings_endpoint(self):
        self.client.force_authenticate(None)
        response = self.client.get(reverse("my_calendar_feed"))
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )


class NotificationProviderTests(TestCase):
    def test_each_provider_gets_its_own_payload_shape(self):
        from core.notify import _payload_for

        slack = _payload_for("SLACK", title="T", message="M", url="http://x")
        self.assertIn("text", slack)

        discord = _payload_for("DISCORD", title="T", message="M")
        self.assertIn("content", discord)

        teams = _payload_for("TEAMS", title="T", message="M")
        self.assertEqual(teams["@type"], "MessageCard")

        generic = _payload_for("WEBHOOK", title="T", message="M", url="http://x")
        self.assertEqual(generic["title"], "T")
        self.assertIn("timestamp", generic)

    def test_a_delivery_failure_is_reported_not_raised(self):
        from core.notify import send_to_provider

        integration = Integration.objects.create(provider="SLACK", is_enabled=True)
        integration.set_api_key("http://127.0.0.1:9/nothing-listening")
        integration.save()

        ok, detail = send_to_provider(integration, title="T", message="M")
        self.assertFalse(ok)
        self.assertTrue(detail)

    def test_broadcast_skips_disabled_integrations(self):
        from core.notify import broadcast

        Integration.objects.create(provider="SLACK", is_enabled=False)
        self.assertEqual(broadcast("Title", "Message"), {})

    def test_a_missing_webhook_url_is_reported(self):
        from core.notify import send_to_provider

        integration = Integration.objects.create(provider="DISCORD", is_enabled=True)
        ok, detail = send_to_provider(integration, title="T")
        self.assertFalse(ok)
        self.assertIn("No webhook URL", detail)

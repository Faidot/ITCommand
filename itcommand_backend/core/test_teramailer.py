"""The Mails tab and the webmail handoff.

TeraMailer only verifies that the caller is IT Command — it has no idea what a
superadmin is. So the permission checks here are not belt-and-braces; they are
the only thing standing between an ordinary user and the mail server's
settings.
"""
import json
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework_simplejwt.tokens import RefreshToken

from core import mail_bridge, teramailer
from core.models import User

#: IT Command runs its suite against the real settings module, so whatever is
#: in .env is what tests see. Any test that asserts the *unconfigured* state
#: has to force it explicitly, or it passes only on a machine where TeraMailer
#: has not been wired up yet — which is nobody's machine after today.
NOT_CONNECTED = dict(TERAMAILER_URL="", TERAMAILER_SHARED_SECRET="")

CONNECTED = dict(
    TERAMAILER_URL="http://127.0.0.1:5000",
    TERAMAILER_SHARED_SECRET="a-shared-secret",
    TERAMAILER_PUBLIC_URL="http://localhost:5000",
)


class SigningTests(TestCase):
    @override_settings(**CONNECTED)
    def test_the_signature_covers_the_exact_body(self):
        """Re-serialising the payload would break the signature the moment key
        order differed, which is why both sides sign the raw bytes."""
        seen = {}

        class FakeResponse:
            status = 200
            def read(self): return b'{"ok":true}'
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def capture(request, timeout=None):
            seen["headers"] = dict(request.headers)
            seen["body"] = request.data
            return FakeResponse()

        with mock.patch("urllib.request.urlopen", capture):
            teramailer._request("POST", "/api/admin/config/app", {"b": 2, "a": 1})

        # Header names are title-cased by urllib.
        self.assertIn("X-signature", seen["headers"])
        self.assertEqual(seen["headers"]["X-service"], "itcommand")
        self.assertEqual(json.loads(seen["body"]), {"b": 2, "a": 1})

    @override_settings(**NOT_CONNECTED)
    def test_it_refuses_to_call_when_not_configured(self):
        with self.assertRaises(teramailer.TeraMailerError) as ctx:
            teramailer.get_config()
        self.assertIn("not configured", str(ctx.exception))

    @override_settings(**CONNECTED)
    def test_an_unreachable_service_is_reported_as_such(self):
        import urllib.error
        with mock.patch("urllib.request.urlopen",
                        side_effect=urllib.error.URLError("refused")):
            with self.assertRaises(teramailer.TeraMailerError) as ctx:
                teramailer.get_config()
        self.assertIn("not reachable", str(ctx.exception))


class PermissionTests(TestCase):
    def setUp(self):
        self.superadmin = User.objects.create_user(
            email="tmsuper@terafort.com", password="pw12345!",
            full_name="Super", role="SUPERADMIN")
        self.admin = User.objects.create_user(
            email="tmadmin@terafort.com", password="pw12345!",
            full_name="Admin", role="ADMIN")
        self.viewer = User.objects.create_user(
            email="tmviewer@terafort.com", password="pw12345!",
            full_name="Viewer", role="VIEWER")

    def _as(self, user):
        token = RefreshToken.for_user(user).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    @override_settings(**NOT_CONNECTED)
    def test_only_a_superadmin_may_read_the_settings(self):
        """An admin can manage mailboxes but not the mail server itself.

        Forced unconfigured so the 200 comes from the permission check rather
        than from TeraMailer happening to answer.
        """
        for user in (self.admin, self.viewer):
            self._as(user)
            self.assertEqual(self.client.get(reverse("mail_settings")).status_code, 403)
        self._as(self.superadmin)
        self.assertEqual(self.client.get(reverse("mail_settings")).status_code, 200)

    def test_only_a_superadmin_may_write_them(self):
        self._as(self.admin)
        r = self.client.post(reverse("mail_settings"),
                             {"section": "app", "values": {"name": "X"}},
                             content_type="application/json")
        self.assertEqual(r.status_code, 403)

    def test_sessions_and_logs_are_superadmin_only(self):
        self._as(self.admin)
        for name in ("mail_settings_sessions", "mail_settings_logs"):
            self.assertEqual(self.client.get(reverse(name)).status_code, 403)


class SettingsApiTests(TestCase):
    def setUp(self):
        self.superadmin = User.objects.create_user(
            email="tms2@terafort.com", password="pw12345!",
            full_name="Super", role="SUPERADMIN")
        token = RefreshToken.for_user(self.superadmin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    @override_settings(**NOT_CONNECTED)
    def test_an_unconfigured_deployment_is_not_an_error(self):
        """A deployment that has not wired this up yet should see setup
        instructions, not a failure."""
        r = self.client.get(reverse("mail_settings"))
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["configured"])
        self.assertIn("ITC_SHARED_SECRET", r.data["detail"])

    @override_settings(**CONNECTED)
    def test_a_dashboard_failure_does_not_blank_the_settings(self):
        """The operator came here to change a setting. Losing the form because
        a stats call failed would be the wrong trade."""
        with mock.patch.object(teramailer, "get_config", return_value={"imap": {}}), \
             mock.patch.object(teramailer, "dashboard",
                               side_effect=teramailer.TeraMailerError("no stats")):
            r = self.client.get(reverse("mail_settings"))
        self.assertEqual(r.status_code, 200)
        self.assertIn("config", r.data)
        self.assertIn("dashboard_error", r.data)

    @override_settings(**CONNECTED)
    def test_an_unknown_section_is_refused(self):
        """This endpoint must not become a way to write arbitrary keys into
        another service's config file."""
        with mock.patch.object(teramailer, "update_section") as write:
            r = self.client.post(reverse("mail_settings"),
                                 {"section": "../../etc", "values": {"a": 1}},
                                 content_type="application/json")
        self.assertEqual(r.status_code, 400)
        write.assert_not_called()

    @override_settings(**CONNECTED)
    def test_a_valid_section_is_written_and_audited_without_the_values(self):
        """A password could sit in any of these sections. The audit row records
        which fields changed, never what they became."""
        with mock.patch.object(teramailer, "update_section",
                               return_value={"host": "mail.terafort.org"}):
            r = self.client.post(
                reverse("mail_settings"),
                {"section": "imap", "values": {"host": "mail.terafort.org",
                                               "password": "hunter2"}},
                content_type="application/json")
        self.assertEqual(r.status_code, 200)

        from core.models import AuditLog
        row = AuditLog.objects.filter(action="MAIL_SETTINGS_CHANGED").first()
        self.assertIsNotNone(row)
        self.assertNotIn("hunter2", json.dumps(row.changes))
        self.assertIn("password", row.changes["fields"])

    @override_settings(**CONNECTED)
    def test_a_failed_connection_test_is_a_result_not_an_error(self):
        with mock.patch.object(teramailer, "test_imap",
                               return_value=(False, "connection refused")):
            r = self.client.post(reverse("mail_settings_test"), {"target": "imap"},
                                 content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["ok"])
        self.assertIn("refused", r.data["message"])

    @override_settings(**CONNECTED)
    def test_an_unknown_test_target_is_refused(self):
        r = self.client.post(reverse("mail_settings_test"), {"target": "telnet"},
                             content_type="application/json")
        self.assertEqual(r.status_code, 400)


@override_settings(MAIL_AUTH_ENABLED=True, **CONNECTED)
class HandoffTests(TestCase):
    """Open Mailbox now hands the user to TeraMailer."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="kofi@terafort.org", password="x", full_name="Kofi")
        self.user.auth_source = User.AUTH_MAILBOX
        self.user.save(update_fields=["auth_source"])
        token = RefreshToken.for_user(self.user).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.client.cookies["itc_mail_sid"] = "sid-abc"

    def _open(self):
        return self.client.post(reverse("auth_open_mailbox"))

    def test_the_stored_credential_is_swapped_for_a_ticket(self):
        seen = {}
        with mock.patch.object(mail_bridge, "read_mail_session",
                               return_value={"mailbox_address": "kofi@terafort.org",
                                             "credential": "their-real-password"}), \
             mock.patch.object(teramailer, "issue_sso_ticket",
                               side_effect=lambda **kw: seen.update(kw) or "tok"):
            r = self._open()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(seen["email"], "kofi@terafort.org")
        self.assertEqual(seen["password"], "their-real-password")
        self.assertEqual(r.json()["ticket"], "tok")

    def test_the_password_never_reaches_the_browser(self):
        with mock.patch.object(mail_bridge, "read_mail_session",
                               return_value={"mailbox_address": "kofi@terafort.org",
                                             "credential": "their-real-password"}), \
             mock.patch.object(teramailer, "issue_sso_ticket", return_value="tok"):
            r = self._open()
        self.assertNotIn("their-real-password", json.dumps(r.json()))

    def test_no_live_session_asks_for_a_fresh_sign_in(self):
        with mock.patch.object(mail_bridge, "read_mail_session", return_value=None):
            r = self._open()
        self.assertEqual(r.status_code, 409)
        self.assertTrue(r.json()["reauth_required"])

    def test_a_changed_mailbox_password_is_reported_plainly(self):
        with mock.patch.object(mail_bridge, "read_mail_session",
                               return_value={"mailbox_address": "kofi@terafort.org",
                                             "credential": "stale"}), \
             mock.patch.object(teramailer, "issue_sso_ticket",
                               side_effect=teramailer.TeraMailerError(
                                   "The mail server rejected the stored credential.")):
            r = self._open()
        self.assertEqual(r.status_code, 503)
        self.assertIn("rejected the stored credential", r.json()["detail"])

    def test_a_local_account_has_no_mailbox_to_open(self):
        local = User.objects.create_user(
            email="contractor@terafort.com", password="pw12345!", full_name="C")
        token = RefreshToken.for_user(local).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token
        self.assertEqual(self._open().status_code, 403)

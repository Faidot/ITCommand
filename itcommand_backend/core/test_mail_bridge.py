"""IT Command's half of the mail handoff.

Two things matter most here and neither is about the happy path:

  * with MAIL_AUTH_ENABLED off, nothing changes. The flag is the rollback
    path, so "off means identical behaviour" is the test that lets us ship.
  * the wire format matches the mail app's. The two services deploy
    independently; if these constants drift, every handoff fails closed.
"""
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse

from core import mail_bridge
from core.models import User


class FlagOffTests(TestCase):
    """The rollback path. This is what `MAIL_AUTH_ENABLED=false` must mean."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="local@terafort.com", password="pw12345!", full_name="Local")

    @override_settings(MAIL_AUTH_ENABLED=False)
    def test_login_takes_the_original_path(self):
        r = self.client.post(reverse("auth_login"),
                             {"email": "local@terafort.com", "password": "pw12345!"},
                             content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.json())
        self.assertNotIn("mfa_required", r.json())

    @override_settings(MAIL_AUTH_ENABLED=False)
    def test_mailbox_user_still_uses_the_local_path_when_the_flag_is_off(self):
        """Flipping a user to MAILBOX must do nothing until the flag is on --
        otherwise the migration that sets auth_source would be a live change."""
        self.user.auth_source = User.AUTH_MAILBOX
        self.user.save(update_fields=["auth_source"])
        with mock.patch.object(mail_bridge, "remote_login") as remote:
            r = self.client.post(reverse("auth_login"),
                                 {"email": "local@terafort.com", "password": "pw12345!"},
                                 content_type="application/json")
        remote.assert_not_called()
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.json())

    @override_settings(MAIL_AUTH_ENABLED=False)
    def test_the_new_routes_are_invisible(self):
        self.client.force_authenticate = None
        self.assertEqual(
            self.client.post(reverse("auth_mailbox_mfa"), {}, content_type="application/json")
            .status_code, 404)


@override_settings(MAIL_AUTH_ENABLED=True)
class MailboxLoginTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="alice@terafort.com", password="unused", full_name="Alice")
        self.user.auth_source = User.AUTH_MAILBOX
        self.user.save(update_fields=["auth_source"])

    def _login(self, password="correct horse"):
        return self.client.post(reverse("auth_login"),
                                {"email": "alice@terafort.com", "password": password},
                                content_type="application/json")

    def test_dovecot_success_returns_a_challenge_not_a_token(self):
        with mock.patch.object(mail_bridge, "remote_login",
                               return_value=(200, {"ticket": "t-123",
                                                   "enrolment_required": False})):
            r = self._login()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["mfa_required"])
        self.assertNotIn("access", r.json(), "a JWT was issued before the second factor")

    def test_dovecot_rejection_is_401(self):
        with mock.patch.object(mail_bridge, "remote_login", return_value=(401, {})):
            self.assertEqual(self._login("wrong").status_code, 401)

    def test_mail_service_outage_is_503_not_401(self):
        """An outage reported as a bad password sends everyone off changing
        passwords that were fine."""
        with mock.patch.object(mail_bridge, "remote_login",
                               side_effect=mail_bridge.MailBridgeError("down")):
            r = self._login()
        self.assertEqual(r.status_code, 503)

    def test_local_password_is_never_consulted_for_a_mailbox_user(self):
        """The user row still carries a usable hash during rollout. It must
        not be a way in -- there is no fallback between the two authorities."""
        self.user.set_password("the-old-local-password")
        self.user.save(update_fields=["password"])
        with mock.patch.object(mail_bridge, "remote_login", return_value=(401, {})):
            r = self._login("the-old-local-password")
        self.assertEqual(r.status_code, 401,
                         "a mailbox user signed in with their stale local hash")

    def test_inactive_account_is_refused_before_dovecot_is_asked(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        with mock.patch.object(mail_bridge, "remote_login") as remote:
            r = self._login()
        self.assertEqual(r.status_code, 403)
        remote.assert_not_called()

    def test_mfa_success_issues_the_jwt_and_an_httponly_sid_cookie(self):
        with mock.patch.object(mail_bridge, "remote_mfa",
                               return_value=(200, {"sid": "sid-abc"})):
            r = self.client.post(reverse("auth_mailbox_mfa"),
                                 {"ticket": "t", "code": "123456",
                                  "email": "alice@terafort.com"},
                                 content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.json())
        cookie = r.cookies["itc_mail_sid"]
        self.assertTrue(cookie["httponly"], "the mail sid is readable by script")
        self.assertNotIn("sid", r.json(), "the sid leaked into the response body")

    def test_mfa_for_an_unknown_user_destroys_the_orphaned_mail_session(self):
        with mock.patch.object(mail_bridge, "remote_mfa",
                               return_value=(200, {"sid": "sid-xyz"})), \
             mock.patch.object(mail_bridge, "destroy_mail_session") as destroy:
            r = self.client.post(reverse("auth_mailbox_mfa"),
                                 {"ticket": "t", "code": "123456",
                                  "email": "nobody@terafort.com"},
                                 content_type="application/json")
        self.assertEqual(r.status_code, 401)
        destroy.assert_called_once_with("sid-xyz")


@override_settings(MAIL_AUTH_ENABLED=True)
class OpenMailboxTests(TestCase):
    def setUp(self):
        self.mailbox_user = User.objects.create_user(
            email="alice@terafort.com", password="x", full_name="Alice")
        self.mailbox_user.auth_source = User.AUTH_MAILBOX
        self.mailbox_user.save(update_fields=["auth_source"])
        self.local_user = User.objects.create_user(
            email="contractor@terafort.com", password="pw12345!", full_name="Contractor")

    def _auth(self, user):
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(user).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    def test_ticket_is_returned_in_the_body_not_a_redirect(self):
        """A redirect would put the ticket in a URL, which is what the form
        POST exists to avoid."""
        self._auth(self.mailbox_user)
        with mock.patch.object(mail_bridge, "mint_handoff", return_value="tok.sig"):
            r = self.client.post(reverse("auth_open_mailbox"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["ticket"], "tok.sig")
        self.assertNotIn("Location", r)

    def test_a_local_account_has_no_mailbox_to_open(self):
        self._auth(self.local_user)
        with mock.patch.object(mail_bridge, "mint_handoff") as mint:
            r = self.client.post(reverse("auth_open_mailbox"))
        self.assertEqual(r.status_code, 403)
        mint.assert_not_called()

    def test_expired_mail_session_asks_for_re_authentication(self):
        self._auth(self.mailbox_user)
        with mock.patch.object(mail_bridge, "mint_handoff",
                               side_effect=mail_bridge.MailBridgeError("no session")):
            r = self.client.post(reverse("auth_open_mailbox"))
        self.assertEqual(r.status_code, 409)
        self.assertTrue(r.json()["reauth_required"])

    def test_unauthenticated_callers_get_nothing(self):
        self.client.defaults.pop("HTTP_AUTHORIZATION", None)
        self.assertIn(self.client.post(reverse("auth_open_mailbox")).status_code, (401, 403))


class WireFormatTests(TestCase):
    """These constants are duplicated in mailcore. If they drift, every
    handoff fails closed -- correct, but still an outage. Pin them."""

    def test_pinned_values(self):
        self.assertEqual(mail_bridge.NONCE_BYTES, 12)
        self.assertEqual(mail_bridge.KEY_BYTES, 32)
        self.assertEqual(mail_bridge.SALT_BYTES, 16)
        self.assertEqual(mail_bridge.SESSION_AAD, b"tfm-session-v1")
        self.assertEqual(mail_bridge.DEK_AAD, b"tfm-dek-v1")
        self.assertEqual(mail_bridge.SESSION_PREFIX, "sess:")
        self.assertEqual(mail_bridge.HANDOFF_PREFIX, "handoff:")
        self.assertEqual(mail_bridge.AUDIENCE_MAIL, "tfm-mail")

    def test_argon2_parameters_match_the_mail_app(self):
        self.assertEqual(mail_bridge.ARGON2_MEMORY_KIB, 64 * 1024)
        self.assertEqual(mail_bridge.ARGON2_ITERATIONS, 3)
        self.assertEqual(mail_bridge.ARGON2_LANES, 4)

    @override_settings(MAIL_SESSION_SEAL_KEY="0123456789abcdef0123456789abcdef")
    def test_seal_round_trip_and_credential_is_not_in_the_clear(self):
        blob = mail_bridge._seal(b'{"credential":"hunter2"}', mail_bridge.SESSION_AAD)
        self.assertNotIn(b"hunter2", blob)
        self.assertEqual(mail_bridge._unseal(blob, mail_bridge.SESSION_AAD),
                         b'{"credential":"hunter2"}')

    @override_settings(MAIL_SESSION_SEAL_KEY="too-short")
    def test_a_bad_seal_key_is_refused(self):
        with self.assertRaises(mail_bridge.MailBridgeError):
            mail_bridge._seal(b"x", mail_bridge.SESSION_AAD)

    @override_settings(MAIL_SESSION_SEAL_KEY="0123456789abcdef0123456789abcdef")
    def test_the_wrong_aad_will_not_open_a_session_blob(self):
        blob = mail_bridge._seal(b"x", mail_bridge.SESSION_AAD)
        with self.assertRaises(mail_bridge.MailBridgeError):
            mail_bridge._unseal(blob, mail_bridge.DEK_AAD)

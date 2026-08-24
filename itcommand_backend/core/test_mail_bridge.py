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


@override_settings(MAIL_AUTH_ENABLED=True)
class SelfPasswordChangeTests(TestCase):
    """Changing your own password when Dovecot owns it.

    There is only one password, so this is not "change two things in step" —
    it is one change that both systems see, because IT Command holds no hash
    for a mailbox account and asks Dovecot at every sign-in.
    """

    def setUp(self):
        self.local = User.objects.create_user(
            email="local2@terafort.com", password="OldLocalPw1!", full_name="Local")
        self.mailbox_user = User.objects.create_user(
            email="kofi@terafort.com", password="unused", full_name="Kofi")
        self.mailbox_user.auth_source = User.AUTH_MAILBOX
        self.mailbox_user.set_unusable_password()
        self.mailbox_user.save()

    def _as(self, user):
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(user).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

    def _change(self, old, new):
        return self.client.post(reverse("auth_password"),
                                {"old_password": old, "new_password": new},
                                content_type="application/json")

    def test_a_local_account_still_changes_its_django_password(self):
        self._as(self.local)
        r = self._change("OldLocalPw1!", "BrandNewPw2!")
        self.assertEqual(r.status_code, 200)
        self.local.refresh_from_db()
        self.assertTrue(self.local.check_password("BrandNewPw2!"))

    def test_a_mailbox_account_is_verified_against_dovecot_not_a_hash(self):
        """It has no hash to check, so the only authority is the mail server."""
        self._as(self.mailbox_user)
        with mock.patch.object(mail_bridge, "imap_check") as check, \
             mock.patch("core.mailbox_admin.set_password") as write:
            from core.models.mailboxes import ManagedMailbox
            ManagedMailbox.objects.create(address="kofi@terafort.com",
                                          domain="terafort.com")
            r = self._change("TheirRealMailboxPw1!", "ANewMailboxPw2!")
        self.assertEqual(r.status_code, 200)
        check.assert_called_once()
        write.assert_called_once()

    def test_a_wrong_current_password_is_rejected_by_dovecot(self):
        self._as(self.mailbox_user)
        with mock.patch.object(mail_bridge, "imap_check", side_effect=PermissionError):
            r = self._change("WrongOne1!", "ANewMailboxPw2!")
        self.assertEqual(r.status_code, 400)
        self.assertIn("old_password", r.json())

    def test_an_outage_does_not_claim_the_password_was_wrong(self):
        self._as(self.mailbox_user)
        with mock.patch.object(mail_bridge, "imap_check",
                               side_effect=mail_bridge.ImapUnavailable("down")):
            r = self._change("TheirRealMailboxPw1!", "ANewMailboxPw2!")
        self.assertEqual(r.status_code, 503)
        self.assertIn("Nothing has changed", r.json()["detail"])

    def test_the_stale_mail_session_is_ended(self):
        """It still holds the old credential and a key wrapped under the old
        password. Left alone it fails on the next IMAP call with nothing to
        explain why."""
        self._as(self.mailbox_user)
        self.client.cookies["itc_mail_sid"] = "stale-sid"
        with mock.patch.object(mail_bridge, "imap_check"), \
             mock.patch("core.mailbox_admin.set_password"), \
             mock.patch.object(mail_bridge, "destroy_mail_session") as destroy:
            from core.models.mailboxes import ManagedMailbox
            ManagedMailbox.objects.create(address="kofi@terafort.com",
                                          domain="terafort.com")
            r = self._change("TheirRealMailboxPw1!", "ANewMailboxPw2!")
        destroy.assert_called_once_with("stale-sid")
        self.assertTrue(r.json()["mailbox_session_ended"])

    def test_a_missing_mailbox_record_is_reported_rather_than_guessed(self):
        """We never write to an address we have not confirmed exists."""
        self._as(self.mailbox_user)
        with mock.patch.object(mail_bridge, "imap_check"):
            r = self._change("TheirRealMailboxPw1!", "ANewMailboxPw2!")
        self.assertEqual(r.status_code, 409)


@override_settings(MAIL_AUTH_ENABLED=True)
class AdminPasswordResetTests(TestCase):
    """An administrator issuing somebody else a new password.

    For a mailbox account it MUST reach cPanel. Setting a Django hash on an
    account whose hash is unusable hands the administrator a password that
    opens nothing and looks like it worked.
    """

    def setUp(self):
        self.superadmin = User.objects.create_user(
            email="rsuper@terafort.com", password="pw12345!",
            full_name="Super", role="SUPERADMIN")
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(self.superadmin).access_token
        self.client.defaults["HTTP_AUTHORIZATION"] = "Bearer %s" % token

        self.local = User.objects.create_user(
            email="rlocal@terafort.com", password="x", full_name="Local")
        self.mailbox_user = User.objects.create_user(
            email="rkofi@terafort.org", password="x", full_name="Kofi")
        self.mailbox_user.auth_source = User.AUTH_MAILBOX
        self.mailbox_user.set_unusable_password()
        self.mailbox_user.save()

    def _reset(self, user):
        return self.client.post(
            reverse("user-reset-password", kwargs={"pk": user.pk}),
            {}, content_type="application/json")

    def test_a_local_account_gets_a_django_password(self):
        r = self._reset(self.local)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["password_opens"], "IT Command only")
        self.local.refresh_from_db()
        self.assertTrue(self.local.check_password(r.data["temp_password"]))

    def test_a_mailbox_account_is_reset_on_cpanel_not_locally(self):
        from core.models.mailboxes import ManagedMailbox
        ManagedMailbox.objects.create(address="rkofi@terafort.org", domain="terafort.org")
        with mock.patch("core.mailbox_admin.set_password") as write, \
             mock.patch.object(mail_bridge, "destroy_mail_sessions_for", return_value=1):
            r = self._reset(self.mailbox_user)
        self.assertEqual(r.status_code, 200)
        write.assert_called_once()
        self.assertEqual(r.data["password_opens"], "IT Command and the mailbox")
        self.mailbox_user.refresh_from_db()
        self.assertFalse(self.mailbox_user.has_usable_password(),
                         "a local hash was set on a mailbox account")

    def test_the_password_handed_over_is_the_one_written_to_cpanel(self):
        """Handing back a different password than the one set is exactly the
        failure this routing exists to prevent."""
        from core.models.mailboxes import ManagedMailbox
        box = ManagedMailbox.objects.create(address="rkofi@terafort.org",
                                            domain="terafort.org")
        written = {}
        with mock.patch("core.mailbox_admin.set_password",
                        side_effect=lambda b, pw, **kw: written.update(pw=pw)), \
             mock.patch.object(mail_bridge, "destroy_mail_sessions_for", return_value=0):
            r = self._reset(self.mailbox_user)
        self.assertEqual(written["pw"], r.data["temp_password"])

    def test_their_live_mail_session_is_ended(self):
        from core.models.mailboxes import ManagedMailbox
        ManagedMailbox.objects.create(address="rkofi@terafort.org", domain="terafort.org")
        with mock.patch("core.mailbox_admin.set_password"), \
             mock.patch.object(mail_bridge, "destroy_mail_sessions_for") as destroy:
            self._reset(self.mailbox_user)
        destroy.assert_called_once_with("rkofi@terafort.org")

    def test_a_missing_mailbox_record_is_refused_rather_than_guessed(self):
        with mock.patch("core.mailbox_admin.set_password") as write:
            r = self._reset(self.mailbox_user)
        self.assertEqual(r.status_code, 409)
        write.assert_not_called()

    def test_a_cpanel_outage_does_not_report_a_new_password(self):
        from core.models.mailboxes import ManagedMailbox
        from core import mailbox_admin
        ManagedMailbox.objects.create(address="rkofi@terafort.org", domain="terafort.org")
        with mock.patch("core.mailbox_admin.set_password",
                        side_effect=mailbox_admin.MailboxAdminError("unreachable")):
            r = self._reset(self.mailbox_user)
        self.assertEqual(r.status_code, 503)
        self.assertNotIn("temp_password", r.data)

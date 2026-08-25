"""Login, the second factor, and the session's three timers.

IMAP is patched throughout: these tests are about our logic, not Dovecot's.
The one thing they must never do is let a password reach a real server.
"""
from __future__ import annotations

import time
from unittest import mock

from django.conf import settings
from django.test import Client, override_settings

from mailcore import imap_auth, sessions, totp
from mailcore.models import Mailbox

from .base import MailTestCase

GOOD = imap_auth.ImapCapabilities.parse([b"IMAP4REV1", b"IDLE", b"MOVE"])


def _accepts(*_a, **_k):
    return GOOD


def _rejects(*_a, **_k):
    raise PermissionError("nope")


def _unavailable(*_a, **_k):
    raise imap_auth.ImapUnavailable("down")


class LoginTests(MailTestCase):
    def setUp(self):
        super().setUp()
        self.c = Client()

    @mock.patch("mailcore.views.imap_auth.authenticate", _accepts)
    def test_dovecot_success_yields_a_ticket_not_a_session(self):
        r = self.c.post("/api/auth/login",
                        {"email": "alice@terafort.com", "password": "correct horse"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["mfa_required"])
        self.assertIn("ticket", body)
        self.assertNotIn(settings.MAIL_SESSION_COOKIE, r.cookies,
                         "a session cookie was set before the second factor")

    @mock.patch("mailcore.views.imap_auth.authenticate", _rejects)
    def test_bad_password_is_401(self):
        r = self.c.post("/api/auth/login",
                        {"email": "alice@terafort.com", "password": "wrong"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 401)

    @mock.patch("mailcore.views.imap_auth.authenticate", _unavailable)
    def test_an_outage_is_not_reported_as_a_bad_password(self):
        """Conflating these turns an outage into a site-wide 'your credentials
        are invalid' and people start changing passwords that were fine."""
        r = self.c.post("/api/auth/login",
                        {"email": "alice@terafort.com", "password": "correct horse"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 503)
        self.assertNotIn("password", r.json()["detail"].lower().split("your ")[0])

    @mock.patch("mailcore.views.imap_auth.authenticate", _accepts)
    def test_first_login_creates_the_mailbox_and_starts_enrolment(self):
        self.assertFalse(Mailbox.objects.filter(address="new@terafort.com").exists())
        r = self.c.post("/api/auth/login",
                        {"email": "new@terafort.com", "password": "pw"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["enrolment_required"])
        self.assertIn("otpauth_uri", r.json())
        mb = Mailbox.objects.get(address="new@terafort.com")
        self.assertTrue(mb.totp_secret)
        self.assertIsNone(mb.totp_confirmed_at, "enrolment completed without a code")

    @mock.patch("mailcore.views.imap_auth.authenticate", _accepts)
    def test_no_password_is_ever_written_to_the_mailbox_row(self):
        self.c.post("/api/auth/login",
                    {"email": "new@terafort.com", "password": "hunter2"},
                    content_type="application/json")
        mb = Mailbox.objects.get(address="new@terafort.com")
        blob = b"".join([bytes(mb.kek_salt), bytes(mb.wrapped_dek),
                         mb.totp_secret.encode(), str(mb.recovery_code_hashes).encode()])
        self.assertNotIn(b"hunter2", blob)
        self.assertFalse(hasattr(mb, "password"))

    @mock.patch("mailcore.views.imap_auth.authenticate", _accepts)
    def test_password_change_rebuilds_the_cache_instead_of_failing(self):
        from mailcore.models import Message
        self.assertEqual(Message.objects.for_mailbox(self.alice.mailbox).count(), 1)
        gen = self.alice.mailbox.dek_generation
        r = self.c.post("/api/auth/login",
                        {"email": "alice@terafort.com", "password": "a different password"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["cache_rebuilt"])
        self.alice.mailbox.refresh_from_db()
        self.assertEqual(self.alice.mailbox.dek_generation, gen + 1)
        self.assertEqual(Message.objects.for_mailbox(self.alice.mailbox).count(), 0,
                         "unreadable cache should have been discarded")

    def test_missing_fields_are_400(self):
        r = self.c.post("/api/auth/login", {"email": ""}, content_type="application/json")
        self.assertEqual(r.status_code, 400)


class MfaTests(MailTestCase):
    def setUp(self):
        super().setUp()
        self.c = Client()

    def _ticket_for(self, who, password="correct horse"):
        import base64
        return sessions.get_store().create_mfa_ticket({
            "mailbox_id": str(who.mailbox.id),
            "address": who.address,
            "credential": password,
            "dek": base64.b64encode(who.dek).decode("ascii"),
            "ua_hash": "", "ip": "127.0.0.1",
        })

    def test_correct_code_creates_a_session_and_sets_the_cookie(self):
        ticket = self._ticket_for(self.alice)
        code = totp.code_at(self.alice.mailbox.totp_secret)
        r = self.c.post("/api/auth/mfa", {"ticket": ticket, "code": code},
                        content_type="application/json")
        self.assertEqual(r.status_code, 200)
        cookie = r.cookies[settings.MAIL_SESSION_COOKIE]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")

    def test_wrong_code_is_401(self):
        ticket = self._ticket_for(self.alice)
        r = self.c.post("/api/auth/mfa", {"ticket": ticket, "code": "000001"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 401)

    def test_ticket_is_single_use(self):
        ticket = self._ticket_for(self.alice)
        code = totp.code_at(self.alice.mailbox.totp_secret)
        first = self.c.post("/api/auth/mfa", {"ticket": ticket, "code": code},
                            content_type="application/json")
        self.assertEqual(first.status_code, 200)
        second = self.c.post("/api/auth/mfa", {"ticket": ticket, "code": code},
                             content_type="application/json")
        self.assertEqual(second.status_code, 401, "an MFA ticket was replayable")

    def test_unknown_ticket_is_401(self):
        r = self.c.post("/api/auth/mfa", {"ticket": "nonsense", "code": "123456"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 401)

    @override_settings(MAIL_MFA_TICKET_SECONDS=0)
    def test_expired_ticket_is_401(self):
        ticket = self._ticket_for(self.alice)
        time.sleep(0.01)
        r = self.c.post("/api/auth/mfa", {"ticket": ticket, "code": "123456"},
                        content_type="application/json")
        self.assertEqual(r.status_code, 401)

    def test_recovery_code_works_once(self):
        codes = totp.new_recovery_codes(2)
        self.alice.mailbox.recovery_code_hashes = [totp.hash_recovery_code(c) for c in codes]
        self.alice.mailbox.save(update_fields=["recovery_code_hashes"])

        r = self.c.post("/api/auth/mfa",
                        {"ticket": self._ticket_for(self.alice), "code": codes[0]},
                        content_type="application/json")
        self.assertEqual(r.status_code, 200)

        again = self.c.post("/api/auth/mfa",
                            {"ticket": self._ticket_for(self.alice), "code": codes[0]},
                            content_type="application/json")
        self.assertEqual(again.status_code, 401, "a recovery code was reusable")


class SessionTimerTests(MailTestCase):
    def test_idle_expiry_ends_the_session(self):
        store = sessions.get_store()
        sess = self.alice.session
        with override_settings(MAIL_SESSION_IDLE_SECONDS=0):
            self.assertIsNone(store.load_session(sess.sid))

    def test_absolute_expiry_never_slides(self):
        store = sessions.get_store()
        sess = store.load_session(self.alice.session.sid)
        original = sess.absolute_expiry
        for _ in range(3):
            sess = store.load_session(sess.sid)
        self.assertEqual(sess.absolute_expiry, original,
                         "the absolute cap moved; it must never be extended")

    def test_idle_slides_on_activity(self):
        store = sessions.get_store()
        first = store.load_session(self.alice.session.sid)
        time.sleep(0.02)
        second = store.load_session(self.alice.session.sid)
        self.assertGreater(second.last_seen, first.last_seen)

    def test_session_record_never_exposes_the_credential(self):
        public = self.alice.session.public()
        self.assertNotIn("credential", public)
        self.assertNotIn("dek", public)
        self.assertNotIn("hunter2", repr(self.alice.session))
        self.assertNotIn("correct horse", repr(self.alice.session))

    def test_me_returns_only_the_callers_own_mailbox(self):
        r = self.as_(self.bob).get("/api/me")
        self.assertEqual(r.json()["mailbox"], self.bob.address)

    def test_logout_destroys_the_session(self):
        c = self.as_(self.alice)
        self.assertEqual(c.post("/api/auth/logout").status_code, 200)
        self.assertEqual(c.get("/api/folders").status_code, 403)

    def test_user_agent_change_invalidates_the_session(self):
        store = sessions.get_store()
        sess = store.load_session(self.alice.session.sid)
        sess.ua_hash = "a-different-browser"
        store._save(sess)
        r = self.as_(self.alice).get("/api/me", HTTP_USER_AGENT="Mozilla/5.0")
        self.assertIn(r.status_code, (401, 403))

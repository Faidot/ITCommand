"""Break-glass access.

The original brief forbade this outright. It exists now by explicit request,
in the variant that trades "nobody can read your mail" for "you find out that
they did". These tests are almost entirely about the second half of that
trade, because the first half is what was given up.
"""
import hashlib
import hmac
import json
import time
from unittest import mock

from django.test import Client, override_settings

from mailcore import breakglass, imap_auth, sessions
from mailcore.models import MailAuditLog

from .base import MailTestCase

MASTER = dict(
    MAIL_MASTER_USER="tfadmin",
    MAIL_MASTER_PASSWORD="master-secret",
    MAIL_NOTICE_FROM="noreply@terafort.com",
)


def _ok(*a, **k):
    return imap_auth.ImapCapabilities.parse([b"IMAP4REV1"])


class ConfigurationTests(MailTestCase):
    def test_it_is_off_unless_deliberately_configured(self):
        """A master credential opens every mailbox. Nobody gets it by default."""
        self.assertFalse(breakglass.enabled())

    @override_settings(**MASTER)
    def test_it_is_on_once_a_master_user_is_set(self):
        self.assertTrue(breakglass.enabled())

    def test_opening_without_configuration_explains_why_not(self):
        with self.assertRaises(breakglass.BreakGlassError) as ctx:
            breakglass.open_mailbox(address=self.bob.address, actor="boss@terafort.com",
                                    reason="a perfectly good reason here")
        self.assertIn("every mailbox", str(ctx.exception))


@override_settings(**MASTER)
class GrantTests(MailTestCase):
    def _open(self, **over):
        params = dict(address=self.bob.address, actor="boss@terafort.com",
                      reason="Investigating a reported phishing campaign")
        params.update(over)
        with mock.patch.object(breakglass.imap_auth, "authenticate", _ok), \
             mock.patch.object(breakglass, "notify_owner", return_value=True):
            return breakglass.open_mailbox(**params)

    def test_a_grant_produces_an_ordinary_session_onto_that_mailbox(self):
        session, meta = self._open()
        self.assertEqual(session.mailbox_address, self.bob.address)
        self.assertIn("break_glass", session.scopes)
        self.assertTrue(meta["reference"])

    def test_the_login_is_the_master_form_not_the_address(self):
        session, _ = self._open()
        self.assertEqual(session.credential_login, "%s*tfadmin" % self.bob.address)

    def test_a_thin_reason_is_refused(self):
        """The owner reads this. One word is not a reason."""
        for reason in ("", "audit", "   ", "because"):
            with self.assertRaises(breakglass.BreakGlassError):
                self._open(reason=reason)

    def test_you_cannot_break_glass_into_your_own_mailbox(self):
        with self.assertRaises(breakglass.BreakGlassError):
            self._open(address=self.bob.address, actor=self.bob.address)

    def test_an_unknown_mailbox_is_refused(self):
        with self.assertRaises(breakglass.BreakGlassError):
            self._open(address="nobody@terafort.com")

    def test_the_grant_is_minutes_not_hours(self):
        session, meta = self._open()
        self.assertLessEqual(meta["expires_in"], breakglass.GRANT_MINUTES * 60)
        self.assertLess(session.absolute_expiry - time.time(), 60 * 60)

    def test_it_cannot_read_the_owners_cached_mail(self):
        """Their DEK is wrapped under a password we do not have. A grant reads
        live from IMAP; it does not unlock what they already cached."""
        from mailcore import crypto, sync
        session, _ = self._open()
        with self.assertRaises(crypto.SealError):
            sync.open_envelope(session, self.bob.message)

    def test_opening_is_audited_with_the_reason(self):
        self._open(reason="Investigating a reported phishing campaign")
        row = MailAuditLog.objects.filter(action="BREAK_GLASS_OPENED").first()
        self.assertIsNotNone(row)
        self.assertEqual(row.mailbox_address, self.bob.address)
        self.assertEqual(row.actor, "boss@terafort.com")
        self.assertIn("phishing", row.detail["reason"])

    def test_every_message_read_is_logged_individually(self):
        """"They had access for half an hour" is not an answer to "did they
        read my appraisal"."""
        session, _ = self._open()
        breakglass.record_read(session, "msg-1", "Salary review")
        breakglass.record_read(session, "msg-2", "Personal")
        rows = MailAuditLog.objects.filter(action="BREAK_GLASS_READ")
        self.assertEqual(rows.count(), 2)
        self.assertIn("Salary review", [r.detail["subject"] for r in rows])

    def test_an_ordinary_session_logs_no_reads(self):
        breakglass.record_read(self.alice.session, "msg-1", "Lunch")
        self.assertEqual(MailAuditLog.objects.filter(action="BREAK_GLASS_READ").count(), 0)


@override_settings(**MASTER)
class NotificationTests(MailTestCase):
    def test_the_owner_is_emailed_at_the_moment_it_happens(self):
        sent = []
        with mock.patch.object(breakglass.imap_auth, "authenticate", _ok), \
             mock.patch.object(breakglass, "notify_owner",
                               lambda **kw: sent.append(kw) or True):
            breakglass.open_mailbox(address=self.bob.address, actor="boss@terafort.com",
                                    reason="Offboarding handover for a leaver")
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["address"], self.bob.address)
        self.assertIn("Offboarding", sent[0]["reason"])

    @override_settings(MAIL_NOTICE_FROM="")
    def test_without_a_sender_the_owner_is_not_told_and_that_is_logged(self):
        with self.assertLogs("mailcore.breakglass", level="ERROR") as logs:
            told = breakglass.notify_owner(address="a@b.c", actor="x@y.z",
                                           reason="r", minutes=30, reference="ref")
        self.assertFalse(told)
        self.assertTrue(any("NOT told" in line for line in logs.output))

    def test_a_failed_notification_does_not_block_the_grant(self):
        """An admin locked out of a leaver's mailbox because SMTP hiccuped is
        its own problem, and the audit row exists either way."""
        with mock.patch.object(breakglass.imap_auth, "authenticate", _ok), \
             mock.patch.object(breakglass, "notify_owner", return_value=False):
            session, meta = breakglass.open_mailbox(
                address=self.bob.address, actor="boss@terafort.com",
                reason="Investigating a reported phishing campaign")
        self.assertIsNotNone(session)
        self.assertFalse(meta["owner_notified"])
        self.assertTrue(MailAuditLog.objects.filter(action="BREAK_GLASS_OPENED").exists())


def sign(body: bytes, service="itcommand"):
    from django.conf import settings
    ts = str(time.time())
    sig = hmac.new(settings.MAIL_INTERNAL_HMAC_KEY.encode(),
                   b"%s|%s|%s" % (service.encode(), ts.encode(), body),
                   hashlib.sha256).hexdigest()
    return {"HTTP_X_SERVICE": service, "HTTP_X_TIMESTAMP": ts, "HTTP_X_SIGNATURE": sig}


@override_settings(**MASTER)
class EndpointTests(MailTestCase):
    URL = "/internal/v1/break-glass"

    def _post(self, payload):
        body = json.dumps(payload).encode()
        return Client().post(self.URL, body, content_type="application/json", **sign(body))

    def test_a_browser_session_cannot_reach_it(self):
        """However privileged its owner. This is service-to-service only."""
        r = self.as_(self.alice).post(self.URL, {"address": self.bob.address},
                                      content_type="application/json")
        self.assertEqual(r.status_code, 404)

    def test_an_unsigned_request_is_404(self):
        r = Client().post(self.URL, {"address": self.bob.address},
                          content_type="application/json")
        self.assertEqual(r.status_code, 404)

    def test_a_signed_request_opens_a_session(self):
        with mock.patch.object(breakglass.imap_auth, "authenticate", _ok), \
             mock.patch.object(breakglass, "notify_owner", return_value=True):
            r = self._post({"actor": "boss@terafort.com", "address": self.bob.address,
                            "reason": "Investigating a reported phishing campaign"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["sid"])
        self.assertTrue(r.json()["owner_notified"])
        self.assertIsNotNone(sessions.get_store().load_session(r.json()["sid"]))

    def test_a_thin_reason_is_refused_at_the_boundary_too(self):
        r = self._post({"actor": "boss@terafort.com", "address": self.bob.address,
                        "reason": "audit"})
        self.assertEqual(r.status_code, 409)

    def test_missing_fields_are_refused(self):
        self.assertEqual(self._post({"address": self.bob.address}).status_code, 400)

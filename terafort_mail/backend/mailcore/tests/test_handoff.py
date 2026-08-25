"""The handoff, and every way it should refuse.

Blueprint section 4 makes six claims about the ticket. Each one is a test
here, because a handoff that is merely *usually* single-use is not single-use.
"""
from __future__ import annotations

import time

from django.conf import settings
from django.test import Client, override_settings

from mailcore import handoff, sessions

from .base import MailTestCase


class HandoffTicketTests(MailTestCase):
    def _mint(self, who, **kw):
        params = dict(sid=who.session.sid, mailbox_address=who.address,
                      ua_hash="", ip="127.0.0.1")
        params.update(kw)
        return handoff.mint(**params)

    def test_round_trip_returns_the_right_session(self):
        ticket = self._mint(self.alice)
        sess = handoff.redeem(ticket, ip="127.0.0.1")
        self.assertEqual(sess.mailbox_address, self.alice.address)

    def test_ticket_is_single_use(self):
        ticket = self._mint(self.alice)
        handoff.redeem(ticket, ip="127.0.0.1")
        with self.assertRaises(handoff.HandoffError):
            handoff.redeem(ticket, ip="127.0.0.1")

    def test_tampered_signature_is_refused_without_touching_the_store(self):
        token, _, sig = self._mint(self.alice).partition(".")
        forged = "%s.%s" % (token, "0" * len(sig))
        with self.assertRaises(handoff.HandoffError):
            handoff.redeem(forged, ip="127.0.0.1")
        # The store still holds it: the signature check rejected before GETDEL.
        self.assertIsNotNone(sessions.get_store().redeem_handoff(token))

    def test_malformed_ticket_is_refused(self):
        for bad in ("", "no-dot", ".", "a.b.c"):
            with self.assertRaises(handoff.HandoffError):
                handoff.redeem(bad, ip="127.0.0.1")

    @override_settings(MAIL_HANDOFF_TICKET_SECONDS=0)
    def test_expired_ticket_is_refused(self):
        ticket = self._mint(self.alice)
        time.sleep(0.01)
        with self.assertRaises(handoff.HandoffError):
            handoff.redeem(ticket, ip="127.0.0.1")

    def test_wrong_audience_is_refused(self):
        ticket = handoff.mint(sid=self.alice.session.sid,
                              mailbox_address=self.alice.address,
                              audience="some-other-app")
        with self.assertRaises(handoff.HandoffError):
            handoff.redeem(ticket, audience=handoff.AUDIENCE_MAIL)

    def test_user_agent_binding(self):
        ticket = self._mint(self.alice, ua_hash="browser-a")
        with self.assertRaises(handoff.HandoffError):
            handoff.redeem(ticket, ua_hash="browser-b", ip="127.0.0.1")

    def test_ip_binding(self):
        ticket = self._mint(self.alice, ip="10.0.0.1")
        with self.assertRaises(handoff.HandoffError):
            handoff.redeem(ticket, ip="10.0.0.2")

    def test_ticket_for_a_destroyed_session_is_refused(self):
        ticket = self._mint(self.alice)
        sessions.get_store().destroy_session(self.alice.session.sid)
        with self.assertRaises(handoff.HandoffError):
            handoff.redeem(ticket, ip="127.0.0.1")

    def test_ticket_carries_no_credential(self):
        """Whatever is intercepted, it is not a password."""
        ticket = self._mint(self.alice)
        self.assertNotIn("correct horse", ticket)
        self.assertNotIn(self.alice.address, ticket)


class HandoffViewTests(MailTestCase):
    def setUp(self):
        super().setUp()
        self.c = Client()

    def _ticket(self):
        return handoff.mint(sid=self.alice.session.sid,
                            mailbox_address=self.alice.address,
                            ua_hash="", ip="127.0.0.1")

    def test_form_post_signs_in_and_redirects(self):
        r = self.c.post("/auth/handoff", {"ticket": self._ticket()})
        self.assertEqual(r.status_code, 303)
        self.assertEqual(r["Location"], settings.MAIL_APP_INBOX_PATH)
        self.assertIn(settings.MAIL_SESSION_COOKIE, r.cookies)

    def test_the_cookie_is_httponly(self):
        r = self.c.post("/auth/handoff", {"ticket": self._ticket()})
        cookie = r.cookies[settings.MAIL_SESSION_COOKIE]
        self.assertTrue(cookie["httponly"], "the session cookie is readable by script")
        self.assertEqual(cookie["path"], "/")

    def test_get_is_refused(self):
        """A GET would mean the ticket travelled in a URL, which is the thing
        the form POST exists to prevent."""
        r = self.c.get("/auth/handoff", {"ticket": self._ticket()})
        self.assertEqual(r.status_code, 405)

    def test_bad_ticket_renders_an_error_not_a_session(self):
        r = self.c.post("/auth/handoff", {"ticket": "rubbish.0000"})
        self.assertEqual(r.status_code, 401)
        self.assertNotIn(settings.MAIL_SESSION_COOKIE, r.cookies)

    def test_replayed_ticket_fails_the_second_time(self):
        ticket = self._ticket()
        self.assertEqual(self.c.post("/auth/handoff", {"ticket": ticket}).status_code, 303)
        self.assertEqual(self.c.post("/auth/handoff", {"ticket": ticket}).status_code, 401)

    def test_handoff_gives_bob_bobs_mailbox_only(self):
        ticket = handoff.mint(sid=self.bob.session.sid,
                              mailbox_address=self.bob.address, ip="127.0.0.1")
        self.c.post("/auth/handoff", {"ticket": ticket})
        self.assertEqual(self.c.get("/api/me").json()["mailbox"], self.bob.address)

    def test_response_is_not_framable(self):
        r = self.c.post("/auth/handoff", {"ticket": self._ticket()})
        self.assertEqual(r.get("X-Frame-Options"), "DENY")


class BrowserBindingTests(MailTestCase):
    """Where a session's user-agent binding comes from.

    It has to come from a browser. A session created through the service
    boundary sees IT Command's HTTP client instead, and binding to that makes
    a check no browser can ever pass — which destroyed the session on its
    first real request and reported an expired mailbox for one created seconds
    earlier.
    """

    def test_a_service_login_does_not_bind_to_the_callers_agent(self):
        import hashlib
        import hmac
        import json
        import time

        from django.conf import settings
        from django.test import Client
        from unittest import mock

        from mailcore import imap_auth, sessions, totp

        body = json.dumps({"email": self.alice.address, "password": "correct horse"}).encode()
        ts = str(time.time())
        sig = hmac.new(settings.MAIL_INTERNAL_HMAC_KEY.encode(),
                       b"itcommand|%s|%s" % (ts.encode(), body), hashlib.sha256).hexdigest()

        caps = imap_auth.ImapCapabilities.parse([b"IMAP4REV1"])
        with mock.patch("mailcore.views.imap_auth.authenticate", lambda *a, **k: caps):
            r = Client().post(
                "/internal/v1/auth/login", body, content_type="application/json",
                HTTP_X_SERVICE="itcommand", HTTP_X_TIMESTAMP=ts, HTTP_X_SIGNATURE=sig,
                HTTP_USER_AGENT="Python-urllib/3.14")
        self.assertEqual(r.status_code, 200)

        payload = sessions.get_store().redeem_mfa_ticket(r.json()["ticket"])
        self.assertEqual(payload["ua_hash"], "",
                         "the session was bound to IT Command's HTTP client")

    def test_the_handoff_binds_the_session_to_the_redeeming_browser(self):
        from django.test import Client
        from mailcore import handoff, sessions

        store = sessions.get_store()
        sess = store.load_session(self.alice.session.sid)
        sess.ua_hash = ""          # as a service-created session arrives
        store._save(sess)

        ticket = handoff.mint(sid=sess.sid, mailbox_address=self.alice.address,
                              ua_hash="", ip="127.0.0.1")
        client = Client(HTTP_USER_AGENT="Mozilla/5.0 (a real browser)")
        r = client.post("/auth/handoff", {"ticket": ticket})
        self.assertEqual(r.status_code, 303)

        bound = store.load_session(sess.sid)
        self.assertTrue(bound.ua_hash, "the session was left unbound")

        # And the same browser can then use it, which is the whole point.
        self.assertEqual(client.get("/api/me").status_code, 200)

    def test_a_different_browser_cannot_use_it_afterwards(self):
        from django.test import Client
        from mailcore import handoff, sessions

        store = sessions.get_store()
        sess = store.load_session(self.alice.session.sid)
        sess.ua_hash = ""
        store._save(sess)

        ticket = handoff.mint(sid=sess.sid, mailbox_address=self.alice.address,
                              ua_hash="", ip="127.0.0.1")
        Client(HTTP_USER_AGENT="Mozilla/5.0 (first)").post("/auth/handoff", {"ticket": ticket})

        thief = Client(HTTP_USER_AGENT="Mozilla/5.0 (somewhere else)")
        thief.cookies[settings_cookie()] = sess.sid
        self.assertIn(thief.get("/api/me").status_code, (401, 403))


def settings_cookie():
    from django.conf import settings
    return settings.MAIL_SESSION_COOKIE

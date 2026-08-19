"""The service boundary: who may call it, and what it refuses to be."""
from __future__ import annotations

import hashlib
import hmac
import json
import time

from django.conf import settings
from django.test import Client

from mailcore import sessions, totp

from .base import MailTestCase


def sign(body: bytes, service="itcommand", ts=None, key=None):
    ts = str(time.time() if ts is None else ts)
    key = (key or settings.MAIL_INTERNAL_HMAC_KEY).encode()
    sig = hmac.new(key, b"%s|%s|%s" % (service.encode(), ts.encode(), body),
                   hashlib.sha256).hexdigest()
    return {"HTTP_X_SERVICE": service, "HTTP_X_TIMESTAMP": ts, "HTTP_X_SIGNATURE": sig}


class ServiceAuthTests(MailTestCase):
    URL = "/internal/v1/auth/session"

    def test_unsigned_request_is_404_not_401(self):
        """An unauthenticated caller must not learn the route exists."""
        r = Client().get(self.URL)
        self.assertEqual(r.status_code, 404)

    def test_signed_request_is_accepted(self):
        r = Client().get(self.URL + "?sid=" + self.alice.session.sid, **sign(b""))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["alive"])

    def test_wrong_key_is_refused(self):
        r = Client().get(self.URL, **sign(b"", key="wrong-key"))
        self.assertEqual(r.status_code, 404)

    def test_unknown_service_is_refused(self):
        r = Client().get(self.URL, **sign(b"", service="somebody-else"))
        self.assertEqual(r.status_code, 404)

    def test_stale_timestamp_is_refused(self):
        r = Client().get(self.URL, **sign(b"", ts=time.time() - 600))
        self.assertEqual(r.status_code, 404)

    def test_a_browser_session_cookie_does_not_authenticate_here(self):
        c = self.as_(self.alice)
        self.assertEqual(c.get(self.URL).status_code, 404)

    def test_session_can_be_destroyed_by_the_owning_service(self):
        c = Client()
        url = self.URL + "?sid=" + self.alice.session.sid
        self.assertEqual(c.delete(url, **sign(b"")).status_code, 200)
        self.assertIsNone(sessions.get_store().load_session(self.alice.session.sid))


class InternalLoginTests(MailTestCase):
    def test_mfa_returns_a_sid_in_the_body_and_no_cookie(self):
        import base64
        ticket = sessions.get_store().create_mfa_ticket({
            "mailbox_id": str(self.alice.mailbox.id),
            "address": self.alice.address,
            "credential": "correct horse",
            "dek": base64.b64encode(self.alice.dek).decode("ascii"),
            "ua_hash": "", "ip": "127.0.0.1",
        })
        body = json.dumps({"ticket": ticket,
                           "code": totp.code_at(self.alice.mailbox.totp_secret)}).encode()
        r = Client().post("/internal/v1/auth/mfa", body,
                          content_type="application/json", **sign(body))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["sid"])
        self.assertNotIn(settings.MAIL_SESSION_COOKIE, r.cookies,
                         "the internal route set a browser cookie")

    def test_internal_routes_never_return_message_content(self):
        r = Client().get("/internal/v1/auth/session?sid=" + self.alice.session.sid,
                         **sign(b""))
        self.assertEqual(set(r.json()), {"alive", "expires_in"})

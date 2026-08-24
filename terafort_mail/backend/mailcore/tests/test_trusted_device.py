"""A trusted-device assertion must be unforgeable from a browser.

IT Command verifies the signed device token and then tells the mail app the
second factor is already satisfied. That is a real delegation of trust, so the
only thing standing between it and "skip 2FA by asking nicely" is that the
field is honoured on the service boundary alone — which a browser cannot
reach.
"""
import base64
import hashlib
import hmac
import json
import time
from unittest import mock

from django.conf import settings
from django.test import Client

from mailcore import sessions, totp

from .base import MailTestCase


def signed(body: bytes, service="itcommand"):
    ts = str(time.time())
    sig = hmac.new(settings.MAIL_INTERNAL_HMAC_KEY.encode(),
                   b"%s|%s|%s" % (service.encode(), ts.encode(), body),
                   hashlib.sha256).hexdigest()
    return {"HTTP_X_SERVICE": service, "HTTP_X_TIMESTAMP": ts,
            "HTTP_X_SIGNATURE": sig}


class TrustedDeviceTests(MailTestCase):
    def _ticket(self):
        return sessions.get_store().create_mfa_ticket({
            "mailbox_id": str(self.alice.mailbox.id),
            "address": self.alice.address,
            "credential": "correct horse",
            "dek": base64.b64encode(self.alice.dek).decode("ascii"),
            "ua_hash": "", "ip": "",
        })

    def test_a_service_caller_may_skip_the_code(self):
        body = json.dumps({"ticket": self._ticket(), "code": "",
                           "trusted_device": True}).encode()
        r = Client().post("/internal/v1/auth/mfa", body,
                          content_type="application/json", **signed(body))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["sid"])

    def test_a_browser_cannot_assert_it(self):
        """The public route is where a browser would try. Even reachable, the
        field is ignored without a service header — and here the route is not
        reachable at all."""
        r = Client().post("/api/auth/mfa",
                          {"ticket": self._ticket(), "code": "000000",
                           "trusted_device": True},
                          content_type="application/json")
        self.assertNotEqual(r.status_code, 200)

    def test_a_wrong_code_is_still_refused_without_the_assertion(self):
        body = json.dumps({"ticket": self._ticket(), "code": "000000",
                           "trusted_device": False}).encode()
        r = Client().post("/internal/v1/auth/mfa", body,
                          content_type="application/json", **signed(body))
        self.assertEqual(r.status_code, 401)

    def test_enrolment_is_never_skipped_by_it(self):
        """Somebody who has not enrolled has nothing to have trusted."""
        ticket = sessions.get_store().create_mfa_ticket({
            "mailbox_id": str(self.alice.mailbox.id),
            "address": self.alice.address,
            "credential": "correct horse",
            "dek": base64.b64encode(self.alice.dek).decode("ascii"),
            "ua_hash": "", "ip": "", "enrolling": True,
        })
        body = json.dumps({"ticket": ticket, "code": "000000",
                           "trusted_device": True}).encode()
        r = Client().post("/internal/v1/auth/mfa", body,
                          content_type="application/json", **signed(body))
        self.assertEqual(r.status_code, 401,
                         "enrolment was skipped by a trusted-device claim")

    def test_it_is_audited(self):
        from mailcore.models import MailAuditLog
        body = json.dumps({"ticket": self._ticket(), "code": "",
                           "trusted_device": True}).encode()
        Client().post("/internal/v1/auth/mfa", body,
                      content_type="application/json", **signed(body))
        self.assertTrue(
            MailAuditLog.objects.filter(action="MFA_TRUSTED_DEVICE").exists())

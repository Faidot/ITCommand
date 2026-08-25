"""The image proxy and attachment serving — the two places hostile bytes leave.

The proxy is the higher-risk of the two: a message body is attacker-controlled,
so every URL in it is an instruction from someone hostile, and fetching those
from inside our network is exactly server-side request forgery. Most of these
tests are that guard.
"""
from unittest import mock

from django.test import override_settings

from mailcore import fetching, scanning, views_files
from mailcore.models import Message

from .base import MailTestCase
from .test_reading import FakeImap, env, fake_session
from mailcore import sync


class SsrfTests(MailTestCase):
    """A message must not be able to make our server fetch our own network."""

    FORBIDDEN = [
        "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1",
        "169.254.169.254",          # cloud metadata: reads our credentials
        "0.0.0.0", "::1", "fe80::1",
    ]

    def test_private_and_local_addresses_are_forbidden(self):
        for ip in self.FORBIDDEN:
            self.assertTrue(fetching._is_forbidden(ip), "%s was allowed" % ip)

    def test_public_addresses_are_allowed(self):
        for ip in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]:
            self.assertFalse(fetching._is_forbidden(ip), "%s was blocked" % ip)

    def test_an_ipv4_mapped_ipv6_loopback_is_forbidden(self):
        """The classic way round a naive check."""
        self.assertTrue(fetching._is_forbidden("::ffff:127.0.0.1"))

    def test_a_host_resolving_to_a_private_address_is_refused(self):
        with mock.patch.object(fetching.socket, "getaddrinfo",
                               return_value=[(0, 0, 0, "", ("10.1.2.3", 0))]):
            with self.assertRaises(fetching.Refused):
                fetching._resolve("evil.example.com")

    def test_a_host_resolving_to_both_public_and_private_is_refused(self):
        """Rebinding: taking the public one would be exactly the mistake."""
        with mock.patch.object(fetching.socket, "getaddrinfo", return_value=[
                (0, 0, 0, "", ("93.184.216.34", 0)),
                (0, 0, 0, "", ("127.0.0.1", 0))]):
            with self.assertRaises(fetching.Refused):
                fetching._resolve("rebind.example.com")

    def test_non_http_schemes_are_refused(self):
        for url in ["file:///etc/passwd", "gopher://x/", "ftp://x/y"]:
            with self.assertRaises(fetching.Refused):
                fetching.safe_get(url)

    def test_svg_is_not_an_allowed_image_type(self):
        """It is a script container."""
        self.assertNotIn("image/svg+xml", fetching.ALLOWED_TYPES)


class ImageProxyTests(MailTestCase):
    def setUp(self):
        super().setUp()
        fake = FakeImap(messages=[env(1, "With images")])
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
        self.message = Message.objects.for_mailbox(self.alice.mailbox).filter(
            folder__imap_path="INBOX").first()
        self.url = "https://tracker.example.com/pixel.gif"

    def _get(self, who, **params):
        return self.as_(who).get("/api/proxy/image", params)

    def test_an_unsigned_request_is_404_not_403(self):
        """An unsigned caller should not learn the endpoint fetches URLs."""
        r = self._get(self.alice, u=self.url)
        self.assertEqual(r.status_code, 404)

    def test_a_signature_from_another_mailbox_does_not_work(self):
        signature = views_files.sign_url(self.bob.session, self.url)
        r = self._get(self.alice, u=self.url, s=signature, m=str(self.message.id))
        self.assertEqual(r.status_code, 404)

    def test_signing_alone_is_not_consent(self):
        """Images load only for a message where the reader said so."""
        signature = views_files.sign_url(self.alice.session, self.url)
        r = self._get(self.alice, u=self.url, s=signature, m=str(self.message.id))
        self.assertEqual(r.status_code, 403)

    def test_a_permitted_image_is_fetched_and_hardened(self):
        self.message.images_allowed = True
        self.message.save(update_fields=["images_allowed"])
        signature = views_files.sign_url(self.alice.session, self.url)
        with mock.patch.object(fetching, "safe_get",
                               return_value=(b"\x89PNG fake", "image/png")):
            r = self._get(self.alice, u=self.url, s=signature, m=str(self.message.id))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["X-Content-Type-Options"], "nosniff")
        self.assertIn("default-src 'none'", r["Content-Security-Policy"])

    def test_a_refused_url_does_not_leak_why(self):
        self.message.images_allowed = True
        self.message.save(update_fields=["images_allowed"])
        signature = views_files.sign_url(self.alice.session, self.url)
        with mock.patch.object(fetching, "safe_get",
                               side_effect=fetching.Refused("resolves to 127.0.0.1")):
            r = self._get(self.alice, u=self.url, s=signature, m=str(self.message.id))
        self.assertEqual(r.status_code, 400)
        self.assertNotIn("127.0.0.1", str(r.content))

    def test_bob_cannot_use_alices_message_id(self):
        self.message.images_allowed = True
        self.message.save(update_fields=["images_allowed"])
        signature = views_files.sign_url(self.bob.session, self.url)
        r = self._get(self.bob, u=self.url, s=signature, m=str(self.message.id))
        self.assertEqual(r.status_code, 403)


class AttachmentTests(MailTestCase):
    def setUp(self):
        super().setUp()
        self.fake = FakeImap(messages=[env(1, "With a file")])
        self.fake.fetch_attachment_parts = lambda uid: [
            {"filename": "invoice.pdf", "content_type": "application/pdf",
             "data": b"%PDF-1.4 fake"}]
        with mock.patch.object(sync.imap_client, "for_session",
                               lambda s: fake_session(self.fake)):
            sync.sync_mailbox(self.alice.session)
        self.message = Message.objects.for_mailbox(self.alice.mailbox).filter(
            folder__imap_path="INBOX").first()

    def _get(self, who, index=0):
        with mock.patch.object(views_files.imap_client, "for_session",
                               lambda s: fake_session(self.fake)):
            return self.as_(who).get(
                "/api/messages/%s/attachments/%d" % (self.message.id, index))

    def test_a_clean_attachment_is_served_as_a_download(self):
        with mock.patch.object(scanning, "scan", return_value=scanning.Verdict("clean")):
            r = self._get(self.alice)
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment;", r["Content-Disposition"])
        self.assertEqual(r["X-Content-Type-Options"], "nosniff")

    def test_it_is_never_served_with_its_real_content_type(self):
        """application/pdf or text/html invites the browser to render it."""
        with mock.patch.object(scanning, "scan", return_value=scanning.Verdict("clean")):
            r = self._get(self.alice)
        self.assertEqual(r["Content-Type"], "application/octet-stream")

    def test_an_infected_attachment_is_refused(self):
        with mock.patch.object(scanning, "scan",
                               return_value=scanning.Verdict("infected", "Eicar-Test")):
            r = self._get(self.alice)
        self.assertEqual(r.status_code, 403)
        self.assertIn("Eicar-Test", r.json()["threat"])

    def test_an_unscannable_file_is_served_by_default_and_says_so(self):
        with mock.patch.object(scanning, "scan",
                               return_value=scanning.Verdict("failed", "no scanner")):
            r = self._get(self.alice)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["X-Scan-Status"], "failed")

    @override_settings(MAIL_BLOCK_UNSCANNED=True)
    def test_an_unscannable_file_is_refused_when_configured_to_be(self):
        with mock.patch.object(scanning, "scan",
                               return_value=scanning.Verdict("failed", "no scanner")):
            r = self._get(self.alice)
        self.assertEqual(r.status_code, 503)

    def test_a_quarantined_message_will_not_hand_over_its_attachments(self):
        self.message.quarantined = True
        self.message.save(update_fields=["quarantined"])
        with mock.patch.object(scanning, "scan", return_value=scanning.Verdict("clean")):
            r = self._get(self.alice)
        self.assertEqual(r.status_code, 403)

    def test_bob_gets_404_on_alices_attachment(self):
        with mock.patch.object(scanning, "scan", return_value=scanning.Verdict("clean")):
            r = self._get(self.bob)
        self.assertEqual(r.status_code, 404)

    def test_an_out_of_range_index_is_404(self):
        with mock.patch.object(scanning, "scan", return_value=scanning.Verdict("clean")):
            r = self._get(self.alice, index=9)
        self.assertEqual(r.status_code, 404)

    def test_a_quoted_filename_cannot_break_the_header(self):
        self.fake.fetch_attachment_parts = lambda uid: [
            {"filename": 'evil".pdf\nX-Injected: yes',
             "content_type": "application/pdf", "data": b"x"}]
        with mock.patch.object(scanning, "scan", return_value=scanning.Verdict("clean")):
            r = self._get(self.alice)
        self.assertNotIn("X-Injected", r)
        self.assertNotIn("\n", r["Content-Disposition"])


class ScannerTests(MailTestCase):
    def test_no_scanner_configured_is_a_verdict_not_a_crash(self):
        with override_settings(MAIL_CLAMAV_SOCKET=""):
            self.assertEqual(scanning.scan(b"x").status, "failed")

    def test_an_unreachable_scanner_is_a_verdict_not_a_crash(self):
        with override_settings(MAIL_CLAMAV_SOCKET="127.0.0.1:1"):
            self.assertEqual(scanning.scan(b"x").status, "failed")

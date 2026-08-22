"""Message bodies are hostile input. These are the tests for that belief.

The sanitiser is the second line, not the first — a sandboxed cross-origin
frame with no scripts sits in front of it — but a second line that does not
hold is not a second line.
"""
from unittest import mock

from django.test import SimpleTestCase

from mailcore import bundles, sanitiser


class SanitiserTests(SimpleTestCase):
    def setUp(self):
        if not sanitiser.HAVE_BLEACH:
            self.skipTest("bleach is not installed; the fallback is tested separately")

    def clean(self, html):
        return sanitiser.clean(html)[0]

    def test_scripts_are_removed(self):
        out = self.clean('<p>hi</p><script>alert(1)</script>')
        self.assertNotIn("script", out.lower())
        self.assertIn("hi", out)

    def test_event_handlers_are_removed(self):
        out = self.clean('<p onclick="steal()">click</p>')
        self.assertNotIn("onclick", out.lower())

    def test_iframes_are_removed(self):
        self.assertNotIn("iframe", self.clean('<iframe src="//evil"></iframe>').lower())

    def test_style_tags_are_removed(self):
        """CSS can exfiltrate and can break out of our layout."""
        self.assertNotIn("<style", self.clean("<style>body{display:none}</style>").lower())

    def test_svg_is_removed(self):
        """A favourite mXSS vector."""
        self.assertNotIn("<svg", self.clean('<svg><script>alert(1)</script></svg>').lower())

    def test_forms_are_removed(self):
        out = self.clean('<form action="//evil"><input name="pw"></form>')
        self.assertNotIn("<form", out.lower())
        self.assertNotIn("<input", out.lower())

    def test_javascript_urls_are_removed(self):
        self.assertNotIn("javascript:", self.clean('<a href="javascript:alert(1)">x</a>').lower())

    def test_data_uris_are_removed(self):
        """A data: image is a fine way to smuggle SVG."""
        out = self.clean('<img src="data:image/svg+xml;base64,PHN2Zz4=">')
        self.assertNotIn("data:", out.lower())

    def test_ordinary_formatting_survives(self):
        out = self.clean("<p>Hello <strong>Kofi</strong></p><ul><li>one</li></ul>")
        self.assertIn("<strong>", out)
        self.assertIn("<li>", out)

    def test_links_are_hardened(self):
        out = self.clean('<a href="https://example.com">x</a>')
        self.assertIn('rel="noopener noreferrer nofollow"', out)
        self.assertIn('target="_blank"', out)


class FallbackTests(SimpleTestCase):
    def test_without_bleach_html_is_reduced_to_text_not_passed_through(self):
        """Degraded, never unsafe. This is the branch that matters most."""
        with mock.patch.object(sanitiser, "HAVE_BLEACH", False):
            out, _ = sanitiser.clean('<p>hi</p><script>alert(1)</script>')
        self.assertNotIn("<script", out.lower())
        self.assertNotIn("<p>", out.lower())
        self.assertIn("hi", out)


class DetectionTests(SimpleTestCase):
    def test_remote_images_are_detected(self):
        _, found = sanitiser.clean('<img src="https://tracker.example/p.gif">')
        self.assertTrue(found["remote_images"])

    def test_findings_come_from_the_original_not_the_cleaned_html(self):
        """Stripping a tracking pixel then reporting no pixel would be worse
        than useless."""
        _, found = sanitiser.clean('<img src="https://tracker/p.gif"><script>x</script>')
        self.assertTrue(found["remote_images"])

    def test_a_lying_link_is_flagged(self):
        _, found = sanitiser.clean(
            '<a href="https://hsbc-verify.net/x">https://www.hsbc.co.uk/verify</a>')
        self.assertTrue(found["link_mismatch"])

    def test_a_subdomain_is_not_a_lie(self):
        _, found = sanitiser.clean(
            '<a href="https://news.example.com/x">example.com</a>')
        self.assertFalse(found["link_mismatch"])

    def test_click_here_is_not_a_mismatch(self):
        """Flagging these trains people to ignore the warning."""
        _, found = sanitiser.clean('<a href="https://example.com">click here</a>')
        self.assertFalse(found["link_mismatch"])

    def test_matching_text_and_href_is_not_flagged(self):
        _, found = sanitiser.clean(
            '<a href="https://example.com/a">https://example.com/b</a>')
        self.assertFalse(found["link_mismatch"])

    def test_preview_flattens_html(self):
        self.assertEqual(
            sanitiser.to_preview("", "<p>Hello   <b>there</b></p>"), "Hello there")

    def test_preview_truncates(self):
        out = sanitiser.to_preview("x" * 500)
        self.assertTrue(out.endswith("…"))
        self.assertLessEqual(len(out), 141)


class Envelope:
    def __init__(self, subject="", sender="", list_id=""):
        self.subject = subject
        self.from_addr = sender
        self.list_id = list_id


class BundleTests(SimpleTestCase):
    def test_invoices(self):
        self.assertEqual(bundles.classify(Envelope("Invoice INV-2026-8871")), "Invoices")
        self.assertEqual(bundles.classify(Envelope(sender="billing@dell.com")), "Invoices")

    def test_renewals(self):
        self.assertEqual(
            bundles.classify(Envelope("Your subscription renews on 2 September")),
            "Renewals")
        self.assertEqual(
            bundles.classify(Envelope("Firewall licence expires in 14 days")), "Renewals")

    def test_alerts(self):
        self.assertEqual(bundles.classify(Envelope("DOWN: mail.itcommand.com")), "Alerts")
        self.assertEqual(
            bundles.classify(Envelope("Backup verification failed")), "Alerts")

    def test_store_policy(self):
        self.assertEqual(
            bundles.classify(Envelope("Updated returns process")), "Store Policy")

    def test_vendors(self):
        self.assertEqual(bundles.classify(Envelope("Q3 pricing update")), "Vendors")

    def test_an_invoice_from_a_vendor_is_an_invoice(self):
        """Order matters: specific rules run before broad ones."""
        self.assertEqual(
            bundles.classify(Envelope("Invoice for Q3 pricing", "sales@ingram.com")),
            "Invoices")

    def test_ordinary_mail_gets_no_bundle(self):
        """A classifier that always picks something is noise with a label."""
        self.assertEqual(
            bundles.classify(Envelope("Lunch?", "priya@terafort.com")), "")

    def test_a_list_id_only_nudges_when_nothing_else_matched(self):
        self.assertEqual(
            bundles.classify(Envelope("Weekly digest", "x@y.com", "<monitor.example>")),
            "Alerts")
        self.assertEqual(
            bundles.classify(Envelope("Invoice 44", "x@y.com", "<monitor.example>")),
            "Invoices")

    def test_classification_is_case_insensitive(self):
        self.assertEqual(bundles.classify(Envelope("INVOICE 44")), "Invoices")

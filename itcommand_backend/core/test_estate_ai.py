"""AI-assisted import.

Two properties matter and everything here defends them:

* **the model proposes, the importer decides** — whatever comes back goes
  through the same validator an uploaded spreadsheet does, so a hallucinated
  provider or an invented billing cycle is rejected exactly as a typo would be;
* **nothing is written until a person presses Import.**

Every outbound call is mocked. No test may reach the real Gemini API.
"""
import json
from unittest import mock

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from core import estate_ai, gemini
from core.models import Integration, Property, Provider, ProviderAccount, Service, User
from core.test_helpers import create_role, create_user


def gemini_returns(payload):
    """Patch the HTTP layer, not our own code, so the client is exercised."""
    body = {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
    response = mock.MagicMock()
    response.read.return_value = json.dumps(body).encode()
    ctx = mock.MagicMock()
    ctx.__enter__.return_value = response
    return mock.patch("core.gemini.urllib.request.urlopen", return_value=ctx)


ROW = {
    "Provider": "Envato",
    "Account email": "design@example.invalid",
    "Service type": "SAAS",
    "Identifier": "Envato Elements",
    "Cost": "33",
    "Currency": "USD",
    "Billing cycle": "MONTHLY",
}


class ParseEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(create_user("ai-admin@example.invalid", "ADMIN"))
        self.integration = Integration.objects.create(provider="GEMINI", is_enabled=True)
        self.integration.set_api_key("test-key")
        self.integration.save()
        self.url = reverse("estate_ai_parse")

    def test_notes_become_reviewable_rows_without_writing_anything(self):
        with gemini_returns({"rows": [ROW], "questions": [], "notes": []}):
            response = self.client.post(self.url, {"text": "envato elements $33/mo"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["total"], 1)
        self.assertTrue(response.data["can_commit"])
        self.assertEqual(Service.objects.count(), 0, "parsing must not write")
        self.assertEqual(Provider.objects.count(), 0)

    def test_it_says_what_it_would_create(self):
        with gemini_returns({"rows": [ROW], "questions": [], "notes": []}):
            response = self.client.post(self.url, {"text": "notes"}, format="json")
        blob = str(response.data["will_create"])
        self.assertIn("Envato", blob)
        self.assertIn("design@example.invalid", blob)

    def test_an_invented_code_is_rejected_by_the_same_validator_as_a_typo(self):
        """The point of routing model output through the importer."""
        bad = {**ROW, "Billing cycle": "EVERY_FULL_MOON"}
        with gemini_returns({"rows": [bad], "questions": [], "notes": []}):
            response = self.client.post(self.url, {"text": "notes"}, format="json")

        self.assertFalse(response.data["can_commit"])
        self.assertIn("Billing cycle", str(response.data["rows"][0]["errors"]))

    def test_questions_come_back_for_review(self):
        with gemini_returns({
            "rows": [],
            "questions": [{"id": "cycle", "ask": "Is Envato billed monthly or yearly?",
                           "why": "Decides the monthly spend figure."}],
            "notes": [],
        }):
            response = self.client.post(self.url, {"text": "envato, $400"}, format="json")

        self.assertEqual(len(response.data["questions"]), 1)
        self.assertIn("monthly or yearly", response.data["questions"][0]["ask"])

    def test_answers_are_sent_back_to_the_model(self):
        captured = {}

        def fake(integration, prompt, **kwargs):
            captured["prompt"] = prompt
            return {"rows": [ROW], "questions": [], "notes": []}

        with mock.patch("core.gemini.generate_json", side_effect=fake):
            self.client.post(
                self.url,
                {"text": "envato", "answers": {"Is it monthly or yearly?": "Monthly"}},
                format="json",
            )
        self.assertIn("Monthly", captured["prompt"])
        self.assertIn("do not ask them again", captured["prompt"])

    def test_a_column_the_model_invented_is_dropped(self):
        with gemini_returns({"rows": [{**ROW, "Nonsense": "x"}], "questions": [], "notes": []}):
            response = self.client.post(self.url, {"text": "notes"}, format="json")
        self.assertTrue(response.data["can_commit"])
        self.assertNotIn("Nonsense", str(response.data["records"]))

    def test_assumptions_are_surfaced(self):
        with gemini_returns({
            "rows": [ROW], "questions": [],
            "notes": ["Assumed USD because no currency was given."],
        }):
            response = self.client.post(self.url, {"text": "notes"}, format="json")
        self.assertIn("Assumed USD", str(response.data["assumptions"]))

    def test_empty_notes_are_refused_before_calling_the_model(self):
        with mock.patch("core.gemini.generate_json") as called:
            response = self.client.post(self.url, {"text": "   "}, format="json")
        called.assert_not_called()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_oversized_paste_is_refused_before_calling_the_model(self):
        with mock.patch("core.gemini.generate_json") as called:
            response = self.client.post(
                self.url, {"text": "x" * (gemini.MAX_INPUT_CHARS + 1)}, format="json"
            )
        called.assert_not_called()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_rejected_key_is_explained_not_crashed(self):
        with mock.patch("core.gemini.generate_json",
                        side_effect=gemini.GeminiAuthError("Google rejected the API key (403).")):
            response = self.client.post(self.url, {"text": "notes"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("rejected the API key", response.data["detail"])

    def test_it_refuses_when_no_key_is_saved(self):
        self.integration.set_api_key("")
        self.integration.save()
        with mock.patch("core.gemini.generate_json") as called:
            response = self.client.post(self.url, {"text": "notes"}, format="json")
        called.assert_not_called()
        self.assertIn("Settings", response.data["detail"])

    def test_it_refuses_when_the_integration_is_switched_off(self):
        Integration.objects.filter(provider="GEMINI").update(is_enabled=False)
        with mock.patch("core.gemini.generate_json") as called:
            response = self.client.post(self.url, {"text": "notes"}, format="json")
        called.assert_not_called()
        self.assertIn("switched off", response.data["detail"])

    def test_a_non_admin_cannot_use_it(self):
        client = APIClient()
        client.force_authenticate(
            create_user("nosy-ai@example.invalid", create_role("NOSY_AI", view=True).slug)
        )
        response = client.post(self.url, {"text": "notes"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_parsing_is_audited_without_storing_the_text(self):
        from core.models import AuditLog

        with gemini_returns({"rows": [ROW], "questions": [], "notes": []}):
            self.client.post(self.url, {"text": "secret internal notes"}, format="json")

        entry = AuditLog.objects.filter(model_name="Integration").last()
        self.assertEqual(entry.changes["action"], "estate_ai_parse")
        self.assertNotIn("secret internal notes", str(entry.changes))


class PromptTests(TestCase):
    """What leaves the building, and what the model is told to do."""

    def test_existing_names_are_given_so_it_matches_rather_than_invents(self):
        Provider.objects.create(name="Cloudflare", slug="cloudflare")
        Property.objects.create(name="terafort.com", kind="INFRA")

        prompt = estate_ai.build_prompt("some notes")
        self.assertIn("Cloudflare", prompt)
        self.assertIn("terafort.com", prompt)

    def test_it_is_told_to_ask_rather_than_invent(self):
        prompt = estate_ai.build_prompt("notes")
        self.assertIn("Never invent a value", prompt)
        self.assertIn("question", prompt.lower())

    def test_it_is_told_to_ignore_anything_secret(self):
        prompt = estate_ai.build_prompt("notes")
        self.assertIn("password", prompt.lower())
        self.assertIn("ignore it completely", prompt)

    def test_no_credential_is_ever_placed_in_the_prompt(self):
        """Context is names only — never a vault entry or a stored key."""
        provider = Provider.objects.create(name="Acme", slug="acme")
        ProviderAccount.objects.create(
            provider=provider, account_email="a@example.invalid", notes="hunter2"
        )
        prompt = estate_ai.build_prompt("notes")
        self.assertNotIn("hunter2", prompt)


class AiCommitTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(create_user("ai-commit@example.invalid", "ADMIN"))
        self.url = reverse("estate_ai_commit")

    def test_reviewed_rows_import_and_create_their_chain(self):
        response = self.client.post(self.url, {"records": [ROW]}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(Provider.objects.get().name, "Envato")
        self.assertEqual(ProviderAccount.objects.get().account_email, "design@example.invalid")
        self.assertEqual(Service.objects.get().identifier, "Envato Elements")

    def test_an_edited_payload_cannot_skip_validation(self):
        """The client is not trusted just because a model produced the rows."""
        tampered = {**ROW, "Service type": "NOT_A_TYPE"}
        response = self.client.post(self.url, {"records": [tampered]}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Service.objects.count(), 0)

    def test_one_bad_row_stops_all_of_them(self):
        rows = [ROW, {**ROW, "Identifier": "Second", "Billing cycle": "NONSENSE"}]
        response = self.client.post(self.url, {"records": rows}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Provider.objects.count(), 0, "no half-built chain")

    def test_an_empty_payload_is_refused(self):
        response = self.client.post(self.url, {"records": []}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_non_admin_cannot_commit(self):
        client = APIClient()
        client.force_authenticate(
            create_user("nosy-commit@example.invalid", create_role("NOSY_C", view=True).slug)
        )
        response = client.post(self.url, {"records": [ROW]}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class GeminiClientTests(TestCase):
    def setUp(self):
        self.integration = Integration.objects.create(provider="GEMINI", is_enabled=True)
        self.integration.set_api_key("secret-key")
        self.integration.save()

    def test_the_key_travels_in_a_header_not_the_url(self):
        """A key in a query string lands in access logs and proxy traces."""
        captured = {}

        def fake_urlopen(request, timeout=None):
            captured["url"] = request.full_url
            captured["headers"] = {k.lower(): v for k, v in request.header_items()}
            response = mock.MagicMock()
            response.read.return_value = json.dumps(
                {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
            ).encode()
            ctx = mock.MagicMock()
            ctx.__enter__.return_value = response
            return ctx

        with mock.patch("core.gemini.urllib.request.urlopen", side_effect=fake_urlopen):
            gemini.generate_json(self.integration, "hello")

        self.assertNotIn("secret-key", captured["url"])
        self.assertEqual(captured["headers"].get("x-goog-api-key"), "secret-key")

    def test_a_non_json_answer_is_reported_not_crashed(self):
        body = {"candidates": [{"content": {"parts": [{"text": "I'm afraid I can't"}]}}]}
        response = mock.MagicMock()
        response.read.return_value = json.dumps(body).encode()
        ctx = mock.MagicMock()
        ctx.__enter__.return_value = response

        with mock.patch("core.gemini.urllib.request.urlopen", return_value=ctx):
            with self.assertRaises(gemini.GeminiBadResponse):
                gemini.generate_json(self.integration, "hello")

    def test_a_blocked_prompt_says_so(self):
        body = {"promptFeedback": {"blockReason": "SAFETY"}}
        response = mock.MagicMock()
        response.read.return_value = json.dumps(body).encode()
        ctx = mock.MagicMock()
        ctx.__enter__.return_value = response

        with mock.patch("core.gemini.urllib.request.urlopen", return_value=ctx):
            with self.assertRaises(gemini.GeminiBadResponse) as caught:
                gemini.generate_json(self.integration, "hello")
        self.assertIn("SAFETY", str(caught.exception))

    def test_the_key_never_appears_in_an_error(self):
        import urllib.error

        with mock.patch("core.gemini.urllib.request.urlopen",
                        side_effect=urllib.error.URLError("no route")):
            try:
                gemini.generate_json(self.integration, "hello", sleep=lambda _: None)
            except gemini.GeminiError as exc:
                self.assertNotIn("secret-key", str(exc))

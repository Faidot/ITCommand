"""Search over the blind index.

The interesting tests are the privacy ones — that nothing readable reaches the
database — and the honest limits: whole tokens only, no substrings.
"""
from unittest import mock

from mailcore import crypto, search, sync
from mailcore.models import SearchToken

from .base import MailTestCase
from .test_reading import FakeImap, env, fake_session


class TokeniserTests(MailTestCase):
    def test_stopwords_are_dropped(self):
        tokens = search.tokenise("the invoice is in the post")
        self.assertIn("invoice", tokens)
        self.assertNotIn("the", tokens)
        self.assertNotIn("is", tokens)

    def test_plurals_and_singulars_meet(self):
        """They must land on the same token, not merely overlap.

        An earlier stemmer got this backwards — "invoices" became "invoic"
        while "invoice" stayed whole — so searching for one never found the
        other. Asserting equality rather than intersection is what catches
        that.
        """
        self.assertEqual(search.tokenise("invoices"), search.tokenise("invoice"))
        self.assertEqual(search.tokenise("renewals"), search.tokenise("renewal"))

    def test_a_double_s_word_is_not_mangled(self):
        self.assertEqual(search.tokenise("address"), {"address"})

    def test_an_address_is_indexed_whole_and_in_parts(self):
        tokens = search.tokenise("priya@terafort.com")
        self.assertIn("priya@terafort.com", tokens)
        self.assertIn("priya", tokens)
        self.assertIn("terafort", tokens)

    def test_very_short_and_very_long_tokens_are_skipped(self):
        tokens = search.tokenise("a bc " + "x" * 60)
        self.assertEqual(tokens, set())

    def test_case_is_irrelevant(self):
        self.assertEqual(search.tokenise("Invoice"), search.tokenise("INVOICE"))


class DigestTests(MailTestCase):
    def test_the_same_token_under_different_keys_differs(self):
        """Two mailboxes must not share a digest space."""
        a = search.digest(search.search_key(self.alice.dek), "invoice")
        b = search.digest(search.search_key(self.bob.dek), "invoice")
        self.assertNotEqual(a, b)

    def test_the_search_key_is_not_the_dek(self):
        self.assertNotEqual(search.search_key(self.alice.dek), self.alice.dek)

    def test_a_digest_does_not_contain_the_word(self):
        d = search.digest(search.search_key(self.alice.dek), "invoice")
        self.assertNotIn(b"invoice", d)


class IndexTests(MailTestCase):
    def _sync(self, messages):
        fake = FakeImap(messages=messages)
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
        return fake

    def test_the_index_holds_no_readable_words(self):
        """The whole point of the blind index."""
        self._sync([env(1, "Quarterly invoice", "billing@dell.com")])
        rows = SearchToken.objects.for_mailbox(self.alice.mailbox)
        self.assertGreater(rows.count(), 0)
        blob = b"".join(bytes(r.token_hmac) for r in rows)
        self.assertNotIn(b"invoice", blob)
        self.assertNotIn(b"dell", blob)

    def test_re_syncing_does_not_accumulate_rows(self):
        self._sync([env(1, "Invoice", "billing@dell.com")])
        first = SearchToken.objects.for_mailbox(self.alice.mailbox).count()
        self._sync([env(1, "Invoice", "billing@dell.com")])
        self.assertEqual(SearchToken.objects.for_mailbox(self.alice.mailbox).count(), first)


class SearchApiTests(MailTestCase):
    def _sync(self, who, messages):
        fake = FakeImap(messages=messages)
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(who.session)

    def test_a_subject_word_is_found(self):
        self._sync(self.alice, [env(1, "Quarterly invoice for Q3"),
                                env(2, "Lunch on Friday")])
        r = self.as_(self.alice).get("/api/search", {"q": "invoice"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["count"], 1)
        self.assertIn("invoice", r.json()["results"][0]["subject"].lower())

    def test_a_sender_is_found(self):
        self._sync(self.alice, [env(1, "Anything", "billing@dell.com")])
        r = self.as_(self.alice).get("/api/search", {"q": "dell"})
        self.assertEqual(r.json()["count"], 1)

    def test_a_plural_finds_the_singular(self):
        self._sync(self.alice, [env(1, "Renewal notice")])
        self.assertEqual(self.as_(self.alice).get(
            "/api/search", {"q": "renewals"}).json()["count"], 1)

    def test_a_partial_word_finds_nothing_and_says_why(self):
        """The honest limit of a blind index, surfaced rather than hidden."""
        self._sync(self.alice, [env(1, "Quarterly invoice")])
        body = self.as_(self.alice).get("/api/search", {"q": "invo"}).json()
        self.assertEqual(body["count"], 0)
        self.assertIn("whole words", body["note"])

    def test_bob_cannot_search_alices_mail(self):
        self._sync(self.alice, [env(1, "Alice's secret invoice")])
        r = self.as_(self.bob).get("/api/search", {"q": "invoice"})
        self.assertEqual(r.json()["count"], 0)

    def test_bobs_digests_do_not_match_alices_rows(self):
        """Even at the database level, not merely at the view."""
        self._sync(self.alice, [env(1, "Quarterly invoice")])
        digests = search.query_digests(self.bob.dek, "invoice")
        self.assertEqual(
            SearchToken.objects.for_mailbox(self.alice.mailbox)
            .filter(token_hmac__in=digests).count(), 0)

    def test_a_quarantined_message_is_not_searchable(self):
        self._sync(self.alice, [env(1, "Phishy invoice")])
        from mailcore.models import Message
        Message.objects.for_mailbox(self.alice.mailbox).update(quarantined=True)
        self.assertEqual(self.as_(self.alice).get(
            "/api/search", {"q": "invoice"}).json()["count"], 0)

    def test_a_one_character_query_is_refused_quietly(self):
        r = self.as_(self.alice).get("/api/search", {"q": "a"})
        self.assertEqual(r.json()["count"], 0)

    def test_subject_hits_outrank_body_hits(self):
        self._sync(self.alice, [
            env(1, "Weekly update", "someone@x.com"),
            env(2, "Invoice", "billing@x.com"),
        ])
        results = self.as_(self.alice).get("/api/search", {"q": "invoice"}).json()["results"]
        self.assertEqual(results[0]["subject"], "Invoice")

"""Conversation grouping.

Real mail is malformed constantly, so most of these are about what happens
when headers are missing, wrong, or lying.
"""
from datetime import timedelta

from django.test import SimpleTestCase
from django.utils import timezone

from mailcore import threading


class Msg:
    def __init__(self, mid="", parent="", refs=None, subject="", when=None):
        self.message_id = mid
        self.in_reply_to = parent
        self.references = refs or []
        self.subject = subject
        self.internal_date = when or timezone.now()


class SubjectTests(SimpleTestCase):
    def test_reply_prefixes_are_stripped(self):
        for raw in ("Re: Invoice", "RE: Invoice", "re:Invoice", "AW: Invoice",
                    "Fwd: Invoice", "FW: Invoice", "SV: Invoice"):
            self.assertEqual(threading.normalise_subject(raw), "invoice")

    def test_stacked_prefixes_are_all_stripped(self):
        """One pass leaves half of a real subject line behind."""
        self.assertEqual(
            threading.normalise_subject("Re: Fwd: RE: [Vendors] Q3 pricing"),
            "q3 pricing")

    def test_numbered_prefixes(self):
        self.assertEqual(threading.normalise_subject("Re[2]: Invoice"), "invoice")

    def test_whitespace_is_collapsed(self):
        self.assertEqual(threading.normalise_subject("  Q3   pricing  "), "q3 pricing")

    def test_a_subject_that_is_only_a_prefix_becomes_empty(self):
        self.assertEqual(threading.normalise_subject("Re:"), "")


class ReferenceTests(SimpleTestCase):
    def test_a_reply_joins_its_parent(self):
        a = Msg(mid="<a@x>", subject="Hello")
        b = Msg(mid="<b@x>", parent="<a@x>", subject="Re: Hello")
        ids = threading.assign([a, b])
        self.assertEqual(ids[0], ids[1])

    def test_a_long_chain_stays_one_conversation(self):
        msgs = [Msg(mid="<1@x>", subject="Plan")]
        for n in range(2, 8):
            msgs.append(Msg(mid="<%d@x>" % n, parent="<%d@x>" % (n - 1),
                            refs=["<%d@x>" % i for i in range(1, n)],
                            subject="Re: Plan"))
        ids = threading.assign(msgs)
        self.assertEqual(len(set(ids)), 1)

    def test_a_missing_middle_message_still_threads(self):
        """The reply we never received is exactly why every id in References
        is joined, not only the last one."""
        a = Msg(mid="<a@x>", subject="Plan")
        c = Msg(mid="<c@x>", parent="<b@x>", refs=["<a@x>", "<b@x>"],
                subject="Re: Plan")
        ids = threading.assign([a, c])
        self.assertEqual(ids[0], ids[1])

    def test_unrelated_messages_stay_apart(self):
        ids = threading.assign([
            Msg(mid="<a@x>", subject="Invoice 1"),
            Msg(mid="<b@x>", subject="Completely different"),
        ])
        self.assertNotEqual(ids[0], ids[1])

    def test_thread_ids_are_stable_across_runs(self):
        """A conversation must keep its id between syncs, or the UI loses its
        place every time we refresh."""
        msgs = [Msg(mid="<a@x>", subject="Plan"),
                Msg(mid="<b@x>", parent="<a@x>", subject="Re: Plan")]
        self.assertEqual(threading.assign(msgs), threading.assign(list(msgs)))


class SubjectFallbackTests(SimpleTestCase):
    def test_messages_with_no_references_thread_on_subject(self):
        """Some senders emit a bare Message-ID and nothing else."""
        now = timezone.now()
        ids = threading.assign([
            Msg(mid="<a@x>", subject="Q3 pricing", when=now - timedelta(days=1)),
            Msg(mid="<b@x>", subject="Re: Q3 pricing", when=now),
        ])
        self.assertEqual(ids[0], ids[1])

    def test_the_same_subject_a_year_apart_does_not_thread(self):
        now = timezone.now()
        ids = threading.assign([
            Msg(mid="<a@x>", subject="Renewal notice", when=now - timedelta(days=365)),
            Msg(mid="<b@x>", subject="Renewal notice", when=now),
        ])
        self.assertNotEqual(ids[0], ids[1])

    def test_references_win_over_subject(self):
        """Two vendors both saying "Invoice" must not merge just because the
        subject matches — the reference graph is the stronger signal."""
        now = timezone.now()
        ids = threading.assign([
            Msg(mid="<a@dell>", subject="Invoice", when=now),
            Msg(mid="<b@dell>", parent="<a@dell>", subject="Re: Invoice", when=now),
        ])
        self.assertEqual(ids[0], ids[1])

    def test_an_empty_subject_never_threads_on_subject(self):
        now = timezone.now()
        ids = threading.assign([Msg(mid="<a@x>", subject="", when=now),
                                Msg(mid="<b@x>", subject="", when=now)])
        self.assertNotEqual(ids[0], ids[1])


class MalformedTests(SimpleTestCase):
    def test_messages_with_no_message_id_do_not_collide(self):
        ids = threading.assign([Msg(subject="One"), Msg(subject="Two")])
        self.assertNotEqual(ids[0], ids[1])

    def test_an_empty_list_is_fine(self):
        self.assertEqual(threading.assign([]), [])

    def test_a_self_referencing_message_does_not_loop(self):
        ids = threading.assign([Msg(mid="<a@x>", parent="<a@x>", subject="Odd")])
        self.assertEqual(len(ids), 1)

"""Composing, undo-send, and filing the copy in Sent.

The tests that matter here are the refusals and the ordering: nothing may
reach Exim during the undo window, a copy must never be filed for a message
that was refused, and nobody may send as somebody else.
"""
from unittest import mock

from django.utils import timezone

from mailcore import outbox, smtp_client
from mailcore.models import PendingAction

from .base import MailTestCase


class Sent:
    """Records what would have been submitted."""

    def __init__(self, fail=None):
        self.messages = []
        self.fail = fail

    def __call__(self, session, msg, recipients=None):
        if self.fail:
            raise self.fail
        self.messages.append(msg)
        return msg["Message-ID"]


def draft(**over):
    base = {"to": ["priya@terafort.com"], "subject": "Hello", "text": "Hi there"}
    base.update(over)
    return base


class BuildTests(MailTestCase):
    def test_html_is_sent_as_multipart_alternative(self):
        """A text/html-only message is what spam filters expect from spam."""
        msg = smtp_client.build_message(
            sender="alice@terafort.com", sender_name="Alice",
            to=["b@x.com"], subject="Hi", text="plain", html="<p>rich</p>")
        self.assertTrue(msg.is_multipart())
        types = {p.get_content_type() for p in msg.walk()}
        self.assertIn("text/plain", types)
        self.assertIn("text/html", types)

    def test_a_reply_carries_threading_headers(self):
        msg = smtp_client.build_message(
            sender="alice@terafort.com", sender_name="", to=["b@x.com"],
            subject="Re: Plan", text="ok",
            in_reply_to="<a@x>", references=["<root@x>"])
        self.assertEqual(msg["In-Reply-To"], "<a@x>")
        self.assertIn("<root@x>", msg["References"])
        self.assertIn("<a@x>", msg["References"])

    def test_every_message_gets_a_message_id(self):
        msg = smtp_client.build_message(
            sender="alice@terafort.com", sender_name="", to=["b@x.com"],
            subject="x", text="y")
        self.assertTrue(msg["Message-ID"].startswith("<"))

    def test_bcc_is_stripped_before_submission(self):
        """Leaving it on is how blind copies stop being blind."""
        msg = smtp_client.build_message(
            sender="alice@terafort.com", sender_name="", to=["b@x.com"],
            subject="x", text="y")
        msg["Bcc"] = "secret@x.com"
        recipients = smtp_client._all_recipients(msg)
        self.assertIn("secret@x.com", recipients)
        self.assertIsNone(msg.get("Bcc"))


class ForgeryTests(MailTestCase):
    def test_you_cannot_send_as_somebody_else(self):
        """Exim will often accept a forged From from an authenticated user.
        Refusing it is our job."""
        msg = smtp_client.build_message(
            sender="ceo@terafort.com", sender_name="CEO",
            to=["finance@terafort.com"], subject="Pay this", text="now")
        with self.assertRaises(smtp_client.SmtpRejected) as ctx:
            smtp_client.send(self.alice.session, msg)
        self.assertIn("must be your own address", str(ctx.exception))

    def test_a_message_with_no_recipients_is_refused(self):
        msg = smtp_client.build_message(
            sender=self.alice.address, sender_name="", to=[], subject="x", text="y")
        with self.assertRaises(smtp_client.SmtpRejected):
            smtp_client.send(self.alice.session, msg)


class UndoTests(MailTestCase):
    def test_queueing_sends_nothing_yet(self):
        """The whole point: nothing reaches Exim during the window."""
        sender = Sent()
        with mock.patch.object(smtp_client, "send", sender):
            action = outbox.queue(self.alice.session, draft())
            outbox.run_due(self.alice.session, now=timezone.now())
        self.assertEqual(sender.messages, [])
        self.assertEqual(PendingAction.objects.for_session(
            self.alice.session).get(id=action.id).state, "scheduled")

    def test_the_draft_is_encrypted_while_it_waits(self):
        outbox.queue(self.alice.session, draft(text="commercially sensitive"))
        blob = bytes(PendingAction.objects.for_session(self.alice.session).first().payload_enc)
        self.assertNotIn(b"commercially sensitive", blob)

    def test_undo_returns_the_draft_intact(self):
        action = outbox.queue(self.alice.session, draft(subject="Half finished"))
        recovered = outbox.cancel(self.alice.session, action.id)
        self.assertEqual(recovered["subject"], "Half finished")
        self.assertEqual(PendingAction.objects.for_session(
            self.alice.session).get(id=action.id).state, "cancelled")

    def test_undoing_twice_is_refused(self):
        action = outbox.queue(self.alice.session, draft())
        outbox.cancel(self.alice.session, action.id)
        with self.assertRaises(outbox.OutboxError):
            outbox.cancel(self.alice.session, action.id)

    def test_bob_cannot_undo_alices_send(self):
        action = outbox.queue(self.alice.session, draft())
        with self.assertRaises(outbox.OutboxError):
            outbox.cancel(self.bob.session, action.id)

    def test_it_goes_once_the_window_closes(self):
        sender = Sent()
        with mock.patch.object(smtp_client, "send", sender), \
             mock.patch.object(outbox, "file_in_sent", lambda *a, **k: True), \
             mock.patch.object(outbox.imap_client, "for_session",
                               lambda s: _null_conn()):
            outbox.queue(self.alice.session, draft(), delay_seconds=0)
            report = outbox.run_due(self.alice.session)
        self.assertEqual(len(sender.messages), 1)
        self.assertEqual(len(report["sent"]), 1)


class SendResultTests(MailTestCase):
    def test_a_refused_message_is_not_filed_in_sent(self):
        """A copy in Sent for a message that was refused is a worse lie than
        a missing copy."""
        filed = []
        with mock.patch.object(smtp_client, "send",
                               Sent(fail=smtp_client.SmtpRejected("no such user"))), \
             mock.patch.object(outbox, "file_in_sent",
                               lambda *a, **k: filed.append(True) or True), \
             mock.patch.object(outbox.imap_client, "for_session", lambda s: _null_conn()):
            outbox.queue(self.alice.session, draft(), delay_seconds=0)
            report = outbox.run_due(self.alice.session)
        self.assertEqual(filed, [])
        self.assertEqual(len(report["failed"]), 1)

    def test_a_refusal_is_final_but_an_outage_retries(self):
        with mock.patch.object(smtp_client, "send",
                               Sent(fail=smtp_client.SmtpUnavailable("down"))), \
             mock.patch.object(outbox.imap_client, "for_session", lambda s: _null_conn()):
            action = outbox.queue(self.alice.session, draft(), delay_seconds=0)
            outbox.run_due(self.alice.session)
        row = PendingAction.objects.for_session(self.alice.session).get(id=action.id)
        self.assertEqual(row.state, "scheduled", "an outage should retry, not fail")
        self.assertEqual(row.attempts, 1)

        with mock.patch.object(smtp_client, "send",
                               Sent(fail=smtp_client.SmtpRejected("mailbox full"))), \
             mock.patch.object(outbox.imap_client, "for_session", lambda s: _null_conn()):
            outbox.run_due(self.alice.session)
        row.refresh_from_db()
        self.assertEqual(row.state, "failed", "a refusal will be refused again")

    def test_a_failure_to_file_does_not_fail_the_send(self):
        """Delivered but unfiled is an annoyance; a failed send makes the user
        send it twice."""
        with mock.patch.object(smtp_client, "send", Sent()), \
             mock.patch.object(outbox, "file_in_sent", lambda *a, **k: False), \
             mock.patch.object(outbox.imap_client, "for_session", lambda s: _null_conn()):
            outbox.queue(self.alice.session, draft(), delay_seconds=0)
            report = outbox.run_due(self.alice.session)
        self.assertEqual(len(report["sent"]), 1)
        self.assertEqual(report["failed"], [])


class ReplyContextTests(MailTestCase):
    def test_reply_all_drops_your_own_address(self):
        """Mailing yourself a copy of your own reply is noise."""
        from mailcore import crypto, sync
        payload = {
            "subject": "Plan", "from_name": "Priya", "from_addr": "priya@terafort.com",
            "to": [{"name": "You", "address": self.alice.address},
                   {"name": "Marcus", "address": "marcus@terafort.com"}],
            "cc": [], "reply_to": "", "message_id": "<a@x>", "references": [],
        }
        self.alice.message.envelope_enc = crypto.seal(
            self.alice.dek, sync._json(payload).encode(),
            aad=str(self.alice.mailbox.id).encode())
        self.alice.message.save(update_fields=["envelope_enc"])

        context = outbox.reply_context(self.alice.session, self.alice.message)
        self.assertEqual(context["to"], ["priya@terafort.com"])
        self.assertIn("marcus@terafort.com", context["cc_all"])
        self.assertNotIn(self.alice.address, context["cc_all"])
        self.assertEqual(context["in_reply_to"], "<a@x>")

    def test_the_subject_is_not_double_prefixed(self):
        from mailcore import crypto, sync
        payload = {"subject": "Re: Plan", "from_name": "", "from_addr": "p@x.com",
                   "to": [], "cc": [], "reply_to": "", "message_id": "<a@x>",
                   "references": []}
        self.alice.message.envelope_enc = crypto.seal(
            self.alice.dek, sync._json(payload).encode(),
            aad=str(self.alice.mailbox.id).encode())
        self.alice.message.save(update_fields=["envelope_enc"])
        context = outbox.reply_context(self.alice.session, self.alice.message)
        self.assertEqual(context["subject"], "Re: Plan")


class ComposeApiTests(MailTestCase):
    def test_sending_queues_and_reports_the_undo_window(self):
        r = self.as_(self.alice).post(
            "/api/compose/send",
            {"to": "priya@terafort.com", "subject": "Hi", "text": "there"},
            content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["undo_seconds"], outbox.UNDO_SECONDS)
        self.assertEqual(r.json()["kind"], "UNDO_WINDOW")

    def test_a_message_with_no_recipient_is_refused(self):
        r = self.as_(self.alice).post(
            "/api/compose/send", {"subject": "Hi", "text": "there"},
            content_type="application/json")
        self.assertEqual(r.status_code, 400)

    def test_scheduling_past_the_session_says_so_up_front(self):
        """Said now, not discovered days later."""
        r = self.as_(self.alice).post(
            "/api/compose/send",
            {"to": "p@x.com", "subject": "Later", "text": "x",
             "send_in_seconds": 60 * 60 * 24 * 3},
            content_type="application/json")
        self.assertEqual(r.json()["kind"], "SEND_LATER")
        self.assertIn("next sign in", r.json()["note"])

    def test_scheduling_absurdly_far_ahead_is_refused(self):
        r = self.as_(self.alice).post(
            "/api/compose/send",
            {"to": "p@x.com", "text": "x", "send_in_seconds": 60 * 60 * 24 * 400},
            content_type="application/json")
        self.assertEqual(r.status_code, 400)

    def test_undo_over_the_api(self):
        client = self.as_(self.alice)
        queued = client.post("/api/compose/send",
                             {"to": "p@x.com", "subject": "Oops", "text": "x"},
                             content_type="application/json").json()
        r = client.post("/api/compose/undo", {"id": queued["id"]},
                        content_type="application/json")
        self.assertTrue(r.json()["cancelled"])
        self.assertEqual(r.json()["draft"]["subject"], "Oops")

    def test_bob_cannot_undo_alices_message(self):
        queued = self.as_(self.alice).post(
            "/api/compose/send", {"to": "p@x.com", "text": "x"},
            content_type="application/json").json()
        r = self.as_(self.bob).post("/api/compose/undo", {"id": queued["id"]},
                                    content_type="application/json")
        self.assertEqual(r.status_code, 409)

    def test_the_outbox_lists_only_your_own(self):
        self.as_(self.alice).post("/api/compose/send",
                                  {"to": "p@x.com", "subject": "Mine", "text": "x"},
                                  content_type="application/json")
        self.assertEqual(len(self.as_(self.alice).get("/api/outbox").json()["pending"]), 1)
        self.assertEqual(len(self.as_(self.bob).get("/api/outbox").json()["pending"]), 0)

    def test_recipients_accept_commas_and_semicolons(self):
        r = self.as_(self.alice).post(
            "/api/compose/send",
            {"to": "a@x.com, b@x.com; c@x.com", "text": "x"},
            content_type="application/json")
        self.assertEqual(r.status_code, 200)
        pending = self.as_(self.alice).get("/api/outbox").json()["pending"][0]
        self.assertEqual(len(pending["to"]), 3)


class _null_conn:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

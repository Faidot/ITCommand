"""The read path, end to end, against a fake IMAP server.

No network. The fake answers the same shapes `imap_client` produces, so the
sync layer, the cache and the API are all exercised for real — only the socket
is pretended.
"""
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from mailcore import crypto, imap_client, sync
from mailcore.models import Folder, Message

from .base import MailTestCase


def env(uid, subject="Hello", sender="priya@terafort.com", name="Priya Raman",
        mid=None, parent="", refs=None, flags=None, minutes=0, list_id=""):
    return imap_client.Envelope(
        uid=uid,
        flags=flags if flags is not None else [],
        internal_date=timezone.now() - timedelta(minutes=minutes),
        size=2048,
        subject=subject,
        from_name=name,
        from_addr=sender,
        to=[{"name": "You", "address": "alice@terafort.com"}],
        message_id=mid or "<%d@terafort.com>" % uid,
        in_reply_to=parent,
        references=refs or [],
        list_id=list_id,
    )


class FakeImap:
    """Answers what a real connection would, and records what was asked."""

    def __init__(self, folders=None, messages=None, body=None):
        self.folders = folders if folders is not None else [
            imap_client.FolderInfo("INBOX", "."),
            imap_client.FolderInfo("INBOX.Sent", ".", special_use="\\Sent"),
            imap_client.FolderInfo("INBOX.Trash", ".", special_use="\\Trash"),
        ]
        self.messages = messages if messages is not None else [env(1), env(2, "Second")]
        self.body = body or imap_client.MessageBody(
            text="Hello there", html="<p>Hello <b>there</b></p>")
        self.uidvalidity = 100
        self.selected = None
        self.flag_calls = []

    def list_folders(self):
        return self.folders

    def select(self, folder, readonly=True):
        self.selected = folder
        return {"exists": len(self._in(folder)), "uidvalidity": self.uidvalidity,
                "uidnext": 99, "unseen": 0}

    def _in(self, folder):
        return self.messages if folder == "INBOX" else []

    def recent_uids(self, limit=500):
        return [m.uid for m in self._in(self.selected)][-limit:]

    def fetch_envelopes(self, uids):
        return [m for m in self._in(self.selected) if m.uid in uids]

    def fetch_body(self, uid):
        return self.body

    def store_flags(self, uid, flags, add=True):
        self.flag_calls.append((uid, flags, add))


@contextmanager
def fake_session(fake):
    yield fake


def patched(fake):
    return mock.patch.object(
        imap_client, "for_session", lambda session: fake_session(fake))


class SyncTests(MailTestCase):
    def test_folders_are_discovered_with_their_special_use(self):
        fake = FakeImap()
        with patched(fake), mock.patch.object(sync.imap_client, "for_session",
                                              lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
        paths = set(Folder.objects.for_mailbox(self.alice.mailbox)
                    .values_list("imap_path", flat=True))
        self.assertIn("INBOX", paths)
        sent = Folder.objects.for_mailbox(self.alice.mailbox).get(imap_path="INBOX.Sent")
        self.assertEqual(sent.special_use, "\\Sent")

    def test_messages_are_cached_and_the_envelope_is_encrypted(self):
        fake = FakeImap()
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)

        rows = Message.objects.for_mailbox(self.alice.mailbox).filter(
            folder__imap_path="INBOX")
        self.assertEqual(rows.count(), 2)
        blob = bytes(rows.first().envelope_enc)
        self.assertNotIn(b"Priya", blob, "the sender was stored in the clear")
        self.assertNotIn(b"Hello", blob, "the subject was stored in the clear")

    def test_only_the_owning_session_can_open_an_envelope(self):
        fake = FakeImap()
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
        message = Message.objects.for_mailbox(self.alice.mailbox).first()

        opened = sync.open_envelope(self.alice.session, message)
        self.assertEqual(opened["from_addr"], "priya@terafort.com")
        with self.assertRaises(crypto.SealError):
            sync.open_envelope(self.bob.session, message)

    def test_a_uidvalidity_change_drops_the_folder_cache(self):
        """Every cached UID now points somewhere else. There is no partial
        recovery, so the whole folder is refetched."""
        fake = FakeImap()
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
            first = set(Message.objects.for_mailbox(self.alice.mailbox)
                        .filter(folder__imap_path="INBOX").values_list("id", flat=True))

            fake.uidvalidity = 200
            fake.messages = [env(1, "Different message")]
            sync.sync_mailbox(self.alice.session)

        second = set(Message.objects.for_mailbox(self.alice.mailbox)
                     .filter(folder__imap_path="INBOX").values_list("id", flat=True))
        self.assertFalse(first & second, "rows survived a UIDVALIDITY change")

    def test_syncing_twice_does_not_duplicate(self):
        fake = FakeImap()
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
            sync.sync_mailbox(self.alice.session)
        self.assertEqual(
            Message.objects.for_mailbox(self.alice.mailbox)
            .filter(folder__imap_path="INBOX").count(), 2)

    def test_flags_are_refreshed_for_messages_we_already_have(self):
        fake = FakeImap()
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
            fake.messages = [env(1, flags=["\\Seen"]), env(2, "Second")]
            sync.sync_mailbox(self.alice.session)
        row = Message.objects.for_mailbox(self.alice.mailbox).get(uid=1)
        self.assertTrue(row.seen)

    def test_bundles_are_applied_at_sync_time(self):
        fake = FakeImap(messages=[env(1, "Invoice INV-991", "billing@dell.com")])
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
        self.assertEqual(
            Message.objects.for_mailbox(self.alice.mailbox).get(uid=1).bundle, "Invoices")

    def test_replies_share_a_thread(self):
        fake = FakeImap(messages=[
            env(1, "Plan", mid="<a@x>"),
            env(2, "Re: Plan", mid="<b@x>", parent="<a@x>"),
        ])
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(self.alice.session)
        threads = set(Message.objects.for_mailbox(self.alice.mailbox)
                      .filter(folder__imap_path="INBOX").values_list("thread_id", flat=True))
        self.assertEqual(len(threads), 1)


class ReadApiTests(MailTestCase):
    def _sync(self, who, fake):
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)):
            sync.sync_mailbox(who.session)

    def test_the_list_returns_decrypted_envelopes(self):
        fake = FakeImap()
        self._sync(self.alice, fake)
        r = self.as_(self.alice).get("/api/messages")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["count"], 2)
        self.assertEqual(body["results"][0]["from_address"], "priya@terafort.com")

    def test_bob_never_sees_alices_messages(self):
        fake = FakeImap()
        self._sync(self.alice, fake)
        r = self.as_(self.bob).get("/api/messages")
        addresses = [m["from_address"] for m in r.json()["results"]]
        self.assertNotIn("priya@terafort.com", addresses)

    def test_a_bundle_filters_the_list(self):
        fake = FakeImap(messages=[
            env(1, "Invoice INV-991", "billing@dell.com"),
            env(2, "Lunch?", "priya@terafort.com"),
        ])
        self._sync(self.alice, fake)
        r = self.as_(self.alice).get("/api/messages", {"bundle": "Invoices"})
        self.assertEqual(r.json()["count"], 1)
        self.assertEqual(r.json()["results"][0]["bundle"], "Invoices")

    def test_an_unknown_bundle_is_refused(self):
        self.assertEqual(
            self.as_(self.alice).get("/api/messages", {"bundle": "Nonsense"}).status_code,
            400)

    def test_opening_a_message_returns_sanitised_html_and_marks_it_read(self):
        fake = FakeImap()
        self._sync(self.alice, fake)
        message = Message.objects.for_mailbox(self.alice.mailbox).filter(
            folder__imap_path="INBOX").first()

        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)), \
             mock.patch.object(__import__("mailcore.views_mail", fromlist=["x"]).imap_client,
                               "for_session", lambda s: fake_session(fake)):
            r = self.as_(self.alice).get("/api/messages/%s/body" % message.id)

        self.assertEqual(r.status_code, 200)
        self.assertIn("Hello", r.json()["html"])
        message.refresh_from_db()
        self.assertTrue(message.seen)

    def test_a_script_in_a_body_never_reaches_the_client(self):
        fake = FakeImap(body=imap_client.MessageBody(
            text="hi", html='<p>hi</p><script>alert(1)</script>'))
        self._sync(self.alice, fake)
        message = Message.objects.for_mailbox(self.alice.mailbox).filter(
            folder__imap_path="INBOX").first()
        with mock.patch.object(sync.imap_client, "for_session", lambda s: fake_session(fake)), \
             mock.patch.object(__import__("mailcore.views_mail", fromlist=["x"]).imap_client,
                               "for_session", lambda s: fake_session(fake)):
            r = self.as_(self.alice).get("/api/messages/%s/body" % message.id)
        self.assertNotIn("script", r.json()["html"].lower())

    def test_bob_gets_404_on_alices_message_body(self):
        fake = FakeImap()
        self._sync(self.alice, fake)
        message = Message.objects.for_mailbox(self.alice.mailbox).first()
        r = self.as_(self.bob).get("/api/messages/%s/body" % message.id)
        self.assertEqual(r.status_code, 404)

    def test_starring_a_message(self):
        fake = FakeImap()
        self._sync(self.alice, fake)
        message = Message.objects.for_mailbox(self.alice.mailbox).first()
        with mock.patch.object(__import__("mailcore.views_mail", fromlist=["x"]).imap_client,
                               "for_session", lambda s: fake_session(fake)):
            r = self.as_(self.alice).post(
                "/api/messages/%s/flag" % message.id,
                {"action": "star"}, content_type="application/json")
        self.assertTrue(r.json()["flagged"])
        self.assertIn((message.uid, ["\\Flagged"], True), fake.flag_calls)

    def test_an_imap_failure_does_not_lose_the_local_change(self):
        """The user has already seen the star appear. Reconciling later is a
        better trade than failing the request."""
        fake = FakeImap()
        self._sync(self.alice, fake)
        message = Message.objects.for_mailbox(self.alice.mailbox).first()

        def boom(session):
            raise OSError("network gone")

        with mock.patch.object(__import__("mailcore.views_mail", fromlist=["x"]).imap_client,
                               "for_session", boom):
            r = self.as_(self.alice).post(
                "/api/messages/%s/flag" % message.id,
                {"action": "star"}, content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["flagged"])
        self.assertFalse(r.json()["synced_to_server"])

    def test_report_phishing_quarantines_and_hides_it(self):
        fake = FakeImap()
        self._sync(self.alice, fake)
        message = Message.objects.for_mailbox(self.alice.mailbox).first()
        client = self.as_(self.alice)
        before = client.get("/api/messages").json()["count"]

        r = client.post("/api/messages/%s/report-phishing" % message.id,
                        {}, content_type="application/json")
        self.assertTrue(r.json()["quarantined"])
        self.assertEqual(client.get("/api/messages").json()["count"], before - 1)

    def test_loading_images_is_explicit_and_per_message(self):
        fake = FakeImap()
        self._sync(self.alice, fake)
        message = Message.objects.for_mailbox(self.alice.mailbox).first()
        r = self.as_(self.alice).post("/api/messages/%s/load-images" % message.id,
                                      {}, content_type="application/json")
        self.assertTrue(r.json()["images_allowed"])
        message.refresh_from_db()
        self.assertTrue(message.images_allowed)

    def test_a_thread_returns_its_messages_oldest_first(self):
        fake = FakeImap(messages=[
            env(1, "Plan", mid="<a@x>", minutes=60),
            env(2, "Re: Plan", mid="<b@x>", parent="<a@x>", minutes=10),
        ])
        self._sync(self.alice, fake)
        thread_id = Message.objects.for_mailbox(self.alice.mailbox).filter(
            folder__imap_path="INBOX").first().thread_id
        r = self.as_(self.alice).get("/api/threads/%s" % thread_id)
        self.assertEqual(r.status_code, 200)
        subjects = [m["subject"] for m in r.json()["messages"]]
        self.assertEqual(subjects, ["Plan", "Re: Plan"])

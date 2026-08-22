"""Shared fixtures. Two real mailboxes, two real sessions, no mocking of the
thing under test."""
from __future__ import annotations

import base64
import uuid
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from mailcore import crypto, sessions
from mailcore.models import Folder, Mailbox, Message


class MailboxFixture:
    """One mailbox, its session, and one of everything it can own."""

    def __init__(self, address: str, password: str = "correct horse"):
        self.address = address
        self.password = password
        salt = crypto.new_salt()
        self.dek = crypto.new_key()
        self.mailbox = Mailbox.objects.create(
            address=address,
            kek_salt=salt,
            wrapped_dek=crypto.wrap_dek(self.dek, password, salt),
            totp_secret="JBSWY3DPEHPK3PXP",
            totp_confirmed_at=timezone.now(),
        )
        self.folder = Folder.objects.create(
            mailbox=self.mailbox, imap_path="INBOX", special_use="", uidvalidity=1)
        self.thread_id = uuid.uuid4()
        self.message = Message.objects.create(
            mailbox=self.mailbox, folder=self.folder, uid=1,
            thread_id=self.thread_id,
            internal_date=timezone.now() - timedelta(minutes=5),
            flags=["\\Seen"], bundle="Invoices",
            envelope_enc=crypto.seal(self.dek, b'{"subject":"private"}',
                                     aad=str(self.mailbox.id).encode()),
        )
        self.session = sessions.get_store().create_session(
            mailbox_address=address,
            mailbox_id=str(self.mailbox.id),
            credential=password,
            dek_b64=base64.b64encode(self.dek).decode("ascii"),
            ua_hash="", ip="127.0.0.1",
        )

    @property
    def object_ids(self) -> dict:
        """Every client-visible identifier this mailbox owns.

        The sweep tries all of them against the other mailbox's session.
        """
        return {
            "message_id": str(self.message.id),
            "folder_id": str(self.folder.id),
            "thread_id": str(self.thread_id),
        }


class MailTestCase(TestCase):
    def setUp(self):
        super().setUp()
        sessions.reset_store()          # each test starts with an empty store
        self.alice = MailboxFixture("alice@terafort.com")
        self.bob = MailboxFixture("bob@terafort.com")

    def tearDown(self):
        sessions.reset_store()
        super().tearDown()

    def as_(self, who: MailboxFixture):
        """Return a test client carrying that mailbox's session cookie."""
        from django.test import Client
        from django.conf import settings
        c = Client()
        c.cookies[settings.MAIL_SESSION_COOKIE] = who.session.sid
        return c

    @staticmethod
    def unknown_uuid() -> str:
        return str(uuid.uuid4())

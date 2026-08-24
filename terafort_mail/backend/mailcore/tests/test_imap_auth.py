"""Telling a rejected password apart from an unreachable server.

This distinction is the whole reason ImapUnavailable exists, and it was broken
in the first version: PermissionError subclasses OSError, so the handler meant
for network faults caught the rejection and reported an outage. Users were
told the mail server was down when their password was simply wrong.
"""
import imaplib
import socket
import ssl
from unittest import mock

from django.test import SimpleTestCase

from mailcore import imap_auth


class FakeConn:
    def __init__(self, on_login=None):
        self.on_login = on_login
        self.capabilities = (b"IMAP4REV1", b"IDLE")
        self.logged_out = False

    def login(self, address, password):
        if self.on_login:
            raise self.on_login
        return "OK", [b"Logged in"]

    def logout(self):
        self.logged_out = True


class ErrorMappingTests(SimpleTestCase):
    def _authenticate(self, conn):
        with mock.patch.object(imap_auth, "_connect", return_value=conn):
            return imap_auth.authenticate("alice@terafort.com", "pw")

    def test_a_rejected_password_raises_permission_error(self):
        """The regression. It used to raise ImapUnavailable."""
        conn = FakeConn(on_login=imaplib.IMAP4.error("AUTHENTICATIONFAILED"))
        with self.assertRaises(PermissionError):
            self._authenticate(conn)

    def test_a_rejected_password_is_not_reported_as_an_outage(self):
        conn = FakeConn(on_login=imaplib.IMAP4.error("AUTHENTICATIONFAILED"))
        try:
            self._authenticate(conn)
        except imap_auth.ImapUnavailable:
            self.fail("a wrong password was reported as an unreachable server")
        except PermissionError:
            pass

    def test_a_dropped_connection_is_an_outage(self):
        for failure in (OSError("connection reset"), socket.timeout("timed out"),
                        ssl.SSLError("handshake failed")):
            conn = FakeConn(on_login=failure)
            with self.assertRaises(imap_auth.ImapUnavailable):
                self._authenticate(conn)

    def test_an_outage_is_not_reported_as_a_bad_password(self):
        conn = FakeConn(on_login=OSError("connection reset"))
        with self.assertRaises(imap_auth.ImapUnavailable):
            self._authenticate(conn)

    def test_a_successful_login_returns_capabilities(self):
        conn = FakeConn()
        caps = self._authenticate(conn)
        self.assertTrue(caps.idle)

    def test_the_connection_is_always_closed(self):
        """Including when the credential was refused."""
        conn = FakeConn(on_login=imaplib.IMAP4.error("nope"))
        with self.assertRaises(PermissionError):
            self._authenticate(conn)
        self.assertTrue(conn.logged_out)

    def test_permission_error_really_is_an_oserror(self):
        """The fact that made the bug possible. Pinned so nobody 'simplifies'
        the handler back together."""
        self.assertTrue(issubclass(PermissionError, OSError))

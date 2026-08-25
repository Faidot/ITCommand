"""The cross-mailbox harness.

This is the suite the brief asked for: not a handful of hand-written cases but
a sweep that enumerates the router, so a new endpoint added in six months
fails the build the moment it is registered without isolation.

Four separate things are tested, matching the four layers in the blueprint:

  test_route_sweep_*        layer 1+2  every route, every id, both mailboxes
  test_injected_*           layer 1    identifiers in the request are ignored
  test_manager_*            layer 2    an unscoped queryset is a runtime error
  test_rls_*                layer 3    the database refuses, without Django
  test_ciphertext_*         layer 4    the bytes are useless anyway
"""
from __future__ import annotations

import unittest

from django.conf import settings
from django.db import connection
from django.test import Client
from django.urls import get_resolver

from mailcore import crypto
from mailcore.managers import UnscopedQueryError
from mailcore.models import Folder, Mailbox, Message

from .base import MailTestCase


def _routes():
    """Every registered route, with the converters it takes.

    Returns [(name, pattern_string, {param: converter}), ...].
    """
    out = []
    for pattern in get_resolver().url_patterns:
        for sub in getattr(pattern, "url_patterns", [pattern]):
            rp = getattr(sub, "pattern", None)
            if rp is None:
                continue
            converters = getattr(rp, "converters", {}) or {}
            out.append((getattr(sub, "name", None), str(rp), converters))
    return out


#: Routes that legitimately take no session and therefore cannot leak one
#: mailbox's data into another. Anything NOT listed here and NOT parameterised
#: must still be reachable only with a session -- asserted below.
PUBLIC_ROUTES = {"mail_login", "mail_mfa", "mail_handoff", "mail_probe"}


class RouteSweepTests(MailTestCase):
    """Every parameterised route, every id Alice owns, asked for as Bob."""

    def test_every_uuid_route_is_covered_by_this_sweep(self):
        """Guard on the guard.

        If someone adds /api/threads/<uuid:thread_id> and does not extend the
        fixture, this fails and tells them to. Without it the sweep would
        quietly test fewer routes over time.
        """
        known = set(self.alice.object_ids)
        uncovered = []
        for name, pattern, converters in _routes():
            for param, conv in converters.items():
                if conv.__class__.__name__ == "UUIDConverter" and param not in known:
                    uncovered.append("%s (%s)" % (pattern, param))
        self.assertEqual(
            uncovered, [],
            "These routes take a UUID the isolation fixture does not supply, so "
            "they are NOT being swept. Add the identifier to "
            "MailboxFixture.object_ids: %s" % uncovered)

    def test_bob_gets_404_on_every_one_of_alices_objects(self):
        client = self.as_(self.bob)
        checked = 0
        for name, pattern, converters in _routes():
            if not converters:
                continue
            for param, value in self.alice.object_ids.items():
                if param not in converters:
                    continue
                url = "/" + pattern
                for p in converters:
                    url = url.replace("<uuid:%s>" % p, value)
                for method in ("get", "post", "put", "patch", "delete"):
                    resp = getattr(client, method)(url)
                    if resp.status_code == 405:
                        continue          # method not allowed is not a leak
                    checked += 1
                    self.assertEqual(
                        resp.status_code, 404,
                        "%s %s leaked Alice's %s to Bob (status %s)"
                        % (method.upper(), url, param, resp.status_code))
        self.assertGreater(checked, 0, "the sweep tested nothing -- fixture is wrong")

    def test_alice_can_reach_her_own_objects(self):
        """The mirror of the sweep. Without this, a route that 404s for
        everyone would pass the isolation test while being broken."""
        client = self.as_(self.alice)
        resp = client.get("/api/messages/%s" % self.alice.message.id)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["id"], str(self.alice.message.id))

    def test_no_session_reaches_nothing(self):
        anon = Client()
        for url in ("/api/me", "/api/folders",
                    "/api/messages/%s" % self.alice.message.id):
            resp = anon.get(url)
            self.assertIn(resp.status_code, (401, 403),
                          "%s answered an unauthenticated request with %s"
                          % (url, resp.status_code))

    def test_expired_session_reaches_nothing(self):
        from mailcore import sessions
        store = sessions.get_store()
        store.destroy_session(self.alice.session.sid)
        resp = self.as_(self.alice).get("/api/folders")
        self.assertIn(resp.status_code, (401, 403))


class InjectedIdentifierTests(MailTestCase):
    """Identifiers supplied by the client must be ignored, not validated.

    'Validated' still means the value reached a decision. These assert the
    response is byte-identical with and without them.
    """

    INJECTIONS = ("mailbox_id", "mailbox", "account_id", "user_id",
                  "address", "email", "sid")

    def test_query_string_identifiers_change_nothing(self):
        client = self.as_(self.bob)
        clean = client.get("/api/folders")
        for key in self.INJECTIONS:
            for value in (str(self.alice.mailbox.id), self.alice.address):
                dirty = client.get("/api/folders", {key: value})
                self.assertEqual(dirty.status_code, clean.status_code)
                self.assertEqual(dirty.content, clean.content,
                                 "?%s=%s changed the response" % (key, value))

    def test_body_identifiers_change_nothing(self):
        client = self.as_(self.bob)
        url = "/api/messages/%s/archive" % self.bob.message.id
        clean = client.post(url, {}, content_type="application/json")
        for key in self.INJECTIONS:
            dirty = client.post(url, {key: str(self.alice.mailbox.id)},
                                content_type="application/json")
            self.assertEqual(dirty.status_code, clean.status_code)

    def test_header_identifiers_change_nothing(self):
        client = self.as_(self.bob)
        clean = client.get("/api/me")
        dirty = client.get("/api/me",
                           HTTP_X_MAILBOX_ID=str(self.alice.mailbox.id),
                           HTTP_X_MAILBOX=self.alice.address)
        self.assertEqual(dirty.content, clean.content)
        self.assertEqual(clean.json()["mailbox"], self.bob.address)


class ManagerTests(MailTestCase):
    """Layer 2: forgetting to scope must be loud."""

    def test_unscoped_queryset_raises(self):
        for model in (Message, Folder):
            with self.assertRaises(UnscopedQueryError):
                list(model.objects.all())

    def test_for_session_requires_a_session(self):
        with self.assertRaises(UnscopedQueryError):
            Message.objects.for_session(None)

    def test_for_session_returns_only_that_mailbox(self):
        rows = Message.objects.for_session(self.alice.session)
        self.assertEqual([m.id for m in rows], [self.alice.message.id])

    def test_unscoped_escape_hatch_is_explicit(self):
        """`unscoped()` exists for migrations and admin tooling. It is the one
        grep target a security review needs."""
        self.assertEqual(Message.objects.unscoped().count(), 2)


class RowLevelSecurityTests(MailTestCase):
    """Layer 3: the database refuses, with Django taken out of the picture."""

    @unittest.skipUnless(connection.vendor == "postgresql",
                         "row-level security is a Postgres feature; this suite "
                         "runs on SQLite. Run against Postgres before deploying.")
    def test_raw_sql_as_bob_cannot_see_alices_rows(self):
        from mailcore.middleware import set_rls_mailbox
        set_rls_mailbox(self.bob.mailbox.id)
        with connection.cursor() as cur:
            cur.execute("SELECT count(*) FROM mail_message WHERE id = %s",
                        [str(self.alice.message.id)])
            self.assertEqual(cur.fetchone()[0], 0,
                             "RLS did not stop a raw query for another mailbox's row")

    @unittest.skipUnless(connection.vendor == "postgresql", "Postgres only")
    def test_unscoped_connection_sees_nothing(self):
        from mailcore.middleware import clear_rls_mailbox
        clear_rls_mailbox()
        with connection.cursor() as cur:
            cur.execute("SELECT count(*) FROM mail_message")
            self.assertEqual(cur.fetchone()[0], 0,
                             "a connection with no mailbox scope saw rows; the "
                             "policy must fail closed, not open")


class CiphertextTests(MailTestCase):
    """Layer 4: a row that escaped the other three is still not readable."""

    def test_bobs_key_cannot_open_alices_envelope(self):
        blob = bytes(self.alice.message.envelope_enc)
        with self.assertRaises(crypto.SealError):
            crypto.unseal(self.bob.dek, blob, aad=str(self.alice.mailbox.id).encode())

    def test_alices_own_key_opens_it(self):
        blob = bytes(self.alice.message.envelope_enc)
        opened = crypto.unseal(self.alice.dek, blob,
                               aad=str(self.alice.mailbox.id).encode())
        self.assertIn(b"private", opened)

    def test_envelope_is_bound_to_its_mailbox(self):
        """A row copied into another mailbox does not open even with the right
        key -- the mailbox id is authenticated data."""
        blob = bytes(self.alice.message.envelope_enc)
        with self.assertRaises(crypto.SealError):
            crypto.unseal(self.alice.dek, blob, aad=str(self.bob.mailbox.id).encode())


class NoAdminPathTests(MailTestCase):
    """The property that quietly erodes: nothing may grow a way to read
    another user's mail."""

    def test_django_admin_is_not_installed(self):
        self.assertNotIn("django.contrib.admin", settings.INSTALLED_APPS,
                         "the admin would expose every mail table to a staff user")

    def test_auth_app_is_not_installed(self):
        self.assertNotIn("django.contrib.auth", settings.INSTALLED_APPS,
                         "mail users must not have password hashes")

    def test_no_route_accepts_a_mailbox_selector(self):
        banned = ("mailbox_id", "mailbox_address", "account_id", "user_id")
        for name, pattern, converters in _routes():
            for param in converters:
                self.assertNotIn(
                    param, banned,
                    "route %r takes %r from the client; the mailbox must come "
                    "from the session alone" % (pattern, param))

    def test_mailbox_model_has_no_scoped_manager_bypass(self):
        """Mailbox itself is unscoped by necessity (login has to find it by
        address before a session exists). Assert it holds no message content,
        so that being unscoped is harmless."""
        field_names = {f.name for f in Mailbox._meta.get_fields()}
        for leaky in ("body_text_enc", "body_html_enc", "envelope_enc"):
            self.assertNotIn(leaky, field_names)

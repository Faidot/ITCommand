"""Row-level security plumbing.

Layer 3 of four. Django tells Postgres who is asking, once per request, and
Postgres does the filtering. The application role is not the table owner and
does not have BYPASSRLS, so this is not advisory.
"""
from __future__ import annotations

import logging

from django.db import connection

log = logging.getLogger("mailcore.rls")

#: Anything other than Postgres has no RLS. SQLite is used for the test suite,
#: where the route sweep still runs -- it just tests one fewer layer, and the
#: RLS test itself skips loudly rather than passing silently.
SUPPORTS_RLS = ("postgresql",)


def set_rls_mailbox(mailbox_id) -> bool:
    """Scope the current transaction to one mailbox. Returns False when the
    backend has no RLS, so callers can decide whether that is acceptable."""
    if connection.vendor not in SUPPORTS_RLS:
        return False
    with connection.cursor() as cur:
        # SET LOCAL is transaction-scoped, so a connection returned to the
        # pool cannot carry one user's scope into another user's request.
        # Parameterised: mailbox_id comes from a session, but SET LOCAL does
        # not accept placeholders, so it goes through set_config() instead.
        cur.execute("SELECT set_config('app.mailbox_id', %s, true)", [str(mailbox_id)])
    return True


def clear_rls_mailbox() -> None:
    if connection.vendor not in SUPPORTS_RLS:
        return
    with connection.cursor() as cur:
        cur.execute("SELECT set_config('app.mailbox_id', '', true)")


class RowLevelSecurityMiddleware:
    """Applies the session's mailbox scope to the database connection.

    Runs after authentication has attached `request.mail_session`. DRF
    authenticates inside the view, so this middleware reads the session lazily
    at first database use rather than at request start -- which is why views
    call `scope_to_session` rather than relying on middleware alone.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            return self.get_response(request)
        finally:
            # Belt and braces: the transaction ending drops SET LOCAL anyway,
            # but an autocommit connection would keep it.
            try:
                clear_rls_mailbox()
            except Exception:  # noqa: BLE001
                log.exception("failed to clear RLS scope")


def scope_to_session(request) -> None:
    """Call at the top of any view that touches mail data."""
    sess = getattr(request, "mail_session", None)
    if sess is None:
        raise RuntimeError("scope_to_session called on an unauthenticated request")
    set_rls_mailbox(sess.mailbox_id)

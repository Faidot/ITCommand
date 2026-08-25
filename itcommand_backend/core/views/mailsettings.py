"""The Mails tab: TeraMailer's admin panel, hosted inside IT Command.

Everything here proxies to TeraMailer over the signed service channel. Two
reasons it is worth the indirection rather than linking to TeraMailer's own
panel:

  * **One set of roles.** TeraMailer's panel has its own admin password.
    Hosting the settings here means IT Command's superadmin check is the only
    thing guarding them, and there is one fewer credential in circulation.
  * **One audit trail.** A change made here writes an IT Command audit row
    naming who made it. TeraMailer's own panel cannot, because it only knows
    that "admin" logged in.

TeraMailer verifies that the caller is IT Command and nothing more. It has no
idea what a superadmin is, so **every view here must do its own permission
check** — which is why the permission class is declared on the class rather
than left to a default.
"""
from __future__ import annotations

import logging

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from core import teramailer
from core.mixins import record_audit
from core.permissions import IsSuperadmin

log = logging.getLogger("core.mailsettings")

#: The settings sections TeraMailer exposes, as its routes actually name them.
#: Note "domain" rather than "app" — the config *section* is called app but the
#: route is /config/domain, and guessing cost a 404 before it was checked.
#:
#: Named explicitly rather than passed through from the request: this endpoint
#: must not become a way to write arbitrary keys into another service's config
#: file.
SECTIONS = ("domain", "imap", "smtp", "security")


def _unavailable(exc):
    return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


class MailSettingsView(APIView):
    """Read everything the Mails tab renders, in one call."""

    permission_classes = [IsSuperadmin]

    def get(self, request):
        if not teramailer.configured():
            # Not an error — a deployment that has not wired this up yet. The
            # UI shows setup instructions rather than a failure.
            return Response({
                "configured": False,
                "detail": "TeraMailer is not connected yet. Set TERAMAILER_URL and "
                          "TERAMAILER_SHARED_SECRET, and put the same secret in the "
                          "mail backend's .env as ITC_SHARED_SECRET.",
            })
        try:
            config = teramailer.get_config()
        except teramailer.TeraMailerError as exc:
            return _unavailable(exc)

        payload = {"configured": True, "config": config}
        # The dashboard is nice to have, not load-bearing. A failure there
        # must not blank out the settings the operator came here to change.
        try:
            payload["dashboard"] = teramailer.dashboard()
        except teramailer.TeraMailerError as exc:
            payload["dashboard_error"] = str(exc)
        return Response(payload)

    def post(self, request):
        """Write one section."""
        section = (request.data.get("section") or "").strip()
        values = request.data.get("values")

        if section not in SECTIONS:
            return Response(
                {"detail": "Unknown section %r. Expected one of: %s."
                           % (section, ", ".join(SECTIONS))},
                status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(values, dict):
            return Response({"detail": "values must be an object."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            updated = teramailer.update_section(section, values)
        except teramailer.TeraMailerError as exc:
            return _unavailable(exc)

        # The keys, never the values. A password or a secret could sit in any
        # of these sections, and an audit row is not the place for it.
        record_audit(request, "MAIL_SETTINGS_CHANGED", user=request.user,
                     changes={"section": section, "fields": sorted(values)})
        return Response({"section": section, "values": updated})


class MailSessionsView(APIView):
    """Who is signed in to the webmail right now, and ending one."""

    permission_classes = [IsSuperadmin]

    def get(self, request):
        try:
            return Response(teramailer.sessions())
        except teramailer.TeraMailerError as exc:
            return _unavailable(exc)

    def delete(self, request):
        session_id = (request.query_params.get("id") or "").strip()
        if not session_id:
            return Response({"detail": "id is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            teramailer.end_session(session_id)
        except teramailer.TeraMailerError as exc:
            return _unavailable(exc)
        record_audit(request, "MAIL_SESSION_ENDED", user=request.user,
                     changes={"session": session_id})
        return Response({"ok": True})


class MailLogsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        try:
            return Response(teramailer.logs())
        except teramailer.TeraMailerError as exc:
            return _unavailable(exc)


class MailTestView(APIView):
    """Reachability checks. A failed test is a result, not an error, so these
    answer 200 with ok:false rather than a 5xx — the UI shows the reason."""

    permission_classes = [IsSuperadmin]

    def post(self, request):
        which = (request.data.get("target") or "").strip().lower()
        if which == "imap":
            ok, message = teramailer.test_imap()
        elif which == "smtp":
            ok, message = teramailer.test_smtp(request.data.get("to") or "")
        else:
            return Response({"detail": "target must be 'imap' or 'smtp'."},
                            status=status.HTTP_400_BAD_REQUEST)

        record_audit(request, "MAIL_CONNECTION_TESTED", user=request.user,
                     changes={"target": which, "ok": ok})
        return Response({"ok": ok, "message": message, "target": which})

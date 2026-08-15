"""Factory reset endpoints. Superadmin only, and gated three ways.

``GET  /settings/reset/preview/`` — exactly what would be deleted
``POST /settings/reset/``        — delete it

The preview is not decoration. "Delete all data" is an abstraction, and the
number that makes somebody stop and think is the one that says 4,812 records
across 37 modules and names the three superadmins who will be left.
"""
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core import reset as app_reset
from core.mixins import AuditLogMixin
from core.permissions import IsSuperadmin


class AppResetPreviewView(APIView):
    """What a reset would remove. Writes nothing."""

    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    def get(self, request):
        return Response(app_reset.preview())


class AppResetView(AuditLogMixin, APIView):
    """Delete every record except the superadmins who run the app."""

    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    def post(self, request):
        password = request.data.get("password") or ""
        confirm = (request.data.get("confirm") or "").strip()

        # Checked before the password so that a half-filled form does not turn
        # into a password attempt, and so the slower hash comparison is not
        # reachable without the phrase.
        if confirm != app_reset.CONFIRM_PHRASE:
            return Response(
                {"detail": f'Type "{app_reset.CONFIRM_PHRASE}" exactly to confirm.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not request.user.check_password(password):
            return Response(
                {"detail": "That is not your password. Nothing was deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        before = app_reset.preview()
        try:
            deleted = app_reset.perform()
        except Exception as exc:
            # The transaction is already rolled back, so the database is
            # untouched. Say so plainly — after a request like this one,
            # "something went wrong" is not enough information to act on.
            return Response(
                {"detail": f"Nothing was deleted — the reset failed: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Written after the wipe, because the wipe removes the audit trail.
        # This row is the only remaining record that any of it happened.
        self.log_action("DELETE", request.user, {
            "action": "app_factory_reset",
            "records_deleted": sum(deleted.values()),
            "users_deleted": before["users_deleted"],
            "users_kept": [u["email"] for u in before["users_kept"]],
            "by_model": deleted,
        })
        return Response({
            "detail": "The app has been reset.",
            "records_deleted": sum(deleted.values()),
            "users_deleted": before["users_deleted"],
            "users_kept": len(before["users_kept"]),
            "by_model": deleted,
        })

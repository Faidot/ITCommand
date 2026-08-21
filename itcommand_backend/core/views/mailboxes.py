"""The mailbox console: every address on the mail server, managed from here.

Reading is cheap because it comes from the cached ManagedMailbox rows. Every
write calls cPanel first and updates the row only once the server has
accepted, so the console never shows a state the mail server does not agree
with.

Permission shape, in one place so it can be argued with:

    view / refresh          admin and superadmin
    password, quota,        admin and superadmin
    suspend, restore
    create standalone       admin and superadmin
    request deletion        admin and superadmin  (destroys nothing)
    cancel deletion         admin and superadmin
    purge                   SUPERADMIN only, typed confirmation, after grace
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core import cpanel, mailbox_admin
from core.mixins import record_audit
from core.models.mailboxes import ManagedMailbox
from core.models.users import User
from core.permissions import IsAdminOrSuperadmin, IsSuperadmin
from core.serializers.mailboxes import ManagedMailboxSerializer


class ManagedMailboxViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only by default; every change goes through a named action.

    A generic PATCH would let somebody set `suspended` without cPanel ever
    hearing about it, which is exactly the drift this design avoids.
    """

    queryset = ManagedMailbox.objects.select_related("user").all()
    serializer_class = ManagedMailboxSerializer
    permission_classes = [IsAdminOrSuperadmin]

    def get_permissions(self):
        # Purging is the only operation that destroys data. It is the only one
        # restricted further.
        if self.action == "purge":
            return [IsSuperadmin()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        search = params.get("search")
        if search:
            qs = qs.filter(address__icontains=search)

        state = params.get("status")
        if state == "shared":
            qs = qs.filter(user__isnull=True)
        elif state == "linked":
            qs = qs.filter(user__isnull=False)
        elif state == "suspended":
            qs = qs.filter(suspended=True)
        elif state == "pending_deletion":
            qs = qs.filter(deletion_requested_at__isnull=False, purged_at__isnull=True)
        elif state == "missing":
            qs = qs.filter(exists_in_cpanel=False, purged_at__isnull=True)
        elif state == "active":
            qs = qs.filter(suspended=False, exists_in_cpanel=True,
                           deletion_requested_at__isnull=True)

        if params.get("hide_purged", "true").lower() == "true":
            qs = qs.filter(purged_at__isnull=True)
        return qs

    # -- helpers ----------------------------------------------------------

    def _ok(self, box, message=None, **extra):
        payload = ManagedMailboxSerializer(box).data
        if message:
            payload["message"] = message
        payload.update(extra)
        return Response(payload)

    @staticmethod
    def _fail(exc, code=status.HTTP_400_BAD_REQUEST):
        return Response({"detail": str(exc)}, status=code)

    # -- sync -------------------------------------------------------------

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        """Re-read the mailbox list from cPanel. Changes nothing on the server."""
        try:
            report = mailbox_admin.sync_mailboxes()
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc, status.HTTP_503_SERVICE_UNAVAILABLE)
        record_audit(request, "MAILBOX_SYNC", user=request.user,
                     changes={"on_server": report["on_server"]})
        return Response(report)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Counts for the console header."""
        qs = ManagedMailbox.objects.filter(purged_at__isnull=True)
        return Response({
            "total": qs.count(),
            "linked": qs.filter(user__isnull=False).count(),
            "shared": qs.filter(user__isnull=True).count(),
            "suspended": qs.filter(suspended=True).count(),
            "pending_deletion": qs.filter(deletion_requested_at__isnull=False).count(),
            "missing": qs.filter(exists_in_cpanel=False).count(),
            "last_synced_at": qs.order_by("-last_synced_at")
                                .values_list("last_synced_at", flat=True).first(),
        })

    # -- create -----------------------------------------------------------

    @action(detail=False, methods=["post"], url_path="create-standalone")
    def create_standalone(self, request):
        """A mailbox with no IT Command user: info@, support@, an archive."""
        address = (request.data.get("address") or "").strip().lower()
        password = request.data.get("password") or ""
        quota = request.data.get("quota_mb")

        if not address:
            return Response({"address": ["An address is required."]},
                            status=status.HTTP_400_BAD_REQUEST)
        if not password:
            password = mailbox_admin_generate()
            generated = True
        else:
            generated = False

        try:
            box = mailbox_admin.create_standalone(
                address, password, quota_mb=int(quota) if quota else None,
                actor=request.user.email)
        except mailbox_admin.PasswordPolicyError as exc:
            return Response({"password": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc)

        record_audit(request, "MAILBOX_CREATED", user=request.user,
                     changes={"address": address, "shared": True})
        # Shown once. Not stored, and not recoverable.
        return self._ok(box, message="Mailbox created.",
                        password=password if generated else None,
                        password_generated=generated)

    # -- everyday operations ----------------------------------------------

    @action(detail=True, methods=["post"], url_path="set-password")
    def set_password(self, request, pk=None):
        box = self.get_object()
        password = request.data.get("password") or ""
        generated = False
        if not password:
            password = mailbox_admin_generate()
            generated = True
        try:
            mailbox_admin.set_password(box, password, actor=request.user.email)
        except mailbox_admin.PasswordPolicyError as exc:
            return Response({"password": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc, status.HTTP_503_SERVICE_UNAVAILABLE)

        record_audit(request, "MAILBOX_PASSWORD_CHANGED", obj=box.user, user=request.user,
                     changes={"address": box.address, "by": "admin"})
        note = ("This is the password for both IT Command and the mailbox."
                if box.user_id else "Mailbox password only — nobody signs in to "
                                    "IT Command with this address.")
        return self._ok(box, message="Password changed.",
                        password=password, password_generated=generated, note=note)

    @action(detail=True, methods=["post"], url_path="set-quota")
    def set_quota(self, request, pk=None):
        """Set the mailbox size limit.

        Accepts `quota_mb`, or `quota_gb` for the unit the console actually
        shows. `unlimited: true` removes the limit -- asked for by name rather
        than by passing zero, so it can never be reached by an empty field.
        """
        box = self.get_object()
        unlimited = bool(request.data.get("unlimited"))
        quota_mb = request.data.get("quota_mb")

        if not unlimited and quota_mb in (None, ""):
            gb = request.data.get("quota_gb")
            if gb in (None, ""):
                return Response(
                    {"quota_gb": ["A size is required, or set unlimited."]},
                    status=status.HTTP_400_BAD_REQUEST)
            try:
                quota_mb = round(float(gb) * 1024)
            except (TypeError, ValueError):
                return Response({"quota_gb": ["A number of gigabytes is required."]},
                                status=status.HTTP_400_BAD_REQUEST)

        try:
            box = mailbox_admin.set_quota(
                box,
                None if unlimited else int(quota_mb),
                unlimited=unlimited,
            )
        except (TypeError, ValueError):
            return Response({"quota_mb": ["A whole number of megabytes is required."]},
                            status=status.HTTP_400_BAD_REQUEST)
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc)

        record_audit(request, "MAILBOX_QUOTA_CHANGED", user=request.user,
                     changes={"address": box.address,
                              "quota_mb": box.quota_mb,
                              "unlimited": unlimited})
        return self._ok(box, message="Quota set to %s."
                        % ("unlimited" if unlimited else "%.6g GB" % (box.quota_mb / 1024)))

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        box = self.get_object()
        try:
            box = mailbox_admin.suspend(box)
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc, status.HTTP_503_SERVICE_UNAVAILABLE)
        record_audit(request, "MAILBOX_SUSPENDED", user=request.user,
                     changes={"address": box.address})
        return self._ok(box, message="Mailbox suspended. Every message is kept.")

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        box = self.get_object()
        try:
            box = mailbox_admin.unsuspend(box)
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc, status.HTTP_503_SERVICE_UNAVAILABLE)
        record_audit(request, "MAILBOX_RESTORED", user=request.user,
                     changes={"address": box.address})
        return self._ok(box, message="Mailbox restored.")

    # -- linking ----------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="link-user")
    def link_user(self, request, pk=None):
        """Attach a mailbox to an IT Command user, or detach it.

        Matching is by exact address only. Attaching the wrong person to a
        mailbox is an access-control bug, not a tidying-up mistake.
        """
        box = self.get_object()
        user_id = request.data.get("user")

        if user_id in (None, "", 0):
            box.user = None
            box.save(update_fields=["user"])
            record_audit(request, "MAILBOX_UNLINKED", user=request.user,
                         changes={"address": box.address})
            return self._ok(box, message="Mailbox detached from its user.")

        user = User.objects.filter(pk=user_id).first()
        if user is None:
            return Response({"user": ["No such user."]}, status=status.HTTP_400_BAD_REQUEST)
        if user.email.strip().lower() != box.address:
            return Response(
                {"user": ["%s does not own %s. A mailbox may only be linked to the "
                          "user whose email address matches it exactly."
                          % (user.email, box.address)]},
                status=status.HTTP_400_BAD_REQUEST)

        box.user = user
        box.save(update_fields=["user"])
        record_audit(request, "MAILBOX_LINKED", obj=user, user=request.user,
                     changes={"address": box.address})
        return self._ok(box, message="Mailbox linked to %s." % user.email)

    # -- deletion ---------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="request-deletion")
    def request_deletion(self, request, pk=None):
        """Mark for deletion and suspend. Nothing is destroyed."""
        box = self.get_object()
        try:
            box = mailbox_admin.request_deletion(
                box, by=request.user.email,
                reason=(request.data.get("reason") or "").strip())
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc)
        record_audit(request, "MAILBOX_DELETION_REQUESTED", user=request.user,
                     changes={"address": box.address, "purge_after": str(box.purge_after)})
        return self._ok(
            box,
            message="Marked for deletion and suspended. The mail is kept and fully "
                    "recoverable for %d more days." % (box.days_until_purge or 0))

    @action(detail=True, methods=["post"], url_path="cancel-deletion")
    def cancel_deletion(self, request, pk=None):
        box = self.get_object()
        try:
            box = mailbox_admin.cancel_deletion(box)
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc)
        record_audit(request, "MAILBOX_DELETION_CANCELLED", user=request.user,
                     changes={"address": box.address})
        return self._ok(box, message="Deletion cancelled and the mailbox restored.")

    @action(detail=True, methods=["post"])
    def purge(self, request, pk=None):
        """Destroy the mailbox and every message in it. Superadmin only.

        Three things must line up and none is decoration: marked for deletion,
        grace period elapsed (or explicitly forced), and the address typed back.
        This is the only operation in the application that loses data forever.
        """
        box = self.get_object()
        try:
            box = mailbox_admin.purge(
                box,
                actor=request.user.email,
                confirm_address=(request.data.get("confirm_address") or ""),
                force=bool(request.data.get("force")),
            )
        except mailbox_admin.MailboxAdminError as exc:
            return self._fail(exc, status.HTTP_409_CONFLICT)

        record_audit(request, "MAILBOX_PURGED", user=request.user,
                     changes={"address": box.address,
                              "forced": bool(request.data.get("force")),
                              "requested_by": box.deletion_requested_by})
        return self._ok(box, message="%s and all of its mail have been permanently "
                                     "deleted." % box.address)


def mailbox_admin_generate():
    """Generated password, matching what user creation hands out."""
    from core import mailbox_provisioning
    return mailbox_provisioning.generate_password()

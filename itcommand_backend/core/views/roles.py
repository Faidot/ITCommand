from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from core.models import Role, User
from core.serializers import RoleSerializer
from core.mixins import AuditLogMixin
from core.permissions import ReadOnlyViewerOrHigher, IsAdminOrSuperadmin
from core import rbac


class RoleViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Manage roles and their per-module permissions.

    Anyone signed in can read the role list (the app uses it to render labels
    and gate the UI); only admins/superadmins can create, edit or delete.
    """

    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAdminOrSuperadmin()]
        return super().get_permissions()

    @action(detail=False, methods=["get"])
    def catalog(self, request):
        """The catalog of modules and actions the permission matrix is built
        from. Lets the frontend render the grid without hard-coding it."""
        return Response({"modules": rbac.MODULES, "actions": rbac.ACTIONS})

    def destroy(self, request, *args, **kwargs):
        role = self.get_object()
        if role.is_system:
            return Response(
                {"detail": f'"{role.name}" is a built-in role and cannot be deleted.'},
                status=status.HTTP_409_CONFLICT,
            )
        in_use = User.objects.filter(role=role.slug).count()
        if in_use:
            return Response(
                {"detail": f'Cannot delete "{role.name}": {in_use} user(s) still have this role. '
                           f'Reassign them first.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

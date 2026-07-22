from rest_framework import permissions


def has_role_permission(user, module, action):
    """Return the effective JSON permission for a user/role.

    Keeping this lookup in one place lets queryset scoping use the same source
    of truth as ``HasModulePermission``. Unknown or unseeded roles fail closed;
    SUPERADMIN remains the only unconditional bypass.
    """
    if not user or not user.is_authenticated:
        return False
    if user.role == 'SUPERADMIN':
        return True

    from core.models import Role
    role = Role.objects.filter(slug=user.role).first()
    return bool(role and role.can(module, action))


class IsSuperadmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == 'SUPERADMIN'

class IsAdminOrSuperadmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in ['ADMIN', 'SUPERADMIN']

class IsManagerOrHigher(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in ['MANAGER', 'ADMIN', 'SUPERADMIN']

class ReadOnlyViewerOrHigher(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.role in ['MANAGER', 'ADMIN', 'SUPERADMIN']

class VaultAccessPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return has_role_permission(request.user, 'vault', 'view')


class VaultUnlockedPermission(permissions.BasePermission):
    """Requires a valid X-Vault-Token header issued via /vault/master/unlock/.
    Always also requires VaultAccessPermission. Slides expiry on success.
    """
    message = "Vault is locked. Enter the master password to unlock."

    def has_permission(self, request, view):
        from core.models import VaultUnlockSession, VaultMasterPassword
        if not request.user.is_authenticated:
            return False
        if not has_role_permission(request.user, 'vault', 'view'):
            return False
        token = request.headers.get('X-Vault-Token') or request.META.get('HTTP_X_VAULT_TOKEN')
        if not token:
            return False
        session = VaultUnlockSession.objects.filter(
            token=VaultUnlockSession.digest_token(token),
            user=request.user,
            revoked=False,
        ).first()
        if not session or not session.is_valid():
            return False
        # Slide expiry
        mp = VaultMasterPassword.get_singleton()
        ttl = mp.session_ttl_minutes if mp else 30
        session.slide(ttl_minutes=ttl)
        request.vault_session = session
        return True

class HasModulePermission(permissions.BasePermission):
    """Enforces a role's per-module permission map (configured under
    Settings → Roles & Permissions).

    Usage on a viewset::

        class FooViewSet(viewsets.ModelViewSet):
            permission_classes = [HasModulePermission]
            rbac_module = 'finance'

    Maps HTTP methods to the view/add/edit/delete actions and checks the
    signed-in user's role. SUPERADMIN always passes. Views without an
    ``rbac_module`` fall back to allow (so this is opt-in per view).
    """

    method_action = {
        'POST': 'add', 'PUT': 'edit', 'PATCH': 'edit', 'DELETE': 'delete',
    }

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        module = getattr(view, 'rbac_module', None)
        if not module:
            return True
        if request.method in permissions.SAFE_METHODS:
            action = 'view'
        else:
            view_action = getattr(view, 'action', None)
            configured = getattr(view, 'rbac_action_permissions', {}).get(view_action)
            if isinstance(configured, dict):
                configured = configured.get(request.method)
            if configured:
                action = configured
            elif view_action and 'bulk_delete' in view_action:
                action = 'delete'
            elif (
                view_action == 'bulk_action'
                and request.data.get('action') == 'delete'
            ):
                action = 'delete'
            elif request.method == 'POST' and view_action not in (None, 'create'):
                # DRF custom actions frequently mutate existing records. Treat
                # them as edits unless the view explicitly declares otherwise.
                action = 'edit'
            else:
                action = self.method_action.get(request.method, 'edit')
        return has_role_permission(request.user, module, action)


class UserManagementPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return has_role_permission(request.user, 'users', 'view')
        # Only admin/superadmin can write to users
        return request.user.role in ['ADMIN', 'SUPERADMIN']

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        if request.user.role == 'SUPERADMIN':
            return True
        if request.user.role == 'ADMIN':
            if obj == request.user:
                return True
            if obj.role in ['ADMIN', 'SUPERADMIN']:
                return False
            return True
        return False

from rest_framework import permissions

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
        # Viewer has no access to Vault
        if not request.user.is_authenticated:
            return False
        return request.user.role in ['MANAGER', 'ADMIN', 'SUPERADMIN']


class VaultUnlockedPermission(permissions.BasePermission):
    """Requires a valid X-Vault-Token header issued via /vault/master/unlock/.
    Always also requires VaultAccessPermission. Slides expiry on success.
    """
    message = "Vault is locked. Enter the master password to unlock."

    def has_permission(self, request, view):
        from core.models import VaultUnlockSession, VaultMasterPassword
        if not request.user.is_authenticated:
            return False
        if request.user.role not in ['MANAGER', 'ADMIN', 'SUPERADMIN']:
            return False
        token = request.headers.get('X-Vault-Token') or request.META.get('HTTP_X_VAULT_TOKEN')
        if not token:
            return False
        session = VaultUnlockSession.objects.filter(token=token, user=request.user, revoked=False).first()
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
        if request.user.role == 'SUPERADMIN':
            return True
        # Reads stay open to any authenticated user: list/detail endpoints are
        # frequently used as cross-module reference data (vendors in an asset
        # form, categories in a finance form, etc.), and the UI already hides
        # sections a role can't view. Writes are what the map gates.
        if request.method in permissions.SAFE_METHODS:
            return True
        action = self.method_action.get(request.method, 'edit')
        from core.models import Role
        role = Role.objects.filter(slug=request.user.role).first()
        if not role:
            return False
        return role.can(module, action)


class UserManagementPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
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

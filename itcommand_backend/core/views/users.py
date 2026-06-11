from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate
from django.db.models import Q
from django.utils import timezone
from datetime import timedelta
import random
import string
import secrets
from core.models import *
from core.serializers import *
from core.encryption import decrypt_value
from core.mixins import AuditLogMixin
from core.permissions import IsSuperadmin, IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher, VaultAccessPermission, UserManagementPermission, HasModulePermission
from rest_framework.pagination import PageNumberPagination
from rest_framework.pagination import PageNumberPagination

def get_tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        'refresh': str(refresh),
        'access': str(refresh.access_token),
    }


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        email = serializer.validated_data['email']
        password = serializer.validated_data['password']
        
        user = authenticate(email=email, password=password)
        if not user:
            return Response({'detail': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)
            
        if not user.is_active:
            return Response({'detail': 'This account is inactive.'}, status=status.HTTP_403_FORBIDDEN)
            
        tokens = get_tokens_for_user(user)
        return Response({
            'access': tokens['access'],
            'refresh': tokens['refresh'],
            'user': UserSerializer(user).data
        })

class UserMeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    def put(self, request, *args, **kwargs):
        # Restrict self-update to safe profile fields; role/is_active must not be writable here.
        serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)

class DepartmentViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Department.objects.all().order_by('-created_at')
    serializer_class = DepartmentSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'departments'

    def get_permissions(self):
        # Bulk delete is destructive; keep it admin-only regardless of the map.
        if self.action == 'bulk_delete':
            return [IsAdminOrSuperadmin()]
        return super().get_permissions()

    @staticmethod
    def _blocked_reason(dept):
        n = dept.user_set.count()
        if n:
            return f'{n} user(s) belong to this department'
        return None

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        reason = self._blocked_reason(instance)
        if reason:
            return Response(
                {'detail': f'Cannot delete department "{instance.name}": {reason}. Reassign users first.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        if not isinstance(ids, list):
            return Response({'detail': 'ids must be a list of integers.'},
                            status=status.HTTP_400_BAD_REQUEST)
        deleted, blocked = [], []
        for pk in ids:
            try:
                dept = Department.objects.get(pk=pk)
            except (Department.DoesNotExist, ValueError, TypeError):
                blocked.append({'id': pk, 'reason': 'not found'})
                continue
            reason = self._blocked_reason(dept)
            if reason:
                blocked.append({'id': pk, 'name': dept.name, 'reason': reason})
            else:
                dept.delete()
                deleted.append(pk)
        return Response({
            'deleted_count': len(deleted), 'blocked_count': len(blocked),
            'deleted': deleted, 'blocked': blocked,
        })

class UserViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = User.objects.all().order_by('-created_at')
    serializer_class = UserSerializer
    permission_classes = [UserManagementPermission]

    def get_permissions(self):
        if self.action in ['create', 'reset_password']:
            return [IsAdminOrSuperadmin()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get('search', None)
        role = self.request.query_params.get('role', None)
        department = self.request.query_params.get('department', None)
        
        if search:
            queryset = queryset.filter(
                Q(full_name__icontains=search) | 
                Q(email__icontains=search)
            )
        if role:
            queryset = queryset.filter(role=role)
        if department:
            queryset = queryset.filter(department_id=department)
            
        return queryset

    def generate_temp_password(self):
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
        return ''.join(secrets.choice(alphabet) for i in range(12))

    def perform_create(self, serializer):
        user = serializer.save()
        temp_password = self.generate_temp_password()
        user.set_password(temp_password)
        user.save()
        self._temp_password = temp_password

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        if hasattr(self, '_temp_password'):
            response.data['temp_password'] = self._temp_password
        return response

    def perform_destroy(self, instance):
        # Soft delete: keep history, just deactivate.
        instance.is_active = False
        instance.save()

    @action(detail=False, methods=['post'], url_path='bulk_delete',
            permission_classes=[IsAdminOrSuperadmin])
    def bulk_delete(self, request):
        """Bulk-deactivate users (soft delete). Refuses to deactivate the current
        user, the only remaining SUPERADMIN, or accounts above the caller's level.
        """
        ids = request.data.get('ids', [])
        if not isinstance(ids, list):
            return Response({'detail': 'ids must be a list of integers.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Cache once for the "last superadmin" guard.
        active_superadmins = User.objects.filter(role='SUPERADMIN', is_active=True).count()

        deactivated, blocked = [], []
        for pk in ids:
            try:
                u = User.objects.get(pk=pk)
            except (User.DoesNotExist, ValueError, TypeError):
                blocked.append({'id': pk, 'reason': 'not found'})
                continue
            if u.pk == request.user.pk:
                blocked.append({'id': pk, 'email': u.email, 'reason': 'cannot deactivate yourself'})
                continue
            # Admins cannot soft-delete admins/superadmins.
            if request.user.role == 'ADMIN' and u.role in ['ADMIN', 'SUPERADMIN']:
                blocked.append({'id': pk, 'email': u.email, 'reason': 'insufficient privilege'})
                continue
            if u.role == 'SUPERADMIN' and u.is_active and active_superadmins <= 1:
                blocked.append({'id': pk, 'email': u.email, 'reason': 'last active superadmin'})
                continue
            if u.is_active:
                u.is_active = False
                u.save(update_fields=['is_active'])
                if u.role == 'SUPERADMIN':
                    active_superadmins -= 1
            deactivated.append(pk)
        return Response({
            'deactivated_count': len(deactivated), 'blocked_count': len(blocked),
            'deactivated': deactivated, 'blocked': blocked,
        })

    @action(detail=True, methods=['post'], permission_classes=[IsAdminOrSuperadmin])
    def reset_password(self, request, pk=None):
        user = self.get_object()
        temp_password = self.generate_temp_password()
        user.set_password(temp_password)
        user.save()
        return Response({'temp_password': temp_password})

class ProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        user = request.user
        serializer = ProfileUpdateSerializer(user, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(UserSerializer(user).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        if serializer.is_valid():
            user = request.user
            if not user.check_password(serializer.validated_data['old_password']):
                return Response({'old_password': ['Wrong password.']}, status=status.HTTP_400_BAD_REQUEST)
            user.set_password(serializer.validated_data['new_password'])
            user.save()
            return Response({'status': 'Password updated successfully'})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

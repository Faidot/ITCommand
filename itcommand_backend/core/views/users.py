from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate
from django.db.models import Q
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
import random
import string
import secrets
from core.models import *
from core.serializers import *
from core.encryption import decrypt_value
from core import mail_bridge
from core.mixins import AuditLogMixin, record_audit
from core.permissions import IsSuperadmin, IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher, VaultAccessPermission, UserManagementPermission, HasModulePermission
from rest_framework.pagination import PageNumberPagination
from rest_framework.throttling import ScopedRateThrottle

def get_tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        'refresh': str(refresh),
        'access': str(refresh.access_token),
    }


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        email = serializer.validated_data['email']
        password = serializer.validated_data['password']
        
        # ── mailbox-backed accounts ────────────────────────────────────
        #
        # Dovecot is the authority for these, and the credential check has to
        # happen where the Mailbox row and its TOTP secret live -- in the mail
        # app -- rather than being reimplemented here against a database this
        # service cannot read. With MAIL_AUTH_ENABLED off this branch is dead
        # code and login behaves exactly as it always has.
        if mail_bridge.enabled():
            candidate = User.objects.filter(email__iexact=email).first()
            if candidate is not None and candidate.uses_mailbox_auth:
                return self._mailbox_login(request, candidate, email, password)

        user = authenticate(email=email, password=password)
        if not user:
            # Recorded without a user: a failed attempt is the one sign-in
            # event with nobody to attribute it to, and the one most worth
            # keeping. The email is stored so repeated attempts on one account
            # are visible; the password never is.
            record_audit(request, 'LOGIN_FAILED', changes={'email': email})
            return Response({'detail': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.is_active:
            record_audit(
                request, 'LOGIN_FAILED', obj=user,
                changes={'email': email, 'reason': 'account inactive'},
            )
            return Response({'detail': 'This account is inactive.'}, status=status.HTTP_403_FORBIDDEN)

        tokens = get_tokens_for_user(user)
        record_audit(request, 'LOGIN', obj=user, user=user, changes={'email': user.email})
        user.touch_seen(force=True)
        return Response({
            'access': tokens['access'],
            'refresh': tokens['refresh'],
            'user': UserSerializer(user).data
        })

    def _mailbox_login(self, request, user, email, password):
        """Dovecot decides, then the mail app hands back an MFA challenge."""
        if not user.is_active:
            record_audit(request, 'LOGIN_FAILED', obj=user,
                         changes={'email': email, 'reason': 'account inactive'})
            return Response({'detail': 'This account is inactive.'},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            code, body = mail_bridge.remote_login(email, password)
        except mail_bridge.MailBridgeError:
            return Response(
                {'detail': 'The mail service is not reachable right now. '
                           'Your password has not been rejected.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if code == 401:
            record_audit(request, 'LOGIN_FAILED', changes={'email': email})
            return Response({'detail': 'Invalid email or password.'},
                            status=status.HTTP_401_UNAUTHORIZED)
        if code == 503:
            return Response(
                {'detail': 'The mail server is not reachable right now. '
                           'Your password has not been rejected.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if code != 200:
            return Response({'detail': 'Sign-in failed.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Not a session yet: a three-minute ticket the second factor completes.
        out = {
            'mfa_required': True,
            'ticket': body.get('ticket'),
            'enrolment_required': body.get('enrolment_required', False),
        }
        if body.get('enrolment_required'):
            out['totp_secret'] = body.get('totp_secret')
            out['otpauth_uri'] = body.get('otpauth_uri')
        return Response(out)


class MailboxMfaView(APIView):
    """Second step of a mailbox login: the TOTP code.

    Kept separate from LoginView so that the local-password path keeps its
    single-request shape and nothing about it changes.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        if not mail_bridge.enabled():
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        ticket = request.data.get('ticket') or ''
        code = (request.data.get('code') or '').strip()
        try:
            code_status, body = mail_bridge.remote_mfa(ticket, code)
        except mail_bridge.MailBridgeError:
            return Response(
                {'detail': 'The mail service is not reachable right now.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if code_status != 200 or not body.get('sid'):
            return Response({'detail': body.get('detail', 'That code is not right.')},
                            status=status.HTTP_401_UNAUTHORIZED)

        email = (request.data.get('email') or '').strip().lower()
        user = User.objects.filter(email__iexact=email).first()
        if user is None or not user.uses_mailbox_auth or not user.is_active:
            mail_bridge.destroy_mail_session(body['sid'])
            return Response({'detail': 'Invalid email or password.'},
                            status=status.HTTP_401_UNAUTHORIZED)

        tokens = get_tokens_for_user(user)
        record_audit(request, 'LOGIN', obj=user, user=user,
                     changes={'email': user.email, 'via': 'mailbox'})
        user.touch_seen(force=True)
        payload = {
            'access': tokens['access'],
            'refresh': tokens['refresh'],
            'user': UserSerializer(user).data,
            # The browser needs to know a mailbox session exists so it can show
            # the Open Mailbox button. It never sees the sid.
            'mailbox_session': True,
        }
        if body.get('recovery_codes'):
            payload['recovery_codes'] = body['recovery_codes']
        response = Response(payload)
        # The sid rides in an httpOnly cookie on IT Command's own host, so no
        # script can read it and it never reaches localStorage.
        response.set_cookie(
            settings.MAIL_SID_COOKIE, body['sid'],
            max_age=int(settings.MAIL_SESSION_ABSOLUTE_SECONDS),
            httponly=True, secure=settings.SESSION_COOKIE_SECURE,
            samesite='Lax', path='/',
        )
        return response


class OpenMailboxView(APIView):
    """Mints the single-use handoff ticket behind the Open Mailbox button.

    Returns it in the response body. The frontend posts it onward to the mail
    app in an auto-submitted form, so it never enters a URL, browser history,
    a Referer header, or an access log. Blueprint section 4.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not mail_bridge.enabled():
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not request.user.can_open_mailbox:
            # A local-password account has no mail session to hand off.
            return Response({'detail': 'This account has no mailbox.'},
                            status=status.HTTP_403_FORBIDDEN)

        sid = request.COOKIES.get(settings.MAIL_SID_COOKIE, '')
        try:
            ticket = mail_bridge.mint_handoff(
                sid=sid, address=request.user.email,
                ua_hash=mail_bridge.ua_hash_for(request),
                ip=mail_bridge.client_ip_for(request),
            )
        except mail_bridge.MailBridgeError:
            # The mail session expired independently of the IT Command JWT.
            # Signing in again is the only honest answer: we hold no credential
            # to rebuild it with.
            return Response(
                {'detail': 'Your mailbox session has expired. Please sign in again.',
                 'reauth_required': True},
                status=status.HTTP_409_CONFLICT)

        record_audit(request, 'MAILBOX_HANDOFF', obj=request.user, user=request.user,
                     changes={'email': request.user.email})
        return Response({'ticket': ticket, 'post_to': settings.MAIL_APP_HANDOFF_URL})


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

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.pk == request.user.pk:
            return Response(
                {'detail': 'You cannot deactivate your own account.'},
                status=status.HTTP_409_CONFLICT,
            )
        if (
            instance.role == 'SUPERADMIN'
            and instance.is_active
            and User.objects.filter(role='SUPERADMIN', is_active=True).count() <= 1
        ):
            return Response(
                {'detail': 'The last active Superadmin cannot be deactivated.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

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
        if request.user.role == 'ADMIN' and user.role in ['ADMIN', 'SUPERADMIN']:
            return Response(
                {'detail': 'Only a Superadmin can reset this account password.'},
                status=status.HTTP_403_FORBIDDEN,
            )
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

import json
import re
import secrets
import string

from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from django.db.models import Q
from django.utils import timezone

from cryptography.fernet import InvalidToken
from django.contrib.auth import get_user_model

from core.models import (
    VaultCredential, AccountWorkspace,
    VaultMasterPassword, VaultUnlockSession,
    VaultUserKey, VaultShare,
)
from core.serializers import (
    VaultCredentialSerializer, AccountWorkspaceSerializer, VaultShareSerializer,
)
from core.encryption import decrypt_value
from core import vault_crypto
from core.mixins import AuditLogMixin
from core.permissions import (
    IsSuperadmin, VaultAccessPermission, VaultUnlockedPermission,
)

User = get_user_model()


# ────────────────────────── Master password helpers ──────────────────────────

PASSWORD_MIN_LEN = 12


def validate_strong_password(pwd: str) -> list[str]:
    """Returns a list of error strings; empty list means strong."""
    errors = []
    if not pwd or len(pwd) < PASSWORD_MIN_LEN:
        errors.append(f"Must be at least {PASSWORD_MIN_LEN} characters.")
    if pwd and not re.search(r'[A-Z]', pwd):
        errors.append("Must contain an uppercase letter.")
    if pwd and not re.search(r'[a-z]', pwd):
        errors.append("Must contain a lowercase letter.")
    if pwd and not re.search(r'\d', pwd):
        errors.append("Must contain a digit.")
    if pwd and not re.search(r'[^A-Za-z0-9]', pwd):
        errors.append("Must contain a special character.")
    return errors


def _client_ip(request):
    fwd = request.META.get('HTTP_X_FORWARDED_FOR')
    if fwd:
        return fwd.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


# ────────────────────────── Master password / unlock APIs ──────────────────────────


class VaultMasterStatusView(APIView):
    """GET — anyone with vault access. Tells the UI whether the master password
    is configured, and (if a valid unlock token is provided) when it expires.
    """
    permission_classes = [VaultAccessPermission]

    def get(self, request):
        mp = VaultMasterPassword.get_singleton()
        token = request.headers.get('X-Vault-Token')
        session = None
        if token:
            session = VaultUnlockSession.objects.filter(
                token=token, user=request.user, revoked=False
            ).first()
            if session and not session.is_valid():
                session = None

        return Response({
            'is_set': bool(mp),
            'set_by': mp.set_by.full_name if (mp and mp.set_by) else None,
            'set_at': mp.set_at if mp else None,
            'rotation_count': mp.rotation_count if mp else 0,
            'session_ttl_minutes': mp.session_ttl_minutes if mp else 30,
            'unlocked': bool(session),
            'unlock_expires_at': session.expires_at if session else None,
        })


class VaultMasterSetView(APIView):
    """POST — SUPERADMIN only. Sets or rotates the master password.
    Requires the super-admin's account password as confirmation.
    """
    permission_classes = [IsSuperadmin]

    def post(self, request):
        account_password = request.data.get('account_password') or ''
        new_password = request.data.get('new_password') or ''
        confirm_password = request.data.get('confirm_password') or ''
        session_ttl = request.data.get('session_ttl_minutes')

        if not request.user.check_password(account_password):
            return Response(
                {'detail': 'Your account password is incorrect.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if new_password != confirm_password:
            return Response(
                {'detail': 'New password and confirmation do not match.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        errors = validate_strong_password(new_password)
        if errors:
            return Response({'detail': ' '.join(errors), 'errors': errors},
                            status=status.HTTP_400_BAD_REQUEST)

        mp = VaultMasterPassword.get_singleton()
        if mp is None:
            mp = VaultMasterPassword(pk=1)
        mp.set_password(new_password)
        mp.set_by = request.user
        if session_ttl:
            try:
                ttl = int(session_ttl)
                if 5 <= ttl <= 240:
                    mp.session_ttl_minutes = ttl
            except (TypeError, ValueError):
                pass
        mp.save()

        # Revoke all existing unlock sessions on rotation so everyone re-enters.
        VaultUnlockSession.objects.filter(revoked=False).update(revoked=True)

        return Response({
            'detail': 'Vault master password updated. All existing sessions revoked.',
            'rotation_count': mp.rotation_count,
            'set_at': mp.set_at,
            'session_ttl_minutes': mp.session_ttl_minutes,
        })


class VaultUnlockView(APIView):
    """POST — any vault user. Verifies master password, returns a session token."""
    permission_classes = [VaultAccessPermission]

    def post(self, request):
        password = request.data.get('master_password') or ''
        mp = VaultMasterPassword.get_singleton()
        if not mp:
            return Response(
                {'detail': 'Vault master password is not set yet. Ask a Super Admin to configure it in Master Settings.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not mp.check_password(password):
            return Response({'detail': 'Incorrect master password.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Revoke any active session for this user, then issue a fresh one.
        VaultUnlockSession.objects.filter(user=request.user, revoked=False).update(revoked=True)
        session = VaultUnlockSession.issue(
            user=request.user,
            ttl_minutes=mp.session_ttl_minutes,
            ip=_client_ip(request),
        )
        return Response({
            'token': session.token,
            'expires_at': session.expires_at,
            'session_ttl_minutes': mp.session_ttl_minutes,
        })


class VaultLockView(APIView):
    """POST — vault user. Revokes the current session (manual lock)."""
    permission_classes = [VaultAccessPermission]

    def post(self, request):
        token = request.headers.get('X-Vault-Token')
        if token:
            VaultUnlockSession.objects.filter(token=token, user=request.user).update(revoked=True)
        return Response({'detail': 'Vault locked.'})


class VaultPasswordGeneratorView(APIView):
    """GET — generates a strong password. Length 8–64, optional symbols flag."""
    permission_classes = [VaultUnlockedPermission]

    def get(self, request):
        try:
            length = int(request.query_params.get('length', 20))
        except (TypeError, ValueError):
            length = 20
        length = max(8, min(length, 64))
        include_symbols = request.query_params.get('symbols', 'true').lower() != 'false'

        alphabet = string.ascii_lowercase + string.ascii_uppercase + string.digits
        if include_symbols:
            alphabet += '!@#$%^&*()-_=+[]{};:,.?/'

        # Ensure at least one of each required class so it always passes the
        # strength check the UI shows.
        while True:
            pwd = ''.join(secrets.choice(alphabet) for _ in range(length))
            if (re.search(r'[A-Z]', pwd) and re.search(r'[a-z]', pwd)
                    and re.search(r'\d', pwd)
                    and (not include_symbols or re.search(r'[^A-Za-z0-9]', pwd))):
                break
        return Response({'password': pwd, 'length': length})


# ────────────────────────── End-to-end sharing helpers ──────────────────────────


def build_secret_payload(credential) -> str:
    """Decrypt a credential's org-encrypted secrets into a JSON string suitable
    for sealing to a recipient. Includes password + any extras.
    """
    payload = {
        'password': decrypt_value(credential.encrypted_password) if credential.encrypted_password else '',
        'totp_secret': '',
        'recovery_codes': [],
        'custom_fields': {},
    }
    if credential.encrypted_totp_secret:
        payload['totp_secret'] = decrypt_value(credential.encrypted_totp_secret)
    if credential.encrypted_recovery_codes:
        payload['recovery_codes'] = json.loads(decrypt_value(credential.encrypted_recovery_codes))
    if credential.encrypted_custom_fields:
        payload['custom_fields'] = json.loads(decrypt_value(credential.encrypted_custom_fields))
    return json.dumps(payload)


def reseal_shares(credential):
    """Re-seal all existing shares of a credential to their recipients' public
    keys. Called after the owner edits the credential so shares stay in sync.
    Recipients whose keys vanished are skipped silently.
    """
    shares = list(credential.shares.select_related('recipient__vault_key').all())
    if not shares:
        return
    plaintext = build_secret_payload(credential)
    for share in shares:
        user_key = getattr(share.recipient, 'vault_key', None)
        if not user_key:
            continue
        share.sealed_secret = vault_crypto.seal_for_public_key(plaintext, user_key.public_key_pem)
        share.save(update_fields=['sealed_secret', 'updated_at'])


# ────────────────────────── Personal vault password / keypair APIs ──────────────────────────


class VaultPersonalStatusView(APIView):
    """GET — has the current user initialised their personal vault key yet?"""
    permission_classes = [VaultUnlockedPermission]

    def get(self, request):
        key = getattr(request.user, 'vault_key', None)
        return Response({
            'has_personal_key': bool(key),
            'created_at': key.created_at if key else None,
            'shared_with_me_count': VaultShare.objects.filter(recipient=request.user).count(),
        })


class VaultPersonalSetupView(APIView):
    """POST — set the personal vault password for the FIRST time and generate the
    user's keypair. Refuses if a key already exists (use change-password instead).
    """
    permission_classes = [VaultUnlockedPermission]

    def post(self, request):
        if getattr(request.user, 'vault_key', None):
            return Response({'detail': 'Personal vault password already set. Use change-password to update it.'},
                            status=status.HTTP_400_BAD_REQUEST)

        new_password = request.data.get('personal_password') or ''
        confirm = request.data.get('confirm_password') or ''
        if new_password != confirm:
            return Response({'detail': 'Passwords do not match.'}, status=status.HTTP_400_BAD_REQUEST)
        errors = validate_strong_password(new_password)
        if errors:
            return Response({'detail': ' '.join(errors), 'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        private_pem, public_pem = vault_crypto.generate_user_keypair()
        enc_priv, salt = vault_crypto.encrypt_private_key(private_pem, new_password)
        key = VaultUserKey(user=request.user, public_key_pem=public_pem,
                           encrypted_private_key=enc_priv, kdf_salt=salt)
        key.set_personal_password_hash(new_password)
        key.save()
        return Response({'detail': 'Personal vault password set. Others can now share credentials with you.'},
                        status=status.HTTP_201_CREATED)


class VaultPersonalChangeView(APIView):
    """POST — change the personal vault password. Re-encrypts the SAME private key
    under the new password, so existing shares stay valid.
    """
    permission_classes = [VaultUnlockedPermission]

    def post(self, request):
        key = getattr(request.user, 'vault_key', None)
        if not key:
            return Response({'detail': 'No personal vault password set yet.'}, status=status.HTTP_400_BAD_REQUEST)

        current = request.data.get('current_password') or ''
        new_password = request.data.get('new_password') or ''
        confirm = request.data.get('confirm_password') or ''
        if not key.check_personal_password(current):
            return Response({'detail': 'Current personal password is incorrect.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if new_password != confirm:
            return Response({'detail': 'Passwords do not match.'}, status=status.HTTP_400_BAD_REQUEST)
        errors = validate_strong_password(new_password)
        if errors:
            return Response({'detail': ' '.join(errors), 'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        try:
            private_pem = vault_crypto.decrypt_private_key(key.encrypted_private_key, current, key.kdf_salt)
        except InvalidToken:
            return Response({'detail': 'Current personal password is incorrect.'},
                            status=status.HTTP_400_BAD_REQUEST)
        enc_priv, salt = vault_crypto.encrypt_private_key(private_pem, new_password)
        key.encrypted_private_key = enc_priv
        key.kdf_salt = salt
        key.set_personal_password_hash(new_password)
        key.save(update_fields=['encrypted_private_key', 'kdf_salt', 'password_hash', 'updated_at'])
        return Response({'detail': 'Personal vault password changed.'})


class VaultPersonalResetView(APIView):
    """POST — forgot-personal-password recovery. Confirms with the user's ACCOUNT
    password, then regenerates a fresh keypair. All credentials previously shared
    with this user become unreadable (true E2E cost) and are removed; owners must
    re-share. The user must re-run setup to pick a new personal password.
    """
    permission_classes = [VaultUnlockedPermission]

    def post(self, request):
        account_password = request.data.get('account_password') or ''
        if not request.user.check_password(account_password):
            return Response({'detail': 'Your account password is incorrect.'},
                            status=status.HTTP_400_BAD_REQUEST)

        new_password = request.data.get('personal_password') or ''
        confirm = request.data.get('confirm_password') or ''
        if new_password != confirm:
            return Response({'detail': 'Passwords do not match.'}, status=status.HTTP_400_BAD_REQUEST)
        errors = validate_strong_password(new_password)
        if errors:
            return Response({'detail': ' '.join(errors), 'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        # Incoming shares were sealed to the OLD key — unrecoverable now. Drop them.
        dropped = VaultShare.objects.filter(recipient=request.user).count()
        VaultShare.objects.filter(recipient=request.user).delete()

        private_pem, public_pem = vault_crypto.generate_user_keypair()
        enc_priv, salt = vault_crypto.encrypt_private_key(private_pem, new_password)
        key, _ = VaultUserKey.objects.get_or_create(user=request.user, defaults={
            'public_key_pem': public_pem, 'encrypted_private_key': enc_priv, 'kdf_salt': salt,
        })
        key.public_key_pem = public_pem
        key.encrypted_private_key = enc_priv
        key.kdf_salt = salt
        key.set_personal_password_hash(new_password)
        key.save()
        return Response({
            'detail': 'Personal vault password reset. Previously shared items were cleared and must be re-shared.',
            'shares_dropped': dropped,
        })


# ────────────────────────── Credential / Workspace viewsets ──────────────────────────


class VaultCredentialViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = VaultCredential.objects.all().select_related('workspace').prefetch_related('shares__recipient').order_by('-is_favorite', '-created_at')
    serializer_class = VaultCredentialSerializer
    permission_classes = [VaultUnlockedPermission]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        # Private credentials are only listed to their creator. Everyone else
        # reaches them solely through "shared with me" + reveal_shared.
        queryset = queryset.filter(Q(visibility='ORG') | Q(created_by=self.request.user))

        category = params.get('category')
        search = params.get('search')
        favorites = params.get('favorites_only')
        workspace_id = params.get('workspace')
        shared_only = params.get('shared_only')
        tag = params.get('tag')

        if category:
            queryset = queryset.filter(category=category)
        if favorites in ('1', 'true', 'True'):
            queryset = queryset.filter(is_favorite=True)
        if shared_only in ('1', 'true', 'True'):
            queryset = queryset.filter(is_shared=True)
        if workspace_id:
            queryset = queryset.filter(workspace_id=workspace_id)
        if tag:
            queryset = queryset.filter(tags__icontains=tag)
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) |
                Q(username__icontains=search) |
                Q(workspace_tag__icontains=search) |
                Q(url__icontains=search) |
                Q(workspace__name__icontains=search)
            )
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        credential = serializer.save()
        # Keep E2E shares in sync when the owner edits the secret.
        reseal_shares(credential)

    def _require_owner(self, credential):
        """Only the creator (or an admin/superadmin) may manage who a credential
        is shared with."""
        user = self.request.user
        return credential.created_by_id == user.id or user.role in ('ADMIN', 'SUPERADMIN')

    @action(detail=False, methods=['get'])
    def shareable_users(self, request):
        """Users eligible to receive a private share: vault users (Manager+),
        excluding the requester, with a flag for whether they have set up their
        personal key yet (a prerequisite for E2E sharing)."""
        users = (User.objects.filter(role__in=['MANAGER', 'ADMIN', 'SUPERADMIN'])
                 .exclude(id=request.user.id).order_by('full_name'))
        have_keys = set(VaultUserKey.objects.values_list('user_id', flat=True))
        return Response([
            {'id': u.id, 'name': u.full_name, 'role': u.role,
             'has_personal_key': u.id in have_keys}
            for u in users
        ])

    @action(detail=True, methods=['post'])
    def share(self, request, pk=None):
        """Privately share this credential with one or more users (E2E sealed to
        each recipient's public key). Body: { recipient_ids: [int],
        make_private?: bool (default true) }."""
        credential = self.get_object()
        if not self._require_owner(credential):
            return Response({'detail': 'Only the owner can share this credential.'},
                            status=status.HTTP_403_FORBIDDEN)

        ids = request.data.get('recipient_ids') or []
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'recipient_ids[] is required.'}, status=status.HTTP_400_BAD_REQUEST)
        make_private = request.data.get('make_private', True)

        plaintext = build_secret_payload(credential)
        shared, skipped = [], []
        for uid in ids:
            if uid == request.user.id:
                skipped.append({'id': uid, 'reason': 'Cannot share with yourself.'})
                continue
            recipient = User.objects.filter(pk=uid).first()
            if not recipient:
                skipped.append({'id': uid, 'reason': 'User not found.'})
                continue
            user_key = getattr(recipient, 'vault_key', None)
            if not user_key:
                skipped.append({'id': uid, 'name': recipient.full_name,
                                'reason': 'User has not set up their personal vault password yet.'})
                continue
            sealed = vault_crypto.seal_for_public_key(plaintext, user_key.public_key_pem)
            VaultShare.objects.update_or_create(
                credential=credential, recipient=recipient,
                defaults={'sealed_secret': sealed, 'shared_by': request.user},
            )
            shared.append({'id': uid, 'name': recipient.full_name})

        if shared:
            credential.is_shared = True
            fields = ['is_shared']
            if make_private and credential.visibility != 'PRIVATE':
                credential.visibility = 'PRIVATE'
                fields.append('visibility')
            credential.save(update_fields=fields)

        return Response({'shared': shared, 'skipped': skipped})

    @action(detail=True, methods=['post'])
    def unshare(self, request, pk=None):
        """Revoke a private share. Body: { recipient_ids: [int] }."""
        credential = self.get_object()
        if not self._require_owner(credential):
            return Response({'detail': 'Only the owner can manage sharing.'},
                            status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('recipient_ids') or []
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'recipient_ids[] is required.'}, status=status.HTTP_400_BAD_REQUEST)
        removed = VaultShare.objects.filter(credential=credential, recipient_id__in=ids).delete()[0]
        if not credential.shares.exists():
            credential.is_shared = False
            credential.save(update_fields=['is_shared'])
        return Response({'detail': 'OK', 'removed': removed})

    @action(detail=True, methods=['get'])
    def shares(self, request, pk=None):
        """List the recipients this credential is privately shared with (owner only)."""
        credential = self.get_object()
        if not self._require_owner(credential):
            return Response({'detail': 'Only the owner can view sharing.'},
                            status=status.HTTP_403_FORBIDDEN)
        out = [
            {'recipient_id': s.recipient_id, 'name': s.recipient.full_name,
             'shared_at': s.created_at, 'last_revealed_at': s.last_revealed_at,
             'reveal_count': s.reveal_count}
            for s in credential.shares.select_related('recipient').all()
        ]
        return Response(out)

    @action(detail=False, methods=['get'])
    def shared_with_me(self, request):
        """Credentials privately shared with the current user (metadata only)."""
        qs = (VaultShare.objects.filter(recipient=request.user)
              .select_related('credential', 'shared_by').order_by('-created_at'))
        return Response(VaultShareSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'])
    def reveal_shared(self, request, pk=None):
        """Reveal a credential shared with you by supplying your personal vault
        password. Decrypts your private key in memory and opens the sealed secret.
        Body: { personal_password: str }."""
        share = VaultShare.objects.filter(credential_id=pk, recipient=request.user).first()
        if not share:
            return Response({'detail': 'This credential is not shared with you.'},
                            status=status.HTTP_404_NOT_FOUND)
        key = getattr(request.user, 'vault_key', None)
        if not key:
            return Response({'detail': 'Set your personal vault password first.'},
                            status=status.HTTP_400_BAD_REQUEST)

        personal_password = request.data.get('personal_password') or ''
        if not key.check_personal_password(personal_password):
            return Response({'detail': 'Incorrect personal vault password.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            private_pem = vault_crypto.decrypt_private_key(
                key.encrypted_private_key, personal_password, key.kdf_salt)
            secret = json.loads(vault_crypto.open_with_private_key(share.sealed_secret, private_pem))
        except (InvalidToken, ValueError, Exception):
            return Response({'detail': 'Failed to decrypt the shared secret.'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        share.last_revealed_at = timezone.now()
        share.reveal_count = (share.reveal_count or 0) + 1
        share.save(update_fields=['last_revealed_at', 'reveal_count'])
        return Response({
            'password': secret.get('password', ''),
            'totp_secret': secret.get('totp_secret') or None,
            'recovery_codes': secret.get('recovery_codes') or [],
            'custom_fields': secret.get('custom_fields') or {},
            'revealed_at': share.last_revealed_at,
        })

    @action(detail=True, methods=['get'])
    def reveal(self, request, pk=None):
        credential = self.get_object()
        try:
            password = decrypt_value(credential.encrypted_password)
            credential.last_revealed_at = timezone.now()
            credential.last_revealed_by = request.user
            credential.reveal_count = (credential.reveal_count or 0) + 1
            credential.save(update_fields=['last_revealed_at', 'last_revealed_by', 'reveal_count'])
            return Response({
                'password': password,
                'revealed_at': credential.last_revealed_at,
            })
        except Exception:
            return Response({'detail': 'Failed to decrypt password.'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['get'])
    def reveal_extras(self, request, pk=None):
        """Decrypt + return optional extras: TOTP secret, recovery codes, custom fields."""
        credential = self.get_object()
        out = {'totp_secret': None, 'recovery_codes': [], 'custom_fields': {}}
        try:
            if credential.encrypted_totp_secret:
                out['totp_secret'] = decrypt_value(credential.encrypted_totp_secret)
            if credential.encrypted_recovery_codes:
                out['recovery_codes'] = json.loads(decrypt_value(credential.encrypted_recovery_codes))
            if credential.encrypted_custom_fields:
                out['custom_fields'] = json.loads(decrypt_value(credential.encrypted_custom_fields))
        except Exception:
            return Response({'detail': 'Failed to decrypt extras.'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(out)

    @action(detail=True, methods=['post'])
    def toggle_favorite(self, request, pk=None):
        c = self.get_object()
        c.is_favorite = not c.is_favorite
        c.save(update_fields=['is_favorite'])
        return Response({'id': c.id, 'is_favorite': c.is_favorite})

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Clone a credential (without altering reveal stats). New title gets ' (Copy)'."""
        src = self.get_object()
        clone = VaultCredential.objects.create(
            title=f"{src.title} (Copy)",
            username=src.username,
            encrypted_password=src.encrypted_password,
            url=src.url,
            category=src.category,
            workspace_tag=src.workspace_tag,
            notes=src.notes,
            workspace=src.workspace,
            tags=list(src.tags or []),
            encrypted_totp_secret=src.encrypted_totp_secret,
            encrypted_recovery_codes=src.encrypted_recovery_codes,
            encrypted_custom_fields=src.encrypted_custom_fields,
            created_by=request.user,
            is_shared=src.is_shared,
            rotation_due_at=src.rotation_due_at,
            is_favorite=False,
        )
        return Response(VaultCredentialSerializer(clone).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def bulk_action(self, request):
        """Bulk-update or bulk-delete credentials.

        Body: { ids: [int, ...], action: 'delete'|'favorite_on'|'favorite_off'
                                |'share_on'|'share_off'|'set_category'|'set_workspace'|'add_tag'|'remove_tag',
                value?: any }
        """
        ids = request.data.get('ids') or []
        op = request.data.get('action')
        value = request.data.get('value')

        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'ids[] is required.'}, status=status.HTTP_400_BAD_REQUEST)

        qs = VaultCredential.objects.filter(id__in=ids)
        n = qs.count()
        if n == 0:
            return Response({'detail': 'No matching credentials.'}, status=status.HTTP_404_NOT_FOUND)

        if op == 'delete':
            qs.delete()
        elif op == 'favorite_on':
            qs.update(is_favorite=True)
        elif op == 'favorite_off':
            qs.update(is_favorite=False)
        elif op == 'share_on':
            qs.update(is_shared=True)
        elif op == 'share_off':
            qs.update(is_shared=False)
        elif op == 'set_category':
            valid = {c[0] for c in VaultCredential.CATEGORY_CHOICES}
            if value not in valid:
                return Response({'detail': 'Invalid category.'}, status=status.HTTP_400_BAD_REQUEST)
            qs.update(category=value)
        elif op == 'set_workspace':
            ws = None
            if value:
                ws = AccountWorkspace.objects.filter(pk=value).first()
                if not ws:
                    return Response({'detail': 'Workspace not found.'}, status=status.HTTP_400_BAD_REQUEST)
            qs.update(workspace=ws)
        elif op in ('add_tag', 'remove_tag'):
            tag = (value or '').strip()
            if not tag:
                return Response({'detail': 'value (tag) is required.'}, status=status.HTTP_400_BAD_REQUEST)
            for c in qs:
                existing = list(c.tags or [])
                if op == 'add_tag' and tag not in existing:
                    existing.append(tag)
                if op == 'remove_tag' and tag in existing:
                    existing = [t for t in existing if t != tag]
                c.tags = existing
                c.save(update_fields=['tags'])
        else:
            return Response({'detail': 'Unknown action.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({'detail': 'OK', 'affected': n, 'action': op})

    @action(detail=False, methods=['get'])
    def stats(self, request):
        qs = self.get_queryset()
        today = timezone.now().date()
        by_cat = {}
        for c in qs.values('category'):
            by_cat[c['category']] = by_cat.get(c['category'], 0) + 1
        due = qs.filter(rotation_due_at__lte=today + timezone.timedelta(days=7)).count()
        return Response({
            'total': qs.count(),
            'favorites': qs.filter(is_favorite=True).count(),
            'shared': qs.filter(is_shared=True).count(),
            'rotation_due_soon': due,
            'by_category': by_cat,
            'with_totp': qs.exclude(encrypted_totp_secret='').count(),
        })

    @action(detail=False, methods=['get'])
    def match(self, request):
        """Credentials whose stored URL host matches a domain — used by the
        browser extension to offer auto-fill. Returns metadata only (no secrets);
        the extension reveals the password separately on demand.
        """
        from urllib.parse import urlparse

        domain = (request.query_params.get('domain') or '').lower().strip()
        if not domain:
            return Response([])

        def host_of(value: str) -> str:
            if not value:
                return ''
            v = value if '//' in value else 'https://' + value
            h = (urlparse(v).hostname or '').lower()
            return h[4:] if h.startswith('www.') else h

        target = host_of(domain)
        if not target:
            return Response([])

        out = []
        # Reuse get_queryset so visibility scoping (private creds hidden from
        # non-owners) is respected. Only ORG creds the user can reveal normally
        # will surface here.
        for c in self.get_queryset().exclude(url__isnull=True).exclude(url=''):
            h = host_of(c.url)
            if not h:
                continue
            if h == target or target.endswith('.' + h) or h.endswith('.' + target):
                out.append({
                    'id': c.id, 'title': c.title, 'username': c.username,
                    'url': c.url, 'category': c.category, 'host': h,
                })
        return Response(out)

    @action(detail=False, methods=['get'])
    def tags(self, request):
        """Return all distinct tags currently in use."""
        seen = set()
        for c in VaultCredential.objects.all().values_list('tags', flat=True):
            for t in (c or []):
                if t:
                    seen.add(t)
        return Response(sorted(seen))


class AccountWorkspaceViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = AccountWorkspace.objects.all().order_by('-created_at')
    serializer_class = AccountWorkspaceSerializer
    permission_classes = [VaultUnlockedPermission]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        platform = params.get('platform')
        search = params.get('search')
        st = params.get('status')
        cycle = params.get('billing_cycle')
        owner = params.get('owner')

        if platform:
            queryset = queryset.filter(platform=platform)
        if st:
            queryset = queryset.filter(status=st)
        if cycle:
            queryset = queryset.filter(billing_cycle=cycle)
        if owner:
            queryset = queryset.filter(owner_name__icontains=owner)
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(login_email__icontains=search) |
                Q(owner_name__icontains=search) |
                Q(subscription_plan__icontains=search)
            )
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def mark_renewed(self, request, pk=None):
        """Advance renewal_date by one billing cycle and stamp last_renewed_at."""
        ws = self.get_object()
        ws.advance_renewal()
        ws.save(update_fields=['renewal_date', 'last_renewed_at'])
        return Response(AccountWorkspaceSerializer(ws).data)

    @action(detail=True, methods=['get'])
    def credentials(self, request, pk=None):
        """List credentials linked to this workspace."""
        ws = self.get_object()
        qs = ws.credentials.all().order_by('-is_favorite', '-created_at')
        return Response(VaultCredentialSerializer(qs, many=True).data)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        qs = self.get_queryset()
        today = timezone.now().date()
        soon = today + timezone.timedelta(days=30)
        expired = qs.filter(renewal_date__lt=today).count()
        renewing_soon = qs.filter(renewal_date__gte=today, renewal_date__lte=soon).count()
        monthly_total = 0.0
        annual_total = 0.0
        for ws in qs.exclude(monthly_cost__isnull=True):
            monthly_total += float(ws.monthly_cost or 0)
            annual_total += float(ws.annual_cost or 0)

        by_status = {}
        for s in qs.values('status'):
            by_status[s['status']] = by_status.get(s['status'], 0) + 1

        return Response({
            'total': qs.count(),
            'active': qs.filter(status='ACTIVE').count(),
            'trial': qs.filter(status='TRIAL').count(),
            'paused': qs.filter(status='PAUSED').count(),
            'cancelled': qs.filter(status='CANCELLED').count(),
            'expired': expired,
            'renewing_soon': renewing_soon,
            'monthly_total': round(monthly_total, 2),
            'annual_total': round(annual_total, 2),
            'by_status': by_status,
        })

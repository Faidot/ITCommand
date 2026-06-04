import json

from .users import UserSerializer
from rest_framework import serializers
from django.contrib.auth import get_user_model
from core.models import *
from core.encryption import encrypt_value

User = get_user_model()


class VaultCredentialSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    totp_secret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    recovery_codes = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        write_only=True, required=False,
    )
    custom_fields = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        write_only=True, required=False,
    )

    masked_password = serializers.SerializerMethodField(read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    last_revealed_by_name = serializers.CharField(source='last_revealed_by.full_name', read_only=True)
    workspace_name = serializers.CharField(source='workspace.name', read_only=True)
    workspace_platform = serializers.CharField(source='workspace.platform', read_only=True)
    has_totp = serializers.SerializerMethodField(read_only=True)
    has_recovery_codes = serializers.SerializerMethodField(read_only=True)
    has_custom_fields = serializers.SerializerMethodField(read_only=True)
    is_owner = serializers.SerializerMethodField(read_only=True)
    shared_with = serializers.SerializerMethodField(read_only=True)
    share_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = VaultCredential
        fields = [
            'id', 'title', 'username', 'password', 'masked_password', 'url',
            'category', 'workspace_tag', 'notes', 'tags',
            'workspace', 'workspace_name', 'workspace_platform',
            'totp_secret', 'recovery_codes', 'custom_fields',
            'has_totp', 'has_recovery_codes', 'has_custom_fields',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
            'is_shared', 'is_favorite', 'visibility',
            'is_owner', 'shared_with', 'share_count',
            'last_revealed_at', 'last_revealed_by', 'last_revealed_by_name',
            'reveal_count', 'rotation_due_at',
        ]
        read_only_fields = ['created_by', 'last_revealed_at', 'last_revealed_by',
                            'last_revealed_by_name', 'reveal_count',
                            'workspace_name', 'workspace_platform',
                            'has_totp', 'has_recovery_codes', 'has_custom_fields',
                            'is_owner', 'shared_with', 'share_count', 'is_shared']

    def get_masked_password(self, obj):
        return "••••••"

    def get_is_owner(self, obj):
        request = self.context.get('request')
        return bool(request and obj.created_by_id == request.user.id)

    def get_shared_with(self, obj):
        # Only the owner should see who a credential is shared with.
        request = self.context.get('request')
        if not (request and obj.created_by_id == request.user.id):
            return []
        return [
            {'id': s.recipient_id, 'name': s.recipient.full_name, 'shared_at': s.created_at}
            for s in obj.shares.select_related('recipient').all()
        ]

    def get_share_count(self, obj):
        return obj.shares.count()

    def get_has_totp(self, obj):
        return bool(obj.encrypted_totp_secret)

    def get_has_recovery_codes(self, obj):
        return bool(obj.encrypted_recovery_codes)

    def get_has_custom_fields(self, obj):
        return bool(obj.encrypted_custom_fields)

    def _encrypt_extras(self, validated_data, partial=False):
        """Encrypt and pop totp / recovery / custom_fields off validated_data.
        Empty string / empty list / empty dict mean clear the field.
        On partial update, absent keys leave existing data alone.
        """
        result = {}
        if 'totp_secret' in validated_data:
            v = (validated_data.pop('totp_secret') or '').strip()
            result['encrypted_totp_secret'] = encrypt_value(v) if v else ''
        if 'recovery_codes' in validated_data:
            codes = [c.strip() for c in (validated_data.pop('recovery_codes') or []) if c and c.strip()]
            result['encrypted_recovery_codes'] = encrypt_value(json.dumps(codes)) if codes else ''
        if 'custom_fields' in validated_data:
            cf = validated_data.pop('custom_fields') or {}
            cf = {k: v for k, v in cf.items() if k and (v or v == '')}
            result['encrypted_custom_fields'] = encrypt_value(json.dumps(cf)) if cf else ''
        return result

    def create(self, validated_data):
        password = validated_data.pop('password', '')
        extras = self._encrypt_extras(validated_data)
        validated_data['encrypted_password'] = encrypt_value(password)
        validated_data.update(extras)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if 'password' in validated_data:
            password = validated_data.pop('password')
            if password:
                validated_data['encrypted_password'] = encrypt_value(password)
        extras = self._encrypt_extras(validated_data, partial=self.partial)
        validated_data.update(extras)
        return super().update(instance, validated_data)


class AccountWorkspaceSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    credential_count = serializers.SerializerMethodField(read_only=True)
    annual_cost = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = AccountWorkspace
        fields = '__all__'
        read_only_fields = ['created_by', 'last_renewed_at']

    def get_credential_count(self, obj):
        return obj.credentials.count()

    def get_annual_cost(self, obj):
        return obj.annual_cost


class VaultShareSerializer(serializers.ModelSerializer):
    """A credential privately shared *with* the current user. Carries metadata
    only — the secret is never included here; it is revealed via reveal_shared
    after the recipient supplies their personal vault password.
    """
    credential_id = serializers.IntegerField(source='credential.id', read_only=True)
    title = serializers.CharField(source='credential.title', read_only=True)
    username = serializers.CharField(source='credential.username', read_only=True)
    url = serializers.CharField(source='credential.url', read_only=True)
    category = serializers.CharField(source='credential.category', read_only=True)
    notes = serializers.CharField(source='credential.notes', read_only=True)
    has_totp = serializers.SerializerMethodField()
    shared_by_name = serializers.CharField(source='shared_by.full_name', read_only=True)

    class Meta:
        model = VaultShare
        fields = [
            'id', 'credential_id', 'title', 'username', 'url', 'category', 'notes',
            'has_totp', 'shared_by_name', 'created_at', 'last_revealed_at', 'reveal_count',
        ]

    def get_has_totp(self, obj):
        return bool(obj.credential.encrypted_totp_secret)

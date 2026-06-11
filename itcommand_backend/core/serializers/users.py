from rest_framework import serializers
from django.contrib.auth import get_user_model
from core.models import *
from core.encryption import encrypt_value

User = get_user_model()


class DepartmentSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()
    head_name = serializers.SerializerMethodField(read_only=True)
    parent_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Department
        fields = [
            'id',
            'name',
            'code',
            'description',
            'head',
            'head_name',
            'parent',
            'parent_name',
            'created_at',
            'member_count',
        ]

    def get_member_count(self, obj):
        return obj.user_set.count()

    def get_head_name(self, obj):
        if not getattr(obj, "head_id", None):
            return None
        return obj.head.full_name

    def get_parent_name(self, obj):
        if not getattr(obj, "parent_id", None):
            return None
        return obj.parent.name

class UserSerializer(serializers.ModelSerializer):
    manager_name = serializers.SerializerMethodField(read_only=True)
    team_lead_name = serializers.SerializerMethodField(read_only=True)
    # Override the model ChoiceField so any role defined in the Roles &
    # Permissions section (not just the four built-ins) can be assigned.
    role = serializers.CharField()
    role_label = serializers.SerializerMethodField(read_only=True)
    permissions = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id',
            'email',
            'full_name',
            'role',
            'role_label',
            'permissions',
            'department',
            'avatar',
            'designation',
            'bio',
            'manager',
            'manager_name',
            'team_lead',
            'team_lead_name',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_manager_name(self, obj):
        if not getattr(obj, "manager_id", None):
            return None
        return obj.manager.full_name

    def get_team_lead_name(self, obj):
        if not getattr(obj, "team_lead_id", None):
            return None
        return obj.team_lead.full_name

    def _role(self, obj):
        from core.models import Role
        return Role.objects.filter(slug=obj.role).first()

    def get_role_label(self, obj):
        role = self._role(obj)
        return role.name if role else obj.role

    def get_permissions(self, obj):
        from core.models import Role
        from core import rbac
        role = self._role(obj)
        if role:
            return role.effective_permissions()
        # Unknown/unseeded role slug: deny everything rather than guess.
        return rbac.blank_permissions()

    def validate_role(self, value):
        from core.models import Role
        value = (value or "").strip().upper()
        if not Role.objects.filter(slug=value).exists():
            raise serializers.ValidationError("Unknown role.")
        return value

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

class TokenSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()
    user = UserSerializer()

class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['full_name', 'avatar', 'designation', 'bio']

class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True)

from rest_framework import serializers
from django.utils.text import slugify

from core.models import Role, User
from core import rbac


class RoleSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Role
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "is_system",
            "permissions",
            "user_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "slug", "is_system", "created_at", "updated_at"]

    def get_user_count(self, obj):
        return User.objects.filter(role=obj.slug).count()

    def validate_permissions(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Permissions must be an object.")
        return rbac.normalize_permissions(value)

    def validate(self, attrs):
        # Slug is derived from the name on create and is immutable afterwards
        # (it is the identifier stored on users).
        if self.instance is None:
            name = attrs.get("name", "")
            slug = slugify(name).upper().replace("-", "_")[:40]
            if not slug:
                raise serializers.ValidationError({"name": "A valid name is required."})
            if Role.objects.filter(slug=slug).exists():
                raise serializers.ValidationError({"name": "A role with a similar name already exists."})
            attrs["slug"] = slug
        else:
            attrs.pop("slug", None)
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Always present SUPERADMIN as all-access so the UI reflects reality.
        data["permissions"] = instance.effective_permissions()
        return data
